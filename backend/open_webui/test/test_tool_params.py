"""What a model can put in a tool call's arguments, and what may reach `.items()`.

Everything downstream reads the parsed arguments as a mapping of parameter
names. A value that is valid JSON but not an object used to reach a dict
comprehension outside any try and take the whole response with it — the partial
answer included. These are the shapes that got there.
"""

from open_webui.utils.middleware import coerce_tool_params


class TestUsableArguments:
    def test_reads_an_object(self):
        assert coerce_tool_params('{"city": "Berlin", "days": 3}') == {'city': 'Berlin', 'days': 3}

    def test_reads_an_empty_object(self):
        assert coerce_tool_params('{}') == {}

    def test_treats_nothing_at_all_as_no_parameters(self):
        # A tool that takes none is called with none; that is not an error.
        for empty in ['', '   ', None]:
            assert coerce_tool_params(empty) == {}

    def test_falls_back_to_python_literals(self):
        # Some models emit single quotes. JSON refuses them, ast does not.
        assert coerce_tool_params("{'city': 'Berlin'}") == {'city': 'Berlin'}

    def test_keeps_nested_values_as_they_are(self):
        parsed = coerce_tool_params('{"filter": {"tags": ["a", "b"], "limit": 2}}')
        assert parsed == {'filter': {'tags': ['a', 'b'], 'limit': 2}}


class TestUnusableArguments:
    def test_refuses_json_that_is_not_an_object(self):
        # The crash: each of these parses fine and then has no .items().
        for scalar in ['"just a string"', '42', '3.5', 'true', 'null', '["a", "b"]']:
            assert coerce_tool_params(scalar) is None, scalar

    def test_refuses_what_does_not_parse_at_all(self):
        for broken in ['{"city": ', 'not json', '{oops}', '{"a": 1,']:
            assert coerce_tool_params(broken) is None, broken

    def test_says_no_rather_than_raising(self):
        # The caller turns None into a message for the model. An exception here
        # would be the original bug wearing a different hat.
        for odd in [b'{}', 12, [], {}, object()]:
            result = coerce_tool_params(odd)
            assert result is None or isinstance(result, dict)
