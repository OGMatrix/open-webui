"""The orchestration end to end, with the model call and the database stubbed.

Everything else about compaction is pure and tested that way. What is left is
the wiring -- when it fires, what it hands back, and what it does when the
summary cannot be produced -- and that is where the bugs that lose a turn live.
"""

import pytest
from open_webui.utils import context_compaction as cc
from open_webui.utils.token_counter import count_messages_tokens


def user(text, **extra):
    return {'role': 'user', 'content': text, **extra}


def assistant(text, **extra):
    return {'role': 'assistant', 'content': text, **extra}


def big(words=300):
    return 'a plausible sentence of ordinary conversational text ' * words


def conversation(turns=8, size=300):
    return [item for i in range(turns) for item in (user(f'question {i} ' + big(size)), assistant(f'answer {i}'))]


@pytest.fixture
def stubbed(monkeypatch):
    """Compaction with its outside world replaced by things that record calls."""
    state = {'summaries': 0, 'checkpoints': [], 'events': [], 'fail': False}

    async def load_config():
        return {
            'enable': True,
            'token_threshold': 0,
            'token_cap': 0,
            'retention_percentage': 40,
            'prompt_template': '',
        }

    async def generate_summary(*args, **kwargs):
        state['summaries'] += 1
        if state['fail']:
            raise RuntimeError('the task model is unreachable')
        return 'NOTE: the user is called Ada and wants answers in German.'

    async def checkpoint(metadata, recent, summary, dropped, kept):
        state['checkpoints'].append({'summary': summary, 'dropped': dropped, 'kept': kept})

    async def make_emitter(_metadata):
        async def emit(description, done, **extra):
            state['events'].append({'description': description, 'done': done, **extra})

        return emit

    monkeypatch.setattr(cc, '_load_config', load_config)
    monkeypatch.setattr(cc, '_generate_summary', generate_summary)
    monkeypatch.setattr(cc, '_checkpoint', checkpoint)
    monkeypatch.setattr(cc, '_make_emitter', make_emitter)
    return state


async def compact(messages, window=8192, **kwargs):
    return await cc.compact_messages_for_request(
        request=None,
        user=None,
        messages=messages,
        metadata=kwargs.pop('metadata', {}),
        model_id='test-model',
        models={'test-model': {'id': 'test-model', 'context_length': window}},
        **kwargs,
    )


@pytest.mark.anyio
class TestWhenItFires:
    async def test_leaves_a_short_conversation_alone(self, stubbed):
        messages = [user('hello'), assistant('hi'), user('and again'), assistant('sure')]
        result, summary, compacted = await compact(messages, window=32768)
        assert compacted is False
        assert summary is None
        assert result == messages
        assert stubbed['summaries'] == 0

    async def test_fires_once_the_conversation_outgrows_the_window(self, stubbed):
        messages = conversation(turns=8, size=200)
        result, summary, compacted = await compact(messages, window=8192)
        assert compacted is True
        assert summary.startswith('NOTE:')
        assert len(result) < len(messages)

    async def test_the_same_conversation_is_left_alone_on_a_larger_model(self, stubbed):
        # The whole point of reading the window from the model: one threshold
        # cannot be right for both of these.
        messages = conversation(turns=8, size=200)
        _, _, compacted = await compact(messages, window=1_000_000)
        assert compacted is False

    async def test_does_nothing_when_no_model_states_a_window(self, stubbed):
        # Guessing a limit would throw away context to satisfy a number that
        # was never measured.
        result, _, compacted = await cc.compact_messages_for_request(
            request=None,
            user=None,
            messages=conversation(turns=8, size=200),
            metadata={},
            model_id='mystery',
            models={'mystery': {'id': 'mystery'}},
        )
        assert compacted is False
        assert len(result) == 16

    async def test_switched_off_means_switched_off(self, monkeypatch, stubbed):
        async def disabled():
            return {'enable': False}

        monkeypatch.setattr(cc, '_load_config', disabled)
        messages = conversation(turns=8, size=200)
        result, summary, compacted = await compact(messages)
        assert (result, summary, compacted) == (messages, None, False)


