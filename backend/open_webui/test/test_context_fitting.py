"""What the cheap reductions are allowed to do, and what they must never do.

The must-nevers matter more than the frees-a-lot: a payload that fits but has
an orphaned tool result is rejected by the provider outright, which is a worse
outcome than the overflow it was trying to avoid.
"""

from open_webui.utils.context_fitting import (
    clear_reasoning,
    clear_tool_results,
    fit_messages_to_window,
    split_into_turns,
    trim_oversized_results,
)
from open_webui.utils.token_counter import count_messages_tokens


def user(text='ask'):
    return {'role': 'user', 'content': text}


def assistant(text='answer', **extra):
    return {'role': 'assistant', 'content': text, **extra}


def calls(*names):
    return [{'id': f'call_{n}', 'type': 'function', 'function': {'name': n, 'arguments': '{}'}} for n in names]


def tool_result(name, text, call_id=None):
    return {'role': 'tool', 'tool_call_id': call_id or f'call_{name}', 'content': text}


def big(words=4000):
    return 'result line with several plausible words in it ' * words


class TestTurnBoundaries:
    def test_a_turn_starts_at_a_user_message(self):
        messages = [user('one'), assistant('a'), user('two'), assistant('b')]
        turns = split_into_turns(messages)
        assert [turn.start for turn in turns] == [0, 2]
        assert [turn.length for turn in turns] == [2, 2]

    def test_a_tool_exchange_stays_inside_its_turn(self):
        # The failure this prevents: a boundary that lands between an
        # assistant's tool_calls and the results answering them.
        messages = [
            user('search for it'),
            assistant('', tool_calls=calls('search_web')),
            tool_result('search_web', 'hits'),
            assistant('here is what I found'),
            user('thanks'),
        ]
        turns = split_into_turns(messages)
        assert len(turns) == 2
        assert turns[0].length == 4

    def test_anything_before_the_first_user_message_is_its_own_turn(self):
        messages = [{'role': 'system', 'content': 'be helpful'}, user('hi')]
        turns = split_into_turns(messages)
        assert [turn.start for turn in turns] == [0, 1]

    def test_a_conversation_with_no_user_message_is_one_turn(self):
        assert len(split_into_turns([assistant('a'), assistant('b')])) == 1

    def test_nothing_splits_into_nothing(self):
        assert split_into_turns([]) == []


class TestClearingReasoning:
    def test_drops_thinking_from_older_turns_only(self):
        messages = [
            user(),
            assistant('a', reasoning='long deliberation about the first question'),
            user(),
            assistant('b', reasoning='the most recent deliberation'),
        ]
        result, cleared = clear_reasoning(messages, keep_turns=1)
        assert cleared == 1
        assert 'reasoning' not in result[1]
        assert result[3]['reasoning'] == 'the most recent deliberation'

    def test_leaves_everything_else_on_the_message_alone(self):
        messages = [assistant('a', reasoning='think', tool_calls=calls('x')), user(), assistant('b')]
        result, _ = clear_reasoning(messages)
        assert result[0]['tool_calls'] == messages[0]['tool_calls']
        assert result[0]['content'] == 'a'

    def test_does_not_copy_messages_that_had_no_reasoning(self):
        messages = [user(), assistant('a')]
        result, cleared = clear_reasoning(messages)
        assert cleared == 0
        assert result[0] is messages[0]


class TestClearingToolResults:
    def test_keeps_the_most_recent_and_clears_the_rest(self):
        messages = [user()] + [tool_result(f'tool_{i}', big(20)) for i in range(6)]
        result, cleared = clear_tool_results(messages, keep_last=3)
        assert cleared == 3
        assert 'cleared from context' in result[1]['content']
        assert result[6]['content'] == messages[6]['content']

    def test_keeps_the_message_so_the_call_is_not_orphaned(self):
        # Removing the message would leave the assistant's tool_call with no
        # answer, which providers reject with a 400.
        messages = [
            assistant('', tool_calls=calls('search_web')),
            tool_result('search_web', big(20), call_id='call_search_web'),
            user(),
            assistant('done'),
        ]
        result, cleared = clear_tool_results(messages, keep_last=0)
        assert cleared == 1
        assert result[1]['role'] == 'tool'
        assert result[1]['tool_call_id'] == 'call_search_web'

    def test_names_the_tool_in_the_placeholder(self):
        # "[search_web result cleared]" tells the model something that
        # "[tool result cleared]" does not.
        messages = [
            assistant('', tool_calls=calls('search_web')),
            {'role': 'tool', 'tool_call_id': 'call_search_web', 'content': big(20)},
        ]
        result, _ = clear_tool_results(messages, keep_last=0)
        assert 'search_web' in result[1]['content']

    def test_leaves_a_small_result_alone(self):
        # Clearing something tiny costs a cache invalidation and frees nothing.
        messages = [tool_result('now', '{"temperature": 12}')]
        result, cleared = clear_tool_results(messages, keep_last=0)
        assert cleared == 0
        assert result[0]['content'] == messages[0]['content']

    def test_nothing_to_clear_returns_the_same_list(self):
        messages = [user(), assistant('a')]
        result, cleared = clear_tool_results(messages)
        assert cleared == 0
        assert result is messages


