"""What the token counter is measured against.

The estimate cannot be exact -- if it could, it would be a tokenizer. What it
can be is honest about its direction: the corpus below is checked against
tiktoken so the fallback's error stays known rather than assumed, and so a
change to the constants has to face the same numbers.
"""

import base64
import struct
import zlib

import pytest
from open_webui.utils.token_counter import (
    _encoding_name_for,
    count_image_tokens,
    count_message_tokens,
    count_messages_tokens,
    count_text_tokens,
    count_tools_tokens,
    estimate_tokens,
    get_encoder,
    usage_completion_tokens,
    usage_prompt_tokens,
)

# What actually travels through a chat: prose in several scripts, the JSON that
# tool results are made of, code, and the dense blobs that a rule based on
# character count gets most wrong.
CORPUS = {
    'english': 'Context compaction should happen before the request fails, not after it. ' * 4,
    'german': 'Die Kompaktierung geschieht automatisch, bevor die Anfrage scheitert. Größere Änderungen kosten. ' * 4,
    'french': "La compaction du contexte doit se produire avant que la requête n'échoue. " * 4,
    'russian': 'Сжатие контекста должно происходить автоматически, до ошибки запроса. ' * 4,
    'chinese': '上下文压缩应该自动发生，而不是在请求失败之后才发生。它应当保留已经做出的决定。' * 4,
    'japanese': 'コンテキストの圧縮は、失敗してからではなく自動的に行われるべきです。決定や制約を保持します。' * 4,
    'korean': '컨텍스트 압축은 요청이 실패한 뒤가 아니라 자동으로 이루어져야 합니다.' * 4,
    'arabic': 'يجب أن يحدث ضغط السياق تلقائيًا قبل فشل الطلب، وأن يحافظ على القرارات. ' * 4,
    'json': '{"results":['
    + ','.join(f'{{"title":"Result {i}","url":"https://example.com/{i}","score":0.9}}' for i in range(20))
    + ']}',
    'python': 'def compact(messages, budget):\n    total = sum(count(m) for m in messages)\n    return messages\n' * 4,
    'markdown': '# Heading\n\n- one item\n- another\n\n```bash\nnpm run build\n```\n\nSome **bold** text.\n' * 4,
    'urls': 'https://github.com/open-webui/open-webui/blob/main/backend/open_webui/utils/token_counter.py#L42 ' * 5,
}


@pytest.fixture(scope='module')
def encoder():
    found = get_encoder('gpt-4o')
    if found is None:
        pytest.skip('tiktoken vocabulary is not available in this environment')
    return found


def real_tokens(encoder, text: str) -> int:
    return len(encoder.encode(text, disallowed_special=()))


class TestEncodingChoice:
    def test_picks_the_vocabulary_the_family_actually_uses(self):
        # gpt-4o is o200k even though it starts with the string "gpt-4".
        assert _encoding_name_for('gpt-4o') == 'o200k_base'
        assert _encoding_name_for('gpt-4.1-mini') == 'o200k_base'
        assert _encoding_name_for('gpt-4-turbo') == 'cl100k_base'
        assert _encoding_name_for('gpt-3.5-turbo') == 'cl100k_base'

    def test_sees_through_a_provider_prefix(self):
        assert _encoding_name_for('openai/gpt-4-turbo') == 'cl100k_base'
        assert _encoding_name_for('azure/gpt-4o-mini') == 'o200k_base'

    def test_falls_back_to_the_current_vocabulary_for_everything_else(self):
        for model in ('llama3.3:70b', 'qwen3-coder', 'mistral-large', '', None):
            assert _encoding_name_for(model) == 'o200k_base'


