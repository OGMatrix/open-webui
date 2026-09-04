"""Making a payload fit, without asking a model to rewrite it.

Summarising is the expensive way to free context and the only one that loses
meaning: a summary is a lossy rewrite, it costs a model call, and it destroys
the provider's cached prefix so the whole conversation is billed again at full
rate. Published measurements put recall after repeated summarisation near a
third of what keeping the history achieves, while the answers still read
fluently -- the loss does not announce itself.

So summarising is the last step, not the first. Before it there are two
reductions that free a great deal and lose almost nothing:

  reasoning   Thinking blocks from earlier turns. Most providers will not
              accept them back anyway, and no later turn depends on them.
  tool results  The twenty search hits the model already read and acted on.
              Anthropic's own context editing clears exactly these first.

Everything here is pure and synchronous: given messages and a budget it
returns messages that fit. That is what lets it run in the two places that
matter -- before the first request, and inside the tool-call loop where the
payload grows between iterations and there is no room to await anything.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from open_webui.utils.token_counter import count_message_tokens, count_messages_tokens

log = logging.getLogger(__name__)

# How many of the most recent tool results survive untouched.
#
# Three is what Anthropic's clear_tool_uses defaults to, and it matches how
# tool results are used: the model reads a result, acts on it, and from then on
# refers to what it concluded rather than the raw output.
DEFAULT_KEEP_TOOL_RESULTS = 3

# Reasoning from this many recent assistant turns is kept.
DEFAULT_KEEP_REASONING_TURNS = 1

# A single tool result larger than this is trimmed to its head and tail even
# when it is recent -- one accidental `cat` of a large file should not cost the
# conversation everything before it.
DEFAULT_MAX_RESULT_TOKENS = 8000

_REASONING_FIELDS = ('reasoning', 'reasoning_content', 'thinking')


@dataclass
class FitReport:
    """What had to be given up to make the payload fit."""

    fits: bool = False
    tokens_before: int = 0
    tokens_after: int = 0
    reasoning_cleared: int = 0
    tool_results_cleared: int = 0
    tool_results_trimmed: int = 0
    turns_dropped: int = 0
    steps: list[str] = field(default_factory=list)

    @property
    def freed(self) -> int:
        return max(0, self.tokens_before - self.tokens_after)


@dataclass
class Turn:
    """A user message and everything the assistant did in reply to it.

    The unit compaction is allowed to cut on. Cutting anywhere else orphans a
    tool result from the call it answers, which providers reject outright, or
    strands half an assistant turn -- the reason a boundary chosen by counting
    messages goes wrong exactly in the chats that need compacting most.
    """

    start: int
    end: int  # exclusive
    messages: list[dict]

    @property
    def length(self) -> int:
        return self.end - self.start


def split_into_turns(messages: list[dict]) -> list[Turn]:
    """Group a message list into whole turns.

    A turn begins at a user message. Anything before the first one -- a system
    message, or an assistant greeting -- forms a turn of its own so that no
    message is silently outside the grouping.
    """
    starts = [index for index, message in enumerate(messages) if message.get('role') == 'user']
    if not starts:
        return [Turn(0, len(messages), messages)] if messages else []

    boundaries = ([0] if starts[0] != 0 else []) + starts
    turns = []
    for position, start in enumerate(boundaries):
        end = boundaries[position + 1] if position + 1 < len(boundaries) else len(messages)
        turns.append(Turn(start, end, messages[start:end]))
    return turns


def _is_tool_result(message: dict) -> bool:
    return message.get('role') == 'tool' or bool(message.get('tool_call_id'))


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(str(part.get('text') or part.get('content') or ''))
            else:
                parts.append(str(part))
        return '\n'.join(parts)
    return '' if content is None else str(content)


def _tool_name(message: dict, messages: list[dict]) -> str:
    """The name of the tool a result belongs to.

    A tool message sometimes carries it, and when it does not the call it
    answers does -- worth finding, because "[search_web result removed]" tells
    the model something and "[tool result removed]" does not.
    """
    if message.get('name'):
        return str(message['name'])

    call_id = message.get('tool_call_id')
    if not call_id:
        return 'tool'

    for candidate in messages:
        for call in candidate.get('tool_calls') or []:
            if isinstance(call, dict) and call.get('id') == call_id:
                return str((call.get('function') or {}).get('name') or 'tool')
    return 'tool'


def clear_reasoning(messages: list[dict], keep_turns: int = DEFAULT_KEEP_REASONING_TURNS) -> tuple[list[dict], int]:
    """Drop thinking blocks from all but the most recent assistant turns.

    Nothing later in the conversation refers to them, and most providers
    discard replayed reasoning rather than reading it. Returns the messages and
    how many blocks were dropped.
    """
    assistant_indices = [index for index, message in enumerate(messages) if message.get('role') == 'assistant']
    protected = set(assistant_indices[-keep_turns:]) if keep_turns > 0 else set()

    result = []
    cleared = 0
    for index, message in enumerate(messages):
        if index in protected or not any(message.get(field) for field in _REASONING_FIELDS):
            result.append(message)
            continue
        stripped = {key: value for key, value in message.items() if key not in _REASONING_FIELDS}
        cleared += 1
        result.append(stripped)
    return result, cleared


def _placeholder(name: str, tokens: int) -> str:
    return f'[{name} result cleared from context to make room — about {tokens:,} tokens]'


def _trimmed(text: str, name: str, keep_chars: int) -> str:
    half = max(1, keep_chars // 2)
    head = text[:half].rstrip()
    tail = text[-half:].lstrip()
    removed = len(text) - len(head) - len(tail)
    return f'{head}\n\n[… {removed:,} characters of the {name} result trimmed …]\n\n{tail}'


def trim_oversized_results(
    messages: list[dict],
    max_tokens: int = DEFAULT_MAX_RESULT_TOKENS,
    model_id: str | None = None,
) -> tuple[list[dict], int]:
    """Cut any single tool result that is large enough to dominate the window.

    Head and tail are kept because that is where a result says what it is and
    how it ended; the bulk in between is what makes it unaffordable.
    """
    result = []
    trimmed = 0
    for message in messages:
        tokens = count_message_tokens(message, model_id) if _is_tool_result(message) else 0
        if tokens <= max_tokens:
            result.append(message)
            continue

        text = _content_text(message.get('content'))
        # How many characters that budget buys, at this message's own density.
        # Deriving it rather than assuming four characters per token is what
        # keeps a CJK or base64 result from being "trimmed" to something longer
        # than it started: those run near one character per token.
        keep_chars = int(len(text) * max_tokens / tokens)
        if not text or keep_chars >= len(text):
            result.append(message)
            continue

        result.append({**message, 'content': _trimmed(text, _tool_name(message, messages), keep_chars)})
        trimmed += 1
    return result, trimmed


def clear_tool_results(
    messages: list[dict],
    keep_last: int = DEFAULT_KEEP_TOOL_RESULTS,
    model_id: str | None = None,
) -> tuple[list[dict], int]:
    """Replace older tool results with a note saying what was there.

    The message itself stays, with its role and tool_call_id, because removing
    it would orphan the call it answers and providers reject that. Only the
    payload the model has already read goes.
    """
    indices = [index for index, message in enumerate(messages) if _is_tool_result(message)]
    clearable = indices[:-keep_last] if keep_last > 0 else indices
    if not clearable:
        return messages, 0

    clearable_set = set(clearable)
    result = []
    cleared = 0
    for index, message in enumerate(messages):
        if index not in clearable_set:
            result.append(message)
            continue

        tokens = count_message_tokens(message, model_id)
        # Clearing something already tiny costs a cache invalidation and frees
        # nothing worth having.
        if tokens < 64:
            result.append(message)
            continue

        result.append({**message, 'content': _placeholder(_tool_name(message, messages), tokens)})
        cleared += 1
    return result, cleared


def fit_messages_to_window(
    messages: list[dict],
    budget: int,
    model_id: str | None = None,
    keep_tool_results: int = DEFAULT_KEEP_TOOL_RESULTS,
    max_result_tokens: int = DEFAULT_MAX_RESULT_TOKENS,
) -> tuple[list[dict], FitReport]:
    """Reduce a payload until it fits, cheapest loss first.

    Never calls a model and never awaits, so it can run immediately before the
    request goes out -- including inside the tool-call loop, where the payload
    grows with every iteration and the older approach only ever looked once,
    before the loop began.

    The last step drops whole turns. That is worse than summarising them, and
    it only happens when there was no chance to summarise: a request that would
    otherwise be refused outright is still better answered from its recent
    turns than not answered at all.
    """
    report = FitReport(tokens_before=count_messages_tokens(messages, model_id))
    report.tokens_after = report.tokens_before

    # A budget of zero means no window is known, not a window of nothing.
    # Reducing a payload against a limit nobody stated would throw away
    # context to satisfy a number that was never measured.
    if budget <= 0 or report.tokens_before <= budget:
        report.fits = True
        return messages, report

    # Rungs, cheapest loss first. Each returns the reduced messages and how
    # many things it changed; the walk stops at the first one that fits.
    #
    # Clearing every tool result comes before dropping turns on purpose: a
    # cleared result inside a turn that stays keeps the question, the answer
    # and the fact that a tool ran, where dropping the turn keeps none of them.
    rungs = (
        (
            'trimmed oversized tool results',
            'tool_results_trimmed',
            lambda m: trim_oversized_results(m, max_result_tokens, model_id),
        ),
        ('cleared replayed reasoning', 'reasoning_cleared', clear_reasoning),
        (
            'cleared older tool results',
            'tool_results_cleared',
            lambda m: clear_tool_results(m, keep_tool_results, model_id),
        ),
        ('cleared every tool result', 'tool_results_cleared', lambda m: clear_tool_results(m, 0, model_id)),
        ('dropped oldest turns', 'turns_dropped', lambda m: _drop_oldest_turns(m, budget, model_id)),
    )

    for label, counter, reduce in rungs:
        messages, changed = reduce(messages)
        if changed:
            setattr(report, counter, getattr(report, counter) + changed)
            report.steps.append(label)
        report.tokens_after = count_messages_tokens(messages, model_id)
        if report.tokens_after <= budget:
            report.fits = True
            return messages, report

    return messages, report


def _drop_oldest_turns(messages: list[dict], budget: int, model_id: str | None) -> tuple[list[dict], int]:
    """Remove whole turns from the front until what is left fits.

    System messages are never dropped: they are the instructions the answer is
    supposed to follow, and a request that fits but ignores them has not been
    saved. The most recent turn is never dropped either -- without it there is
    no question to answer.
    """
    system = [message for message in messages if message.get('role') == 'system']
    body = [message for message in messages if message.get('role') != 'system']

    turns = split_into_turns(body)
    if len(turns) <= 1:
        return messages, 0

    kept = turns
    while len(kept) > 1:
        kept = kept[1:]
        candidate = [*system, *[message for turn in kept for message in turn.messages]]
        if count_messages_tokens(candidate, model_id) <= budget:
            return candidate, len(turns) - len(kept)

    # Down to the last turn and still over. Nothing further can be given up
    # without losing the question itself, so this is what the caller gets.
    return [*system, *kept[0].messages], len(turns) - 1
