from collections.abc import Callable

from open_webui.utils.json_codec import JSONCodec

ASK_USER_NAME = 'ask_user'

# More than a handful stops being a clarification and becomes a form.
MAX_QUESTIONS = 5

# What to tell the model when it gets a refusal rather than an answer. MCP's
# elicitation model separates these two on purpose: declining is a decision,
# dismissing is not, and they call for different follow-ups.
ASK_USER_REFUSALS = {
    'cancelled': 'The prompt was dismissed. Carry on with a stated assumption, or ask again later.',
    'declined': (
        'The person chose not to answer. Do not ask the same thing again; proceed with a stated '
        'assumption or offer an alternative.'
    ),
}


def get_ask_user_tool_calls(tool_calls: list[dict]) -> tuple[list[dict], str | None]:
    ask_user_calls = [
        tool_call for tool_call in tool_calls if tool_call.get('function', {}).get('name') == ASK_USER_NAME
    ]
    if not ask_user_calls:
        return [], None
    if len(tool_calls) != 1:
        return (
            ask_user_calls,
            'Error: ask_user must be the only tool call, so it did not run. Call ask_user on its own.',
        )
    if len(ask_user_calls) != 1:
        return ask_user_calls, 'Error: only one ask_user call is allowed per turn.'
    return ask_user_calls, None


ASK_USER_TYPES = ('select', 'multiselect', 'text', 'number', 'boolean')

# Text formats a client can validate and offer the right keyboard for.
ASK_USER_FORMATS = ('email', 'uri', 'date', 'date-time')

# MCP is explicit that a form must never be used to collect secrets: they would
# pass through the model's context and the chat log on the way back. Anything
# that reads like a credential is refused here rather than rendered.
_SECRET_WORDS = (
    'password',
    'passwort',
    'passphrase',
    'api key',
    'api-key',
    'apikey',
    'secret key',
    'access token',
    'auth token',
    'bearer token',
    'private key',
    'seed phrase',
    'recovery phrase',
    'credit card',
    'card number',
    'kreditkarte',
    'kartennummer',
    'cvv',
    'cvc',
    'iban',
    'social security',
    'sozialversicherungsnummer',
    'pin code',
)


def _looks_like_a_secret(text: str) -> bool:
    lowered = ' '.join(text.lower().split())
    return any(word in lowered for word in _SECRET_WORDS)


def _clean(value, limit: int) -> str:
    return str(value or '').strip()[:limit]


def _as_number(value, *, integer: bool, label: str):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'{label} must be a number.')
    if integer and float(value) != int(value):
        raise ValueError(f'{label} must be a whole number.')
    return int(value) if integer else float(value)


def _normalize_options(question: dict, index: int) -> list:
    options = question.get('options')
    if not isinstance(options, list) or not 2 <= len(options) <= 6:
        raise ValueError(f'Question {index + 1} needs between 2 and 6 options.')

    normalized = []
    seen_values = set()
    for option in options:
        if isinstance(option, str):
            option = {'label': option}
        if not isinstance(option, dict):
            raise ValueError('Each option must be an object or a string.')

        label = _clean(option.get('label'), 80)
        if not label:
            raise ValueError('Each option requires a label.')

        # The value is what comes back; the label is what the person reads.
        value = option.get('value')
        value = _clean(value, 200) if value is not None else label
        if value in seen_values:
            raise ValueError(f'Duplicate option value: {value}')
        seen_values.add(value)

        normalized.append(
            {
                'label': label,
                'description': _clean(option.get('description'), 240),
                'value': value,
            }
        )
    return normalized


