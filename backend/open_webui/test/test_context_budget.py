"""What a request is allowed to spend, and why it is less than the window."""

from open_webui.utils.context_budget import (
    DEFAULT_RETENTION_RATIO,
    DEFAULT_TRIGGER_RATIO,
    resolve_budget,
)


class TestReserves:
    def test_the_window_is_not_the_budget(self):
        # Room for the answer and room for being wrong both come out first.
        budget = resolve_budget({'context_length': 32768})
        assert budget.usable < budget.window
        assert budget.output_reserve > 0
        assert budget.safety_reserve > 0

    def test_an_explicit_generation_limit_is_the_room_reserved(self):
        budget = resolve_budget({'context_length': 32768}, {'max_tokens': 8000})
        assert budget.output_reserve == 8000

    def test_a_generation_limit_larger_than_the_window_is_a_setting_not_a_fact(self):
        # Reserving it literally would leave nothing to send.
        budget = resolve_budget({'context_length': 8192}, {'max_tokens': 100000})
        assert budget.output_reserve == 4096
        assert budget.usable > 0

    def test_a_small_window_reserves_proportionally_less(self):
        # Holding 4096 back on an 8k model would spend half the window on a
        # reply that may be one sentence.
        small = resolve_budget({'context_length': 8192})
        large = resolve_budget({'context_length': 200000})
        assert small.output_reserve < large.output_reserve
        assert small.output_reserve / small.window < 0.2


class TestTrigger:
    def test_fires_late_rather_than_early(self):
        # Compacting early costs a model call and the provider's cached prefix,
        # and published comparisons put full history ahead of summarisation on
        # cost, latency and recall together until the window is nearly full.
        budget = resolve_budget({'context_length': 32768})
        assert budget.trigger / budget.window > 0.6
        assert budget.trigger < budget.usable

    def test_leaves_room_to_grow_after_compacting(self):
        # Compacting down to just under the trigger would compact again on the
        # very next message, paying a model call and a cache miss each time.
        budget = resolve_budget({'context_length': 32768})
        assert budget.target < budget.trigger / 2

    def test_the_ratios_are_the_documented_ones(self):
        budget = resolve_budget({'context_length': 100_000}, {'max_tokens': 1})
        assert budget.trigger == int(budget.usable * DEFAULT_TRIGGER_RATIO)
        assert budget.target == int(budget.usable * DEFAULT_RETENTION_RATIO)


class TestWhereTheNumberCameFrom:
    def test_says_when_the_model_stated_its_own_window(self):
        assert resolve_budget({'context_length': 32768}).source == 'model'

    def test_an_administrator_override_wins_and_is_labelled(self):
        budget = resolve_budget({'context_length': 200000}, configured_window=16384)
        assert budget.window == 16384
        assert budget.source == 'configured'
        assert not budget.known

    def test_admits_when_nothing_stated_a_window(self):
        # Zero usable is how the caller knows not to reduce anything: a limit
        # nobody measured is not a limit to throw context away for.
        budget = resolve_budget({})
        assert budget.source == 'unknown'
        assert budget.usable == 0
        assert budget.trigger == 0

    def test_a_fallback_is_used_only_when_the_caller_offers_one(self):
        assert resolve_budget({}, fallback_window=8192).source == 'fallback'
        assert resolve_budget({}, fallback_window=8192).usable > 0
        assert resolve_budget({}).usable == 0


class TestPercent:
    def test_reports_fullness_against_what_is_usable(self):
        budget = resolve_budget({'context_length': 32768})
        assert budget.percent(budget.usable) == 100
        assert budget.percent(0) == 0
        assert 40 <= budget.percent(budget.usable // 2) <= 60

    def test_an_unknown_window_reports_nothing_rather_than_zero_percent_full(self):
        assert resolve_budget({}).percent(50_000) == 0