class TestTrimmingOversizedResults:
    def test_cuts_a_result_that_would_dominate_the_window(self):
        messages = [tool_result('read_file', big(2000))]
        result, trimmed = trim_oversized_results(messages, max_tokens=500)
        assert trimmed == 1
        assert count_messages_tokens(result) < count_messages_tokens(messages)
        assert 'trimmed' in result[0]['content']

    def test_keeps_the_head_and_the_tail(self):
        text = 'BEGINNING ' + ('filler words here ' * 3000) + ' ENDING'
        result, _ = trim_oversized_results([tool_result('read_file', text)], max_tokens=200)
        assert result[0]['content'].startswith('BEGINNING')
        assert result[0]['content'].endswith('ENDING')

    def test_never_makes_a_dense_result_longer_than_it_was(self):
        # The bug this catches: deriving how much to keep from an assumed four
        # characters per token doubles a CJK result instead of trimming it,
        # because CJK runs near one character per token.
        text = '上下文压缩应该自动发生而不是在请求失败之后才发生' * 200
        original = [tool_result('read_file', text)]
        result, _ = trim_oversized_results(original, max_tokens=500)
        assert len(result[0]['content']) < len(text)
        assert count_messages_tokens(result) < count_messages_tokens(original)

    def test_leaves_an_ordinary_result_alone(self):
        messages = [tool_result('now', '{"temperature": 12}')]
        result, trimmed = trim_oversized_results(messages, max_tokens=500)
        assert trimmed == 0
        assert result[0] is messages[0]

    def test_ignores_assistant_messages_however_long(self):
        # Only tool results are trimmed here; an assistant's own answer is what
        # the user came for.
        messages = [assistant(big(2000))]
        _, trimmed = trim_oversized_results(messages, max_tokens=100)
        assert trimmed == 0


class TestFittingToABudget:
    def test_leaves_a_payload_that_already_fits_untouched(self):
        messages = [user('hello'), assistant('hi')]
        result, report = fit_messages_to_window(messages, budget=10_000)
        assert result is messages
        assert report.fits
        assert report.steps == []

    def test_does_nothing_when_no_window_is_known(self):
        # A budget of zero means nobody stated a window. Reducing against a
        # limit that was never measured throws away context for no reason.
        messages = [user(big(500))]
        result, report = fit_messages_to_window(messages, budget=0)
        assert result is messages
        assert report.fits
        assert report.steps == []

    def test_spends_the_cheap_reductions_before_the_expensive_one(self):
        messages = [
            user('go'),
            assistant('', reasoning=big(200), tool_calls=calls('search_web')),
            tool_result('search_web', big(400)),
            user('and now'),
            assistant('ok'),
        ]
        before = count_messages_tokens(messages)
        _, report = fit_messages_to_window(messages, budget=before // 2)
        assert report.fits
        assert report.turns_dropped == 0, 'turns should only go once the cheap steps are exhausted'
        assert report.freed > 0

    def test_clears_a_recent_tool_result_rather_than_dropping_its_turn(self):
        # Clearing the result keeps the question, the answer, and the fact
        # that a tool ran. Dropping the turn keeps none of the three, so
        # protecting the last few results has to stop mattering before the
        # turn itself is at stake.
        messages = [
            user('go'),
            assistant('', tool_calls=calls('search_web')),
            tool_result('search_web', big(400), call_id='call_search_web'),
            user('and now'),
            assistant('ok'),
        ]
        result, report = fit_messages_to_window(messages, budget=count_messages_tokens(messages) // 2)
        assert report.fits
        assert report.turns_dropped == 0
        assert report.tool_results_cleared == 1
        assert any(message.get('content') == 'go' for message in result)

    def test_drops_turns_only_as_a_last_resort(self):
        messages = [item for i in range(8) for item in (user(f'question {i} ' + big(60)), assistant(f'answer {i}'))]
        _, report = fit_messages_to_window(messages, budget=count_messages_tokens(messages) // 4)
        assert report.turns_dropped > 0
        assert 'dropped oldest turns' in report.steps

    def test_never_drops_the_system_message(self):
        # A request that fits but ignores its instructions has not been saved.
        system = {'role': 'system', 'content': 'Always answer in German.'}
        messages = [system] + [item for i in range(8) for item in (user(big(60)), assistant('a'))]
        result, _ = fit_messages_to_window(messages, budget=200)
        assert result[0]['content'] == 'Always answer in German.'

    def test_never_drops_the_question_being_asked(self):
        messages = [item for i in range(6) for item in (user(f'q{i} ' + big(60)), assistant(f'a{i}'))]
        result, _ = fit_messages_to_window(messages, budget=50)
        assert any('q5' in str(message.get('content')) for message in result)

    def test_reports_honestly_when_it_cannot_fit(self):
        # One enormous final turn cannot be reduced further. Saying so lets the
        # caller warn instead of pretending the request is safe.
        _, report = fit_messages_to_window([user(big(5000))], budget=100)
        assert report.fits is False

    def test_the_result_actually_fits(self):
        messages = [
            item
            for i in range(10)
            for item in (
                user(f'question {i}'),
                assistant('', reasoning=big(50), tool_calls=calls('search_web')),
                tool_result('search_web', big(100), call_id='call_search_web'),
                assistant(f'answer {i}'),
            )
        ]
        budget = count_messages_tokens(messages) // 6
        result, report = fit_messages_to_window(messages, budget=budget)
        assert report.fits
        assert count_messages_tokens(result) <= budget

    def test_every_tool_result_still_answers_a_call(self):
        # The invariant that keeps providers from rejecting the payload.
        messages = [
            item
            for i in range(10)
            for item in (
                user(f'question {i}'),
                assistant('', tool_calls=calls(f'tool_{i}')),
                tool_result(f'tool_{i}', big(100), call_id=f'call_tool_{i}'),
                assistant(f'answer {i}'),
            )
        ]
        result, _ = fit_messages_to_window(messages, budget=count_messages_tokens(messages) // 5)
        offered = {call['id'] for message in result for call in message.get('tool_calls') or []}
        answered = {message['tool_call_id'] for message in result if message.get('role') == 'tool'}
        assert answered <= offered, 'a tool result was kept without the call it answers'