@pytest.mark.anyio
class TestWhatItKeeps:
    async def test_the_system_message_survives(self, stubbed):
        system = {'role': 'system', 'content': 'Always answer in German.'}
        result, _, compacted = await compact([system, *conversation(turns=8, size=200)])
        assert compacted is True
        assert result[0] == system

    async def test_the_newest_turn_survives(self, stubbed):
        messages = conversation(turns=8, size=200)
        result, _, _ = await compact(messages)
        assert result[-1] == messages[-1]
        assert result[-2] == messages[-2]

    async def test_the_boundary_is_a_whole_turn(self, stubbed):
        result, _, compacted = await compact(conversation(turns=8, size=200))
        assert compacted is True
        assert result[0]['role'] == 'user'

    async def test_what_it_kept_actually_fits(self, stubbed):
        result, summary, _ = await compact(conversation(turns=10, size=200), window=8192)
        from open_webui.utils.context_budget import resolve_budget

        budget = resolve_budget({'context_length': 8192})
        assert count_messages_tokens(result) + len(summary) // 4 < budget.usable

    async def test_records_a_checkpoint_against_the_kept_history(self, stubbed):
        await compact(conversation(turns=8, size=200))
        assert len(stubbed['checkpoints']) == 1
        assert stubbed['checkpoints'][0]['dropped'] > 0
        assert stubbed['checkpoints'][0]['kept'] > 0


@pytest.mark.anyio
class TestResumingFromAnEarlierNote:
    async def test_starts_from_the_note_and_hands_it_back(self, stubbed):
        messages = [
            user('ancient'),
            assistant('old'),
            user('after the note', contextSummary='an earlier note'),
            assistant('recent'),
        ]
        result, summary, compacted = await compact(messages, window=1_000_000)
        assert compacted is False
        assert summary == 'an earlier note'
        assert [m['content'] for m in result] == ['after the note', 'recent']

    async def test_the_earlier_note_is_given_to_the_next_summary(self, monkeypatch, stubbed):
        # Each note is written against the last one rather than against a copy
        # of a copy. If the previous note never reaches the summariser, a long
        # chat loses a little more on every compaction until nothing is left.
        seen = {}

        async def capture(request, user_, model_id, models, compacted_, recent, previous, template):
            seen['previous'] = previous
            return 'a newer note'

        monkeypatch.setattr(cc, '_generate_summary', capture)
        messages = [user('start', contextSummary='an earlier note'), *conversation(turns=8, size=200)]
        _, summary, compacted = await compact(messages)
        assert compacted is True
        assert seen['previous'] == 'an earlier note'
        assert summary == 'a newer note'


@pytest.mark.anyio
class TestWhenTheSummaryCannotBeMade:
    async def test_the_turn_still_goes_out(self, stubbed):
        # Losing detail is a cost. Losing the answer is a failure, and it is
        # the one this whole feature exists to prevent.
        stubbed['fail'] = True
        result, _, compacted = await compact(conversation(turns=10, size=200), window=8192)
        assert compacted is False
        assert result

    async def test_and_it_fits_anyway(self, stubbed):
        stubbed['fail'] = True
        from open_webui.utils.context_budget import resolve_budget

        result, _, _ = await compact(conversation(turns=10, size=200), window=8192)
        assert count_messages_tokens(result) <= resolve_budget({'context_length': 8192}).usable

    async def test_the_client_is_told(self, stubbed):
        stubbed['fail'] = True
        await compact(conversation(turns=10, size=200), window=8192)
        assert any(event.get('error') for event in stubbed['events'])


@pytest.mark.anyio
class TestTellingTheClient:
    async def test_says_it_started_and_says_it_finished(self, stubbed):
        await compact(conversation(turns=8, size=200))
        assert [event['done'] for event in stubbed['events']] == [False, True]

    async def test_reports_the_window_it_budgeted_against(self, stubbed):
        # The emitter is stubbed here, so what is checked is the budget handed
        # to it -- flattening that into the event payload is the real
        # emitter's job.
        await compact(conversation(turns=8, size=200), window=8192)
        budget = stubbed['events'][0]['budget']
        assert budget.window == 8192
        assert budget.source == 'model'

    async def test_says_how_much_smaller_the_context_got(self, stubbed):
        await compact(conversation(turns=8, size=200), window=8192)
        before, after = stubbed['events'][0]['tokens'], stubbed['events'][1]['tokens']
        assert after < before