def normalize_question(question, index: int, allow_other: bool) -> dict:
    if not isinstance(question, dict):
        raise ValueError('Each question must be an object.')

    question_id = _clean(question.get('id'), 64)
    if not question_id:
        raise ValueError(f'Question {index + 1} requires a non-empty id.')

    text = _clean(question.get('question'), 500)
    if not text:
        raise ValueError(f'Question {index + 1} requires question text.')

    kind = _clean(question.get('type'), 24).lower() or 'select'
    if kind in ('single', 'choice', 'enum', 'option'):
        kind = 'select'
    elif kind in ('multi', 'multi_select', 'checkbox'):
        kind = 'multiselect'
    elif kind in ('string', 'freetext', 'free_text'):
        kind = 'text'
    elif kind in ('integer', 'int', 'float'):
        kind = 'number'
    elif kind in ('bool', 'confirm', 'yes_no'):
        kind = 'boolean'
    if kind not in ASK_USER_TYPES:
        raise ValueError(f'Unknown question type "{kind}". Use one of: {", ".join(ASK_USER_TYPES)}.')

    header = _clean(question.get('header'), 48) or f'Question {index + 1}'
    hint = _clean(question.get('hint'), 240)

    if _looks_like_a_secret(f'{header} {text} {hint}'):
        raise ValueError(
            'This tool must not be used to collect passwords, API keys, card numbers or '
            'other credentials: the answer would travel back through the model and the chat '
            'log. Ask the person to enter it directly wherever it belongs instead.'
        )

    normalized = {
        'id': question_id,
        'type': kind,
        'header': header,
        'question': text,
        'required': bool(question.get('required', True)),
    }
    if hint:
        normalized['hint'] = hint

    if kind in ('select', 'multiselect'):
        normalized['options'] = _normalize_options(question, index)
        normalized['allow_other'] = bool(question.get('allow_other', allow_other))

        values = [option['value'] for option in normalized['options']]
        if kind == 'multiselect':
            count = len(normalized['options'])
            minimum = question.get('min_select', 1)
            maximum = question.get('max_select', count)
            normalized['min_select'] = max(0, min(int(_as_number(minimum, integer=True, label='min_select')), count))
            normalized['max_select'] = max(
                normalized['min_select'],
                min(int(_as_number(maximum, integer=True, label='max_select')), count),
            )

            default = question.get('default')
            if isinstance(default, list):
                normalized['default'] = [item for item in default if item in values]
        elif question.get('default') in values:
            normalized['default'] = question['default']

    elif kind == 'text':
        normalized['multiline'] = bool(question.get('multiline', False))
        placeholder = _clean(question.get('placeholder'), 80)
        if placeholder:
            normalized['placeholder'] = placeholder

        text_format = _clean(question.get('format'), 16).lower()
        if text_format:
            if text_format not in ASK_USER_FORMATS:
                raise ValueError(f'Unknown format "{text_format}". Use one of: {", ".join(ASK_USER_FORMATS)}.')
            normalized['format'] = text_format

        if question.get('min_length') is not None:
            normalized['min_length'] = max(0, int(_as_number(question['min_length'], integer=True, label='min_length')))
        if question.get('max_length') is not None:
            normalized['max_length'] = max(1, int(_as_number(question['max_length'], integer=True, label='max_length')))
        if isinstance(question.get('default'), str):
            normalized['default'] = _clean(question['default'], 2000)

    elif kind == 'number':
        integer = bool(question.get('integer', False))
        normalized['integer'] = integer
        if question.get('minimum') is not None:
            normalized['minimum'] = _as_number(question['minimum'], integer=False, label='minimum')
        if question.get('maximum') is not None:
            normalized['maximum'] = _as_number(question['maximum'], integer=False, label='maximum')
        if 'minimum' in normalized and 'maximum' in normalized and normalized['minimum'] > normalized['maximum']:
            raise ValueError('minimum cannot be greater than maximum.')
        if question.get('unit'):
            normalized['unit'] = _clean(question.get('unit'), 16)
        if question.get('default') is not None:
            normalized['default'] = _as_number(question['default'], integer=integer, label='default')

    elif kind == 'boolean':
        normalized['default'] = bool(question.get('default', False))
        normalized['true_label'] = _clean(question.get('true_label'), 32)
        normalized['false_label'] = _clean(question.get('false_label'), 32)

    return normalized


def read_answer(question: dict, raw) -> tuple:
    """Turns one client answer into (answer, plain value), or raises."""
    if not isinstance(raw, dict):
        raise ValueError('missing')

    kind = raw.get('type')
    if kind == 'skipped':
        if question['required']:
            raise ValueError('required')
        return {'type': 'skipped'}, None

    if question['type'] == 'select':
        if kind == 'other':
            text = str(raw.get('text') or '').strip()
            if not text:
                raise ValueError('empty')
            return {'type': 'other', 'text': text}, text

        index = raw.get('option_index')
        if not isinstance(index, int) or not 0 <= index < len(question['options']):
            raise ValueError('no such option')
        option = question['options'][index]
        return (
            {
                'type': 'option',
                'option_index': index,
                'label': option['label'],
                'description': option['description'],
                'value': option['value'],
            },
            option['value'],
        )

    if question['type'] == 'multiselect':
        if kind == 'other':
            text = str(raw.get('text') or '').strip()
            if not text:
                raise ValueError('empty')
            return {'type': 'other', 'text': text}, text

        indexes = raw.get('option_indexes')
        if not isinstance(indexes, list):
            raise ValueError('no selection')
        picked = []
        for index in indexes:
            if not isinstance(index, int) or not 0 <= index < len(question['options']):
                raise ValueError('no such option')
            if index not in picked:
                picked.append(index)
        if not question['min_select'] <= len(picked) <= question['max_select']:
            raise ValueError('wrong number of selections')

        chosen = [question['options'][index] for index in picked]
        return (
            {
                'type': 'options',
                'option_indexes': picked,
                'labels': [option['label'] for option in chosen],
                'values': [option['value'] for option in chosen],
            },
            [option['value'] for option in chosen],
        )

    if question['type'] == 'text':
        text = str(raw.get('text') or '').strip()
        if not text:
            raise ValueError('empty')
        if len(text) < question.get('min_length', 0):
            raise ValueError('too short')
        if 'max_length' in question:
            text = text[: question['max_length']]
        return {'type': 'text', 'text': text}, text

    if question['type'] == 'number':
        value = raw.get('number')
        number = _as_number(value, integer=question['integer'], label='answer')
        if 'minimum' in question and number < question['minimum']:
            raise ValueError('below minimum')
        if 'maximum' in question and number > question['maximum']:
            raise ValueError('above maximum')
        return {'type': 'number', 'number': number}, number

    value = raw.get('boolean')
    if not isinstance(value, bool):
        raise ValueError('not a yes or no')
    return {'type': 'boolean', 'boolean': value}, value