class TestEstimateAgainstARealTokenizer:
    """The fallback, measured. These bounds are what the constants are for."""

    def test_never_loses_more_than_a_quarter_of_any_sample(self, encoder):
        # Undercounting is the direction that overflows a context window, so
        # it is bounded much more tightly than overcounting.
        worst = None
        for name, text in CORPUS.items():
            real = real_tokens(encoder, text)
            ratio = estimate_tokens(text) / real
            if worst is None or ratio < worst[1]:
                worst = (name, ratio)
        assert worst[1] >= 0.75, f'{worst[0]} estimated at {worst[1]:.0%} of its real token count'

    def test_never_more_than_doubles_any_sample(self, encoder):
        # Overcounting is safe but not free: it compacts a conversation earlier
        # than it needed to be.
        for name, text in CORPUS.items():
            ratio = estimate_tokens(text) / real_tokens(encoder, text)
            assert ratio <= 2.0, f'{name} estimated at {ratio:.0%} of its real token count'

    def test_does_not_lose_two_thirds_of_a_cjk_message(self, encoder):
        # The failure that motivated the character classes: dividing by four
        # counts a Japanese message at a third of its real size.
        for name in ('chinese', 'japanese', 'korean'):
            text = CORPUS[name]
            real = real_tokens(encoder, text)
            assert len(text) // 4 < real * 0.5, 'the naive rule is supposed to be badly low here'
            assert estimate_tokens(text) >= real * 0.9

    def test_counts_something_for_any_non_empty_text(self):
        assert estimate_tokens('a') >= 1
        assert estimate_tokens(' ') >= 1
        assert estimate_tokens('') == 0


class TestCountText:
    def test_matches_the_tokenizer_when_there_is_one(self, encoder):
        text = CORPUS['english']
        assert count_text_tokens(text, 'gpt-4o') == real_tokens(encoder, text)

    def test_serialises_what_is_not_text(self):
        assert count_text_tokens({'a': 1}) > 0
        assert count_text_tokens([1, 2, 3]) > 0

    def test_nothing_costs_nothing(self):
        assert count_text_tokens(None) == 0
        assert count_text_tokens('') == 0

    def test_survives_text_that_looks_like_a_special_token(self):
        # Chat content is user data. `<|endoftext|>` makes tiktoken raise
        # unless it is told not to, and a token count must never be the thing
        # that breaks a conversation.
        assert count_text_tokens('<|endoftext|> and <|fim_prefix|>', 'gpt-4o') > 0


def png_bytes(width: int, height: int) -> bytes:
    header = struct.pack('>II', width, height) + b'\x08\x06\x00\x00\x00'
    chunk = b'IHDR' + header
    return b'\x89PNG\r\n\x1a\n' + struct.pack('>I', len(header)) + chunk + struct.pack('>I', zlib.crc32(chunk))


def data_url(payload: bytes, mime: str = 'image/png') -> str:
    return f'data:{mime};base64,' + base64.b64encode(payload).decode()


class TestImages:
    def test_reads_the_size_out_of_a_png_header(self):
        small = count_image_tokens(data_url(png_bytes(64, 64)))
        large = count_image_tokens(data_url(png_bytes(1024, 1024)))
        assert small < large
        # 1024x1024 over 750 pixels per token.
        assert large == pytest.approx(1398, abs=5)

    def test_reads_the_size_out_of_a_gif_header(self):
        gif = b'GIF89a' + struct.pack('<HH', 320, 240) + b'\x00' * 8
        assert count_image_tokens(data_url(gif, 'image/gif')) == pytest.approx(102, abs=3)

    def test_reads_the_size_out_of_a_jpeg_frame_header(self):
        # SOI, a JFIF APP0 segment, then the frame header carrying the size.
        app0 = b'\xff\xe0' + struct.pack('>H', 16) + b'JFIF\x00' + b'\x00' * 9
        sof0 = b'\xff\xc0' + struct.pack('>H', 17) + b'\x08' + struct.pack('>HH', 480, 640) + b'\x00' * 8
        assert count_image_tokens(data_url(b'\xff\xd8' + app0 + sof0, 'image/jpeg')) == pytest.approx(410, abs=5)

    def test_caps_an_enormous_image_the_way_providers_do(self):
        # Providers downscale before charging, so a 4K screenshot does not cost
        # sixteen times a 1024px one.
        huge = count_image_tokens(data_url(png_bytes(4096, 4096)))
        assert huge < count_image_tokens(data_url(png_bytes(1024, 1024))) * 3

    def test_falls_back_when_the_size_cannot_be_read(self):
        for url in ('https://example.com/photo.png', 'data:image/webp;base64,AAAA', None, '', 'not a url'):
            assert count_image_tokens(url) == 1400

    def test_does_not_raise_on_a_truncated_or_invalid_data_url(self):
        assert count_image_tokens('data:image/png;base64,!!!!not base64!!!!') > 0
        assert count_image_tokens('data:image/png;base64,') > 0


