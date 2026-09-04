"""How much of a model's window a request is actually allowed to use.

The window is not the budget. A request has to leave room for the answer, and
it has to leave room for being wrong about its own size -- the provider
assembles the prompt with a chat template nobody here can see, and the count
this side of the wire is a good estimate rather than the truth. Both reserves
come out before anything is spent.

Firing early is not free either. Under prompt caching a summary rewrites the
cached prefix, so the conversation is billed again from the beginning; the
published comparisons put full history ahead of summarisation on cost, latency
and recall together, and only find compaction worth it near the wall. So the
trigger sits high, and when it does fire it clears enough to be worth the cache
it just threw away.
"""

from __future__ import annotations

from dataclasses import dataclass

from open_webui.utils.context_window import get_context_window, get_max_output_tokens

# Fraction of the usable budget at which compaction fires.
#
# High, deliberately: everything below this point is cheaper to keep than to
# rewrite. The remaining room covers the summary request itself and the turn
# that arrives while it runs.
DEFAULT_TRIGGER_RATIO = 0.85

# Fraction of the usable budget that stays as verbatim recent turns.
#
# What is left over is the room the next several turns grow into. Compacting
# down to just under the trigger would mean compacting again on the very next
# message, paying a model call and a cache miss each time.
DEFAULT_RETENTION_RATIO = 0.40

# Room kept for the answer when no generation limit is set. A window has to
# leave more than a sentence, and on a small window a quarter of it is already
# a long reply.
_OUTPUT_RESERVE_CAP = 4096
_OUTPUT_RESERVE_FLOOR = 512
_OUTPUT_RESERVE_DIVISOR = 8

# Room kept for being wrong. The estimator's worst measured undercount is about
# 17% on a whole message, but the count is normally anchored to the provider's
# own figure for everything but the last turn or two, so the exposure is far
# smaller than that. Five percent with a floor covers it and the provider's
# own template overhead.
_SAFETY_RESERVE_RATIO = 0.05
_SAFETY_RESERVE_FLOOR = 256


@dataclass(frozen=True)
class ContextBudget:
    """What a request may spend, and where the number came from."""

    window: int
    usable: int
    output_reserve: int
    safety_reserve: int
    trigger: int
    target: int
    source: str

    @property
    def known(self) -> bool:
        """Whether a model actually stated its window, or this is a fallback."""
        return self.source == 'model'

    def percent(self, tokens: int) -> int:
        return round(tokens / self.usable * 100) if self.usable > 0 else 0


def resolve_budget(
    model: dict | None,
    params: dict | None = None,
    request=None,
    model_id: str | None = None,
    configured_window: int | None = None,
    trigger_ratio: float = DEFAULT_TRIGGER_RATIO,
    retention_ratio: float = DEFAULT_RETENTION_RATIO,
    fallback_window: int | None = None,
) -> ContextBudget:
    """Work out the budget for one request.

    `configured_window` is an administrator's explicit token threshold, which
    wins over detection because someone chose it on purpose. `fallback_window`
    is what to assume when neither detection nor configuration answers -- the
    caller decides whether to guess at all, so a missing window is never
    silently replaced by an invented one.
    """
    detected = get_context_window(model, params, request, model_id)

    if configured_window and configured_window > 0:
        window, source = configured_window, 'configured'
    elif detected:
        window, source = detected, 'model'
    elif fallback_window and fallback_window > 0:
        window, source = fallback_window, 'fallback'
    else:
        return ContextBudget(0, 0, 0, 0, 0, 0, 'unknown')

    output_reserve = get_max_output_tokens(model, params) or min(
        _OUTPUT_RESERVE_CAP, max(_OUTPUT_RESERVE_FLOOR, window // _OUTPUT_RESERVE_DIVISOR)
    )
    # A generation limit larger than the window is a setting, not a fact; it
    # would leave nothing to send.
    output_reserve = min(output_reserve, window // 2)
    safety_reserve = max(_SAFETY_RESERVE_FLOOR, int(window * _SAFETY_RESERVE_RATIO))

    usable = max(0, window - output_reserve - safety_reserve)
    return ContextBudget(
        window=window,
        usable=usable,
        output_reserve=output_reserve,
        safety_reserve=safety_reserve,
        trigger=int(usable * trigger_ratio),
        target=int(usable * retention_ratio),
        source=source,
    )
