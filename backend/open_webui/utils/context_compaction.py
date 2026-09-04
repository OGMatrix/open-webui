"""Keeping a conversation inside its model's window, before it stops fitting.

The failure this exists to prevent is specific: a chat grows, a request is
refused for being too long, and the turn is lost after the user has already
waited for it. Everything here is arranged around noticing beforehand.

Three things decide whether that works.

**The window has to be the model's own.** A fixed threshold is wrong for every
model that is not the one it was chosen for: too high and a 32k model overflows
long before compaction fires, too low and two thirds of a 200k window is thrown
away unread. See utils/context_window.py.

**The count has to be near the truth.** A count based on characters loses two
thirds of a Japanese message and a fifth of a JSON tool result -- both in the
direction that overflows. See utils/token_counter.py.

**Summarising has to be the last resort.** It costs a model call, it rewrites
the provider's cached prefix so the whole conversation is billed again, and it
is the only step that loses meaning. Published measurements put recall after
repeated summarisation near a third of what keeping the history achieves, while
the answers still read fluently -- so the loss is invisible from the outside,
which is a reason to be slower to take it, not faster. Cheaper reductions run
first; see utils/context_fitting.py.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi.responses import JSONResponse
from open_webui.models.chats import Chats
from open_webui.models.config import Config
from open_webui.utils.chat_id import is_saved_chat_id
from open_webui.utils.context_budget import (
    DEFAULT_RETENTION_RATIO,
    DEFAULT_TRIGGER_RATIO,
    ContextBudget,
    resolve_budget,
)
from open_webui.utils.context_fitting import FitReport, fit_messages_to_window, split_into_turns
from open_webui.utils.json_codec import JSONCodec
from open_webui.utils.misc import get_content_from_message, get_last_user_message, get_message_list
from open_webui.utils.payload import apply_params_to_form_data
from open_webui.utils.task import (
    prompt_template,
    prompt_variables_template,
    replace_messages_variable,
    replace_prompt_variable,
)
from open_webui.utils.token_counter import (
    count_messages_tokens,
    count_text_tokens,
    count_tools_tokens,
    prime_encoder,
    usage_completion_tokens,
    usage_prompt_tokens,
)

log = logging.getLogger(__name__)

DEFAULT_CONTEXT_COMPACTION_PROMPT = """You are writing the note that will replace part of a conversation.

The messages under "Messages being compacted" are about to be removed from the
model's context. Your note takes their place. Everything the assistant will
need from them, and cannot get anywhere else, has to survive in what you write;
anything you leave out is gone.

## How to write it

**Carry the previous note forward.** If there is one under "Previous note", it
already replaced messages you cannot see. Treat it as a source of equal
standing, not as something to summarise again: restate everything in it that is
still true, in as much detail as it was given. Drop only what the newer
messages have since settled or superseded. This is the whole reason a long
conversation does not decay — each note is written against the last one, not
against a copy of a copy.

**Keep exact things exactly.** Names, identifiers, file paths, URLs, version
numbers, quantities, dates, error messages, and any wording the user asked for
specifically. Reproduce them character for character. A paraphrased identifier
is worse than a missing one, because it looks usable.

**Record what was decided and what it cost.** Not just the conclusion but the
reason, and what was rejected on the way. Approaches already tried and
abandoned are as important as the one that worked: without them the assistant
repeats them.

**Record what the user is like.** Stated preferences, constraints, tone,
language, level of detail, things they said they did not want, and anything
promised to them that has not yet been delivered.

**Record where the work stands.** What is finished, what is in progress, what
is blocked, what question is open, and what the immediate next step is.

**Do not invent.** If something was ambiguous in the conversation, say that it
was ambiguous. Do not resolve it, do not smooth it over, and do not add detail
that was not there. An honest gap is recoverable; a confident invention is not.

**Do not repeat what is still in context.** The messages under "Messages still
in context" remain visible to the assistant. Mention them only where the
removed messages are needed to make sense of them.

## Format

Use these headings, and omit any that would be empty. Write in the
conversation's own language. Be as brief as the content allows and as long as
it requires — err toward including something that would prevent repeated work
or a repeated mistake. No preamble, no sign-off, no commentary about the
summarising itself.

### Subject
What this conversation is about, in a sentence or two.

### Established facts
What has been settled, including anything the user supplied that the assistant
cannot look up again.

### Decisions and rationale
What was chosen, why, and what was rejected.

### User preferences and constraints
How this user wants to be worked with.

### Current state
What is done, in progress, or blocked.

### Open questions and next steps
What remains, in the order it matters.

---