class TestMessages:
    def test_charges_for_the_structure_around_the_content(self):
        # Two empty messages are not free: the roles and delimiters are sent.
        assert count_messages_tokens([{'role': 'user', 'content': ''}]) > 0

    def test_counts_an_image_part_alongside_the_text(self):
        text_only = count_message_tokens({'role': 'user', 'content': [{'type': 'text', 'text': 'what is this'}]})
        with_image = count_message_tokens(
            {
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': 'what is this'},
                    {'type': 'image_url', 'image_url': {'url': data_url(png_bytes(1024, 1024))}},
                ],
            }
        )
        assert with_image > text_only + 1000

    def test_counts_tool_calls_and_their_results(self):
        # In an agentic chat these are most of the payload; leaving them out is
        # how a request calculated to fit does not.
        plain = count_message_tokens({'role': 'assistant', 'content': 'done'})
        with_calls = count_message_tokens(
            {
                'role': 'assistant',
                'content': 'done',
                'tool_calls': [
                    {'id': 'call_1', 'function': {'name': 'search_web', 'arguments': '{"query":"open webui"}'}}
                ],
            }
        )
        assert with_calls > plain

    def test_counts_reasoning_that_is_replayed_to_the_model(self):
        # Real prose, not a repeated character: BPE compresses "aaaa..." about
        # eight to one, which would make this pass for the wrong reason.
        reasoning = 'The user is asking about the context window, so I should check what the provider reported. ' * 5
        plain = count_message_tokens({'role': 'assistant', 'content': 'yes'})
        thinking = count_message_tokens({'role': 'assistant', 'content': 'yes', 'reasoning': reasoning})
        assert thinking > plain + 50

    def test_a_list_costs_more_than_its_parts_alone(self):
        messages = [{'role': 'user', 'content': 'hello'}, {'role': 'assistant', 'content': 'hi'}]
        assert count_messages_tokens(messages) > sum(count_text_tokens(m['content']) for m in messages)

    def test_nothing_costs_nothing(self):
        assert count_messages_tokens([]) == 0
        assert count_messages_tokens(None) == 0

    def test_survives_a_message_that_is_not_a_dict(self):
        assert count_message_tokens('just a string') > 0


class TestTools:
    def test_a_dozen_schemas_are_not_free(self):
        tools = [
            {
                'type': 'function',
                'function': {
                    'name': f'tool_{i}',
                    'description': 'Does a thing that takes a paragraph to explain properly.',
                    'parameters': {'type': 'object', 'properties': {'query': {'type': 'string'}}},
                },
            }
            for i in range(12)
        ]
        assert count_tools_tokens(tools) > 300

    def test_no_tools_cost_nothing(self):
        assert count_tools_tokens(None) == 0
        assert count_tools_tokens([]) == 0


class TestUsage:
    def test_reads_prompt_tokens_under_every_name_a_provider_uses(self):
        assert usage_prompt_tokens({'prompt_tokens': 120}) == 120
        assert usage_prompt_tokens({'prompt_eval_count': 340}) == 340
        assert usage_prompt_tokens({'input_tokens': 55}) == 55

    def test_adds_up_what_llama_cpp_processed_and_what_it_cached(self):
        assert usage_prompt_tokens({'prompt_n': 100, 'cache_n': 900}) == 1000

    def test_reads_completion_tokens_under_every_name(self):
        assert usage_completion_tokens({'completion_tokens': 12}) == 12
        assert usage_completion_tokens({'eval_count': 34}) == 34
        assert usage_completion_tokens({'output_tokens': 56}) == 56

    def test_says_nothing_rather_than_guessing(self):
        assert usage_prompt_tokens(None) == 0
        assert usage_prompt_tokens({}) == 0
        assert usage_prompt_tokens({'total_tokens': 99}) == 0
        assert usage_completion_tokens({'prompt_tokens': 99}) == 0
