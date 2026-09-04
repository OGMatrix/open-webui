"""How large a model's context window is, from whoever will say.

Compaction cannot budget against a number nobody supplied. Open WebUI used a
fixed 80,000 tokens for every model, which is wrong in both directions: on a
32k local model the request overflows long before compaction fires, and on a
million-token model two thirds of the window is thrown away unread.

Nobody agrees on where to state the size, so this looks everywhere it is
known to appear. The frontend does the same in src/lib/utils/contextWindow.ts,
against the same model objects -- the backend keeps each provider's raw model
document and hands it to the client untouched -- and the two are kept in step
deliberately: a user who sees 32k in the context meter should get compaction
budgeted against 32k.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

# What to assume when nothing states a size.
#
# Not a guess at the model: a floor. Almost every model served today has at
# least this, and being wrong low only means compacting earlier than needed,
# which is the recoverable direction.
DEFAULT_CONTEXT_WINDOW = 8192


def _as_window(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return None
    if not isinstance(value, (int, float)):
        return None
    return int(value) if value > 0 else None


def _first_window(*values: Any) -> int | None:
    for value in values:
        window = _as_window(value)
        if window:
            return window
    return None


def _from_llamacpp_args(status: Any) -> int | None:
    """A llama.cpp router lists each model with the command line it runs.

    The router's own /props reports n_ctx 0 because the router serves no model
    itself, so the per-model size appears only in the --ctx-size argument.
    """
    args = status.get('args') if isinstance(status, dict) else None
    if not isinstance(args, list):
        return None
    for index in range(len(args) - 1):
        if args[index] in ('--ctx-size', '-c'):
            window = _as_window(args[index + 1])
            if window:
                return window
    return None


def _from_ollama_model_info(model_info: Any) -> int | None:
    """Ollama states it under an architecture-prefixed key, e.g. qwen3.context_length."""
    if not isinstance(model_info, dict):
        return None
    for key, value in model_info.items():
        if key == 'context_length' or key.endswith('.context_length'):
            window = _as_window(value)
            if window:
                return window
    return None


def _probed_window(model_id: str, request: Any) -> int | None:
    """What the serving process said when it was last asked.

    llama.cpp reports the size the server was actually started with, which
    beats the model's trained length: a 128k model served with --ctx-size 8192
    has 8192 tokens, and the trained figure would overflow it every time.
    """
    if not request or not model_id:
        return None

    try:
        from open_webui.routers.openai import recall_capabilities

        openai_models = getattr(request.app.state, 'OPENAI_MODELS', None) or {}
        model = openai_models.get(model_id)
        if not isinstance(model, dict) or 'urlIdx' not in model:
            return None
        return _as_window((recall_capabilities(model['urlIdx'], model_id) or {}).get('context_length'))
    except Exception as error:
        # A probe that cannot be recalled is not an error; it is one source of
        # several, and the others still answer.
        log.debug('could not recall probed capabilities for %s: %s', model_id, error)
        return None


def get_context_window(
    model: dict | None,
    params: dict | None = None,
    request: Any = None,
    model_id: str | None = None,
) -> int | None:
    """The model's context window in tokens, or None when nothing states it.

    `params` are the chat's own settings and outrank every provider: a user who
    pinned num_ctx meant it, and Ollama will honour it over the trained size.
    """
    explicit = _first_window(
        (params or {}).get('num_ctx'),
        (params or {}).get('max_context_length'),
        ((model or {}).get('info') or {}).get('params', {}).get('num_ctx'),
    )
    if explicit:
        return explicit

    probed = _probed_window(model_id or (model or {}).get('id') or '', request)
    if probed:
        return probed

    model = model or {}
    return _first_window(
        _from_llamacpp_args(model.get('status')),
        model.get('context_length'),
        model.get('max_context_length'),
        model.get('max_model_len'),
        (model.get('meta') or {}).get('n_ctx_train'),
        (model.get('meta') or {}).get('n_ctx'),
        model.get('n_ctx'),
        _from_ollama_model_info((model.get('ollama') or {}).get('model_info')),
        _from_ollama_model_info((model.get('ollama') or {}).get('details')),
        _from_ollama_model_info(model.get('model_info')),
        ((model.get('info') or {}).get('meta') or {}).get('context_length'),
    )


def get_max_output_tokens(model: dict | None, params: dict | None = None) -> int | None:
    """How much the model may generate, which the input has to leave room for."""
    return _first_window(
        (params or {}).get('max_tokens'),
        (params or {}).get('max_completion_tokens'),
        (params or {}).get('num_predict'),
        ((model or {}).get('info') or {}).get('params', {}).get('max_tokens'),
        (model or {}).get('max_output_tokens'),
        ((model or {}).get('top_provider') or {}).get('max_completion_tokens'),
    )