### Previous note:
{{PREVIOUS_SUMMARY}}

### Messages being compacted:
{{COMPACTED_MESSAGES}}

### Messages still in context:
{{RECENT_MESSAGES}}"""


# Compaction needs enough conversation to be worth doing. Below this there is
# no older half to summarise into a note.
_MINIMUM_TURNS = 3


async def compact_messages_for_request(
    request,
    user,
    messages: list[dict],
    metadata: dict,
    model_id: str,
    models: dict,
    system_prompt: str = '',
    reserved_tokens: int = 0,
) -> tuple[list[dict], str | None, bool]:
    """Bring a request inside its window before it is sent.

    Returns the messages to send, the note that stands in for what was removed,
    and whether anything was actually compacted.

    Never raises. A compaction that fails still has to hand back a payload the
    provider will accept, so the deterministic reductions run either way --
    failing to summarise is a reason to lose detail, not to lose the turn.
    """
    config = await _load_config()
    if not config['enable']:
        return messages, None, False

    system_messages = [messages[0]] if messages and messages[0].get('role') == 'system' else []
    body = messages[1:] if system_messages else messages

    body, previous_summary = _apply_latest_summary_checkpoint(body)
    budget = await _resolve_request_budget(request, metadata, model_id, models, config)

    overhead = count_text_tokens(system_prompt, model_id) + count_text_tokens(previous_summary, model_id)
    tokens = _measure(body, model_id) + overhead + reserved_tokens

    if budget.usable <= 0 or tokens <= budget.trigger or len(split_into_turns(body)) < _MINIMUM_TURNS:
        return [*system_messages, *body], previous_summary, False

    # What the verbatim tail is allowed to weigh, once the note, the system
    # prompt and whatever the pipeline will add have taken their share.
    keep_budget = max(0, budget.target - overhead - reserved_tokens)
    boundary = _find_summary_boundary(body, keep_budget, model_id)
    compacted, recent = body[:boundary], body[boundary:]

    if not compacted or not recent:
        return [*system_messages, *body], previous_summary, False

    emit = await _make_emitter(metadata)
    await emit('Compacting context', done=False, tokens=tokens, budget=budget)

    try:
        await prime_encoder(model_id)
        summary = await _generate_summary(
            request, user, model_id, models, compacted, recent, previous_summary, config['prompt_template']
        )
    except Exception:
        # The turn still has to go out. Falling through to the deterministic
        # reductions loses detail; failing here would lose the answer.
        log.exception('context compaction could not summarise; reducing without a note')
        await emit('Context compaction failed', done=True, error=True)
        reduced, _ = fit_messages_to_window([*system_messages, *body], budget.usable - reserved_tokens, model_id)
        return reduced, previous_summary, False

    after = _measure(recent, model_id) + overhead + count_text_tokens(summary, model_id)
    record = {
        'summary': summary,
        'droppedMessages': len(compacted),
        'keptMessages': len(recent),
        'tokensBefore': tokens,
        'tokensAfter': after,
        'tokensFreed': max(0, tokens - after),
        'window': budget.window,
        'windowSource': budget.source,
        'model': model_id,
        'at': int(time.time()),
    }

    try:
        await _checkpoint(metadata, recent, summary, record)
    except Exception:
        # The note exists and is about to be used; only writing it down failed.
        # The cost is that the next turn compacts again, which is wasteful --
        # and far cheaper than losing an answer that is already paid for.
        log.exception('context compaction could not record its checkpoint')

    await emit('Context compacted', done=True, tokens=after, budget=budget, dropped=len(compacted))
    return [*system_messages, *recent], summary, True


async def enforce_context_window(
    request,
    form_data: dict,
    model: dict | None,
    metadata: dict | None = None,
) -> FitReport | None:
    """Last check before the request goes out, on the payload as it will be sent.

    Compaction runs early, on the messages loaded from the chat -- before
    knowledge, web results, skills and tool schemas are added. Those can be
    most of the payload, so a request calculated to fit can still be refused.
    And in a tool-call loop it is worse: results accumulate across iterations
    while nothing looks at the total again, which is how a long agentic turn
    walks past the window in the middle of working.

    So this runs on the finished payload, every time one is sent. It asks no
    model and awaits nothing on the hot path -- there is nowhere to await
    inside a streaming loop -- and it can only lose detail, never the turn.
    """
    messages = form_data.get('messages') or []
    if not messages:
        return None

    budget = resolve_budget(
        model=model,
        params=(metadata or {}).get('params') or {},
        request=request,
        model_id=form_data.get('model') or (model or {}).get('id'),
    )
    if budget.usable <= 0:
        # Nothing stated a window. Guessing one here would reduce a payload
        # against a limit that was never measured.
        return None

    spent = count_tools_tokens(form_data.get('tools'), form_data.get('model'))
    reduced, report = fit_messages_to_window(messages, budget.usable - spent, form_data.get('model'))
    if not report.steps:
        return report

    form_data['messages'] = reduced
    log.info(
        'context guard reduced payload for model=%s: %d -> %d tokens (%s)',
        form_data.get('model'),
        report.tokens_before,
        report.tokens_after,
        ', '.join(report.steps),
    )

    emit = await _make_emitter(metadata or {})
    await emit(
        'Trimmed context to fit' if report.fits else 'Context still over the window',
        done=True,
        tokens=report.tokens_after,
        budget=budget,
        freed=report.freed,
        error=not report.fits,
    )
    return report


async def _make_emitter(metadata: dict):
    """A way to tell the client what is happening, or a no-op when there is none.

    Compaction is invisible otherwise: the chat simply forgets, and the user is
    left to work out why.
    """
    if not (metadata.get('chat_id') and metadata.get('message_id')):

        async def silent(*_args, **_kwargs):
            return None

        return silent

    from open_webui.socket.main import get_event_emitter

    emitter = await get_event_emitter(metadata)

    async def emit(description: str, done: bool, **extra):
        if not emitter:
            return
        budget: ContextBudget | None = extra.pop('budget', None)
        data = {'action': 'context_compaction', 'description': description, 'done': done, **extra}
        if budget:
            data['window'] = budget.window
            data['usable'] = budget.usable
            data['window_source'] = budget.source
        await emitter({'type': 'context_compaction', 'data': data})

    return emit


async def _checkpoint(metadata: dict, recent: list[dict], summary: str, record: dict) -> None:
    """Record the note, and what it cost, against the message the history now starts at.

    Anchoring it to a message rather than to the chat is what lets a branch,
    a regeneration or an edit further up rebuild the same context: the note
    belongs to a point in the history, not to the conversation as a whole.

    The figures are stored beside the note rather than only logged. Compaction
    is a thing that happened to someone's conversation, and afterwards the only
    honest answer to "what did I lose here" is one the chat itself can give.
    """
    chat_id = metadata.get('chat_id')
    checkpoint_id = recent[0].get('id') or metadata.get('user_message_id') or metadata.get('message_id')
    if not (is_saved_chat_id(chat_id) and checkpoint_id):
        return

    await Chats.upsert_message_to_chat_by_id_and_message_id(
        chat_id,
        checkpoint_id,
        # contextSummary stays for the older readers that look for it.
        {'contextSummary': summary, 'contextCompaction': record},
        touch=False,
    )
    log.info(
        'compacted chat=%s checkpoint=%s dropped=%d kept=%d freed=%d note_chars=%d',
        chat_id,
        checkpoint_id,
        record['droppedMessages'],
        record['keptMessages'],
        record['tokensFreed'],
        len(summary),
    )


async def compact_chat_branch(request, user, chat: Any, model_id: str, models: dict) -> dict:
    """Compact a chat on request, rather than because it had to be.

    Everything before the newest message becomes a note. Deliberately more
    aggressive than the automatic path: someone asked for it.
    """
    config = await _load_config()
    if not config['enable']:
        return {'ok': True, 'compacted': False, 'reason': 'disabled'}

    current_id = _current_message_id(chat)
    if not current_id:
        return {'ok': True, 'compacted': False, 'reason': 'empty'}

    messages_map = await Chats.get_messages_map_by_chat_id(chat.id) or (chat.chat or {}).get('history', {}).get(
        'messages', {}
    )
    messages, previous_summary = _apply_latest_summary_checkpoint(get_message_list(messages_map, current_id))
    compacted, recent = messages[:-1], messages[-1:]
    if not compacted or not recent:
        return {'ok': True, 'compacted': False, 'reason': 'too_short'}

    summary = await _generate_summary(
        request, user, model_id, models, compacted, recent, previous_summary, config['prompt_template']
    )
    await Chats.upsert_message_to_chat_by_id_and_message_id(
        chat.id, current_id, {'contextSummary': summary}, touch=False
    )

    return {
        'ok': True,
        'compacted': True,
        'dropped_messages': len(compacted),
        'kept_messages': len(recent),
        'summary_chars': len(summary),
    }


async def _load_config() -> dict:
    values = await Config.get_many(
        'chat.context_compaction.enable',
        'chat.context_compaction.token_threshold',
        'chat.context_compaction.token_cap',
        'chat.context_compaction.retention_percentage',
        'chat.context_compaction.prompt_template',
    )
    return {
        'enable': bool(values.get('chat.context_compaction.enable', True)),
        # Zero means "work it out from the model", which is the default. A
        # number here is an administrator overriding detection on purpose.
        'token_threshold': _parse_positive_int(values.get('chat.context_compaction.token_threshold')) or 0,
        'token_cap': _parse_positive_int(values.get('chat.context_compaction.token_cap')) or 0,
        'retention_percentage': _clamp_retention_percentage(
            values.get('chat.context_compaction.retention_percentage')
        ),
        'prompt_template': values.get('chat.context_compaction.prompt_template', '') or '',
    }


def _parse_positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _clamp_retention_percentage(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = int(DEFAULT_RETENTION_RATIO * 100)
    return min(50, max(10, parsed))


async def _resolve_request_budget(request, metadata: dict, model_id: str, models: dict, config: dict) -> ContextBudget:
    """The budget for this request, from the model unless someone overrode it."""
    params = (metadata.get('params') or {}).copy()

    # A per-chat threshold beats the global one, and both beat detection.
    configured = _parse_positive_int(params.get('compact_token_threshold')) or config['token_threshold']
    if configured and config['token_cap']:
        configured = min(configured, config['token_cap'])

    # No fallback window on purpose. Assuming a small one for a model that
    # states nothing would compact a million-token model at six thousand
    # tokens -- mangling every long conversation to protect against an
    # overflow that was never going to happen. The harm is badly asymmetric,
    # so an unstated window means this does nothing and says so, and an
    # administrator who knows the number can set it above.
    return resolve_budget(
        model=(models or {}).get(model_id),
        params=params,
        request=request,
        model_id=model_id,
        configured_window=configured,
        trigger_ratio=DEFAULT_TRIGGER_RATIO,
        retention_ratio=config['retention_percentage'] / 100,
    )


def _measure(messages: list[dict], model_id: str | None) -> int:
    """How many tokens the history occupies, anchored where possible.

    A provider's own `prompt_tokens` is not an estimate: it is the model's
    tokenizer after the provider's own prompt assembly, which nothing this side
    of the wire can reproduce. Where a turn reported one, only what came after
    it has to be estimated -- which is why the estimator's error barely matters
    in a conversation that has been running.
    """
    for index in range(len(messages) - 1, -1, -1):
        usage = messages[index].get('usage') or (messages[index].get('info') or {}).get('usage')
        reported = usage_prompt_tokens(usage) + usage_completion_tokens(usage)
        if reported:
            return reported + count_messages_tokens(messages[index + 1 :], model_id)
    return count_messages_tokens(messages, model_id)


def _find_summary_boundary(messages: list[dict], keep_budget: int, model_id: str | None) -> int:
    """Where the note ends and the verbatim history begins.

    Whole turns, walked backwards until the tail fills its budget. Cutting on
    anything smaller strands a tool result from the call it answers, or half an
    assistant turn from the rest of it -- and a boundary picked by counting
    messages lands there exactly in the chats that need compacting most, where
    one turn ran twenty tools and the next was a sentence.
    """
    turns = split_into_turns(messages)
    if len(turns) < 2:
        return 0

    kept = 0
    total = 0
    # The last turn is kept whatever it weighs: it is the question being asked.
    for turn in reversed(turns):
        total += count_messages_tokens(turn.messages, model_id)
        if kept and total > keep_budget:
            break
        kept += 1

    # At least one turn has to go, or there was nothing to compact.
    kept = min(kept, len(turns) - 1)
    return turns[len(turns) - kept].start


def _apply_latest_summary_checkpoint(messages: list[dict]) -> tuple[list[dict], str | None]:
    """Resume from the newest note, discarding what it already replaced."""
    summary = None
    summary_index = None

    for index, message in enumerate(messages):
        value = message.get('contextSummary') or message.get('context_summary')
        if isinstance(value, str) and value.strip():
            summary = value
            summary_index = index

    if summary_index is None:
        return messages, None
    return messages[summary_index:], summary


def _current_message_id(chat: Any) -> str | None:
    chat_data = chat.chat or {}
    history = chat_data.get('history') or {}
    current = getattr(chat, 'current_message_id', None) or history.get('currentId')
    if not current:
        current = chat_data.get('currentId') or chat_data.get('branchPointMessageId')
    if not current and isinstance(chat_data.get('messages'), list) and chat_data['messages']:
        current = chat_data['messages'][-1].get('id')
    return current


async def get_chat_context_usage(chat: Any, model_id: str | None = None, request=None) -> dict | None:
    """What the context meter shows: how full the window is, and how big it is."""
    current_id = _current_message_id(chat)
    if not current_id:
        return None

    messages_map = await Chats.get_messages_map_by_chat_id(chat.id) or (chat.chat or {}).get('history', {}).get(
        'messages', {}
    )
    messages = get_message_list(messages_map, current_id)
    if not messages:
        return None

    config = await _load_config()
    params = ((chat.chat or {}).get('params') or {}).copy()
    if model_id:
        params['model'] = model_id

    models = getattr(request.app.state, 'MODELS', {}) if request else {}
    budget = await _resolve_request_budget(request, {'params': params}, model_id or '', models, config)

    messages, previous_summary = _apply_latest_summary_checkpoint(messages)
    tokens = _measure(messages, model_id) + count_text_tokens(previous_summary, model_id)

    return {
        'tokens': tokens,
        'estimated_tokens': tokens,
        'threshold': budget.usable,
        'window': budget.window,
        'window_source': budget.source,
        'percent': budget.percent(tokens),
        'source': 'estimated',
        'enabled': config['enable'],
    }


async def _generate_summary(
    request,
    user,
    model_id: str,
    models: dict,
    compacted_messages: list[dict],
    recent_messages: list[dict],
    previous_summary: str | None,
    summary_prompt_template: str,
) -> str:
    from open_webui.utils.chat import generate_chat_completion

    task_config = await Config.get_many('task.model.params', 'chat.context_compaction.model')
    configured_model = task_config.get('chat.context_compaction.model')
    task_model_id = configured_model if configured_model in models else model_id
    if task_model_id not in models:
        raise ValueError('No available model for context compaction')

    summary_prompt_template = summary_prompt_template.strip() or DEFAULT_CONTEXT_COMPACTION_PROMPT
    all_messages = [*compacted_messages, *recent_messages]
    prompt = replace_prompt_variable(summary_prompt_template, get_last_user_message(all_messages) or '')
    prompt = replace_messages_variable(prompt, all_messages)
    prompt = replace_messages_variable(prompt, compacted_messages, 'COMPACTED_MESSAGES')
    prompt = replace_messages_variable(prompt, recent_messages, 'RECENT_MESSAGES')
    first_note = previous_summary or '(none — this conversation has not been compacted before)'
    prompt = prompt_variables_template(prompt, {'{{PREVIOUS_SUMMARY}}': first_note})
    prompt = await prompt_template(prompt, user)

    task_model_params = task_config.get('task.model.params') or {}
    if not isinstance(task_model_params, dict):
        task_model_params = {}
    task_model_params = {key: value for key, value in task_model_params.items() if value is not None and value != ''}
    task_model_params = task_model_params or {
        'max_tokens': models[task_model_id].get('info', {}).get('params', {}).get('max_tokens', 2000)
    }

    payload = {
        'model': task_model_id,
        'messages': [{'role': 'user', 'content': prompt}],
        'stream': False,
        'metadata': {
            **(request.state.metadata if hasattr(request.state, 'metadata') else {}),
            'task': 'context_compaction',
        },
    }

    payload = apply_params_to_form_data(payload, models[task_model_id], task_model_params)
    response = await generate_chat_completion(request, form_data=payload, user=user)
    summary = _response_text(response).strip()
    if summary:
        return summary

    return _transcript_fallback(compacted_messages, previous_summary)


def _transcript_fallback(compacted_messages: list[dict], previous_summary: str | None) -> str:
    """What stands in when the model returned nothing.

    A truncated transcript is a poor note, but it is made of things that were
    actually said. Returning nothing would silently drop the whole span.
    """
    parts = [previous_summary] if previous_summary else []
    for message in compacted_messages:
        content = get_content_from_message(message)
        if content:
            parts.append(f'- {message.get("role", "unknown")}: {content[:500]}')
    return '\n'.join(parts)[:4000]


def _response_text(response: Any) -> str:
    if isinstance(response, list) and len(response) == 1:
        response = response[0]

    if isinstance(response, JSONResponse):
        try:
            response = JSONCodec.loads(response.body.decode('utf-8', 'replace'))
        except Exception:
            return ''

    if not isinstance(response, dict):
        return ''

    choices = response.get('choices') or []
    if choices:
        message = choices[0].get('message') or {}
        return message.get('content') or message.get('reasoning_content') or ''

    parts = []
    for item in response.get('output') or []:
        for content in item.get('content') or []:
            if isinstance(content, dict):
                parts.append(content.get('text') or content.get('content') or '')
    return '\n'.join(part for part in parts if part)