def normalize_ask_user_request(arguments: dict) -> dict:
    """Validates one ask_user call and returns what the browser should render.

    This is the single gate every path goes through: the tool executed directly,
    and the native tool-call staging in middleware. They used to disagree, which
    left the model reading one set of rules in the tool description and being
    refused by another.
    """
    questions = arguments.get('questions')
    if not isinstance(questions, list) or not 1 <= len(questions) <= MAX_QUESTIONS:
        raise ValueError(f'ask_user takes between 1 and {MAX_QUESTIONS} questions.')

    allow_other = bool(arguments.get('allow_other', True))
    normalized_questions = []
    seen_ids = set()
    for index, question in enumerate(questions):
        normalized = normalize_question(question, index, allow_other)
        if normalized['id'] in seen_ids:
            raise ValueError(f'Duplicate question id: {normalized["id"]}')
        seen_ids.add(normalized['id'])
        normalized_questions.append(normalized)

    timeout_ms = arguments.get('timeout_ms', 120_000)
    if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int) or not 60_000 <= timeout_ms <= 600_000:
        timeout_ms = 120_000

    return {
        'questions': normalized_questions,
        'allow_other': allow_other,
        'timeout_ms': timeout_ms,
    }


def read_ask_user_answers(questions: list[dict], raw_answers: dict) -> tuple[dict, dict, list[str]]:
    """Checks the browser's reply against what was asked.

    Returns (answers, values, problems). An answer for a question that was never
    asked, or an option index that was never offered, does not survive this.
    """
    answers = {}
    values = {}
    problems = []
    for question in questions:
        try:
            answer, value = read_answer(question, (raw_answers or {}).get(question['id']))
        except ValueError as e:
            if question.get('required', True):
                problems.append(f'{question["id"]}: {e}')
            continue
        answers[question['id']] = answer
        if answer['type'] != 'skipped':
            values[question['id']] = value
    return answers, values, problems


def stage_ask_user_tool_calls(
    tool_calls: list[dict],
    output: list[dict],
    make_output_id: Callable[[str], str],
) -> tuple[bool, str | None]:
    ask_user_calls, error = get_ask_user_tool_calls(tool_calls)
    if not ask_user_calls:
        return False, None

    for tool_call in ask_user_calls:
        call_id = tool_call.get('id') or make_output_id('fc')
        raw_arguments = tool_call.get('function', {}).get('arguments', '{}')
        arguments = raw_arguments

        if not error:
            try:
                parsed_arguments = JSONCodec.loads(raw_arguments or '{}')
                if not isinstance(parsed_arguments, dict):
                    raise ValueError('ask_user arguments must be an object.')
                arguments = JSONCodec.dumps(normalize_ask_user_request(parsed_arguments))
            except (JSONCodec.JSONDecodeError, TypeError, ValueError) as exc:
                error = f'Error: {exc}'

        item = {
            'type': 'function_call',
            'id': call_id or make_output_id('fc'),
            'call_id': call_id,
            'name': ASK_USER_NAME,
            'arguments': arguments,
            'status': 'completed' if error else 'pending',
        }

        existing_item = next(
            (
                existing
                for existing in output
                if existing.get('type') == 'function_call'
                and (
                    existing.get('call_id') == call_id
                    or existing.get('id') == tool_call.get('id')
                    or (
                        not existing.get('call_id')
                        and existing.get('name') == ASK_USER_NAME
                        and existing.get('status') not in {'rejected', 'failed'}
                    )
                )
            ),
            None,
        )
        if existing_item:
            existing_item.update(item)
        else:
            output.append(item)

        # Every invalid call needs its own result, or the UI waits on it forever.
        if error:
            output.append(
                {
                    'type': 'function_call_output',
                    'id': make_output_id('fco'),
                    'call_id': call_id,
                    'output': [{'type': 'input_text', 'text': error}],
                    'status': 'completed',
                }
            )

    return True, error
