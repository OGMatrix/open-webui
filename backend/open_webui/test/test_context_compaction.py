"""Where compaction cuts, and what it counts before deciding to.

The orchestration talks to a database and a model, so what is checked here is
the part that decides: the boundary, the measurement, and resuming from an
earlier note.
"""

from open_webui.utils.context_compaction import (
    DEFAULT_CONTEXT_COMPACTION_PROMPT,
    _apply_latest_summary_checkpoint,
    _find_summary_boundary,
    _measure,
    _transcript_fallback,
)
from open_webui.utils.token_counter import count_messages_tokens


def user(text='ask', **extra):
    return {'role': 'user', 'content': text, **extra}


def assistant(text='answer', **extra):
    return {'role': 'assistant', 'content': text, **extra}


def big(words=200):
    return 'a plausible sentence of ordinary conversational text ' * words


class TestBoundary:
    def test_cuts_between_turns_never_inside_one(self):
        messages = [
            user('one'),
            assistant('', tool_calls=[{'id': 'c1', 'function': {'name': 'search', 'arguments': '{}'}}]),
            {'role': 'tool', 'tool_call_id': 'c1', 'content': 'hits'},
            assistant('found it'),
            user('two'),
            assistant('answer two'),
        ]
        boundary = _find_summary_boundary(messages, keep_budget=20, model_id=None)
        assert messages[boundary]['role'] == 'user'

    def test_keeps_as_many_recent_turns_as_the_budget_allows(self):
        messages = [item for i in range(6) for item in (user(f'q{i} ' + big(40)), assistant(f'a{i}'))]
        generous = _find_summary_boundary(messages, keep_budget=count_messages_tokens(messages), model_id=None)
        tight = _find_summary_boundary(messages, keep_budget=50, model_id=None)
        assert generous < tight

    def test_always_leaves_at_least_one_turn_to_compact(self):
        # A boundary of zero would mean summarising nothing and changing
        # nothing, while still paying for the model call.
        messages = [item for i in range(4) for item in (user(f'q{i}'), assistant(f'a{i}'))]
        boundary = _find_summary_boundary(messages, keep_budget=10_000_000, model_id=None)
        assert boundary > 0

    def test_always_keeps_the_question_being_asked(self):
        # Even when the last turn alone is over budget: without it there is
        # nothing to answer.
        messages = [user('old'), assistant('a'), user(big(2000))]
        boundary = _find_summary_boundary(messages, keep_budget=10, model_id=None)
        assert boundary < len(messages)
        assert messages[boundary]['content'].startswith('a plausible sentence')

    def test_a_conversation_too_short_to_split_is_not_cut(self):
        assert _find_summary_boundary([user('only')], keep_budget=1, model_id=None) == 0
        assert _find_summary_boundary([], keep_budget=1, model_id=None) == 0


class TestMeasuring:
    def test_prefers_what_the_provider_actually_billed(self):
        # Not an estimate: the model's own tokenizer, after the provider's own
        # prompt assembly, which nothing this side of the wire reproduces.
        messages = [
            user('hello'),
            assistant('hi', usage={'prompt_tokens': 5000, 'completion_tokens': 100}),
        ]
        assert _measure(messages, None) == 5100

    def test_estimates_only_what_came_after_the_last_report(self):
        anchored = [
            user('hello'),
            assistant('hi', usage={'prompt_tokens': 5000, 'completion_tokens': 100}),
            user(big(50)),
        ]
        measured = _measure(anchored, None)
        assert measured > 5100
        assert measured < 5100 + count_messages_tokens([anchored[2]], None) + 20

    def test_reads_usage_from_where_the_frontend_stores_it(self):
        assert _measure([assistant('hi', info={'usage': {'prompt_eval_count': 800}})], None) == 800

    def test_estimates_everything_when_no_turn_reported_usage(self):
        messages = [user('hello'), assistant('hi')]
        assert _measure(messages, None) == count_messages_tokens(messages, None)

    def test_nothing_measures_as_nothing(self):
        assert _measure([], None) == 0


class TestResumingFromANote:
    def test_starts_at_the_newest_note_and_drops_what_it_replaced(self):
        messages = [
            user('ancient'),
            assistant('old'),
            user('recent', contextSummary='what came before'),
            assistant('new'),
        ]
        kept, summary = _apply_latest_summary_checkpoint(messages)
        assert summary == 'what came before'
        assert [m['content'] for m in kept] == ['recent', 'new']

    def test_the_newest_note_wins_when_a_chat_was_compacted_twice(self):
        messages = [
            user('a', contextSummary='first note'),
            assistant('b'),
            user('c', contextSummary='second note'),
            assistant('d'),
        ]
        kept, summary = _apply_latest_summary_checkpoint(messages)
        assert summary == 'second note'
        assert len(kept) == 2

    def test_reads_the_snake_case_spelling_too(self):
        _, summary = _apply_latest_summary_checkpoint([user('a', context_summary='note')])
        assert summary == 'note'

    def test_an_empty_note_is_not_a_note(self):
        kept, summary = _apply_latest_summary_checkpoint([user('a', contextSummary='   '), assistant('b')])
        assert summary is None
        assert len(kept) == 2

    def test_a_chat_that_was_never_compacted_is_returned_whole(self):
        messages = [user('a'), assistant('b')]
        kept, summary = _apply_latest_summary_checkpoint(messages)
        assert kept is messages
        assert summary is None


class TestThePrompt:
    # The prompt is hard-wrapped in the source, so an instruction can fall
    # across two lines. What is being checked is that the instruction is there,
    # not where the line breaks landed.
    FLAT = ' '.join(DEFAULT_CONTEXT_COMPACTION_PROMPT.split())

    def test_carries_every_variable_the_template_substitutes(self):
        for variable in ('{{PREVIOUS_SUMMARY}}', '{{COMPACTED_MESSAGES}}', '{{RECENT_MESSAGES}}'):
            assert variable in DEFAULT_CONTEXT_COMPACTION_PROMPT

    def test_says_to_carry_the_previous_note_forward_rather_than_resummarise_it(self):
        # The instruction that stops a long chat from decaying: each note is
        # written against the last one, not against a copy of a copy.
        assert 'equal standing' in self.FLAT
        assert 'copy of a copy' in self.FLAT

    def test_forbids_inventing_what_was_not_there(self):
        assert 'Do not invent' in self.FLAT

    def test_asks_for_identifiers_verbatim(self):
        assert 'character for character' in self.FLAT

    def test_asks_for_what_was_tried_and_abandoned(self):
        # Without it the assistant repeats work the conversation already ruled
        # out, which is the failure users notice first after a compaction.
        assert 'abandoned' in self.FLAT

    def test_names_the_sections_it_wants_back(self):
        for heading in ('Established facts', 'Decisions and rationale', 'Open questions and next steps'):
            assert f'### {heading}' in DEFAULT_CONTEXT_COMPACTION_PROMPT


class TestFallbackWhenTheModelSaysNothing:
    def test_returns_things_that_were_actually_said(self):
        note = _transcript_fallback([user('remember the port is 8080'), assistant('noted')], None)
        assert '8080' in note

    def test_keeps_an_earlier_note_at_the_front(self):
        note = _transcript_fallback([user('later')], 'the earlier note')
        assert note.startswith('the earlier note')

    def test_stays_bounded(self):
        note = _transcript_fallback([user(big(500)) for _ in range(40)], None)
        assert len(note) <= 4000
