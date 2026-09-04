"""Counting what a request will actually cost in tokens.

Compaction has to decide, before sending, whether the next request fits. That
decision is only as good as the count behind it, and the direction of the error
matters more than its size: overcounting compacts a little early, undercounting
lets the request overflow and the turn is lost. Every choice here leans the
same way.

The count comes from the best source available, in this order:

1. What the provider billed for the previous turn. `usage.prompt_tokens` is not
   an estimate at all -- it is the model's own tokenizer, after the provider's
   own prompt assembly, which no client-side count can reproduce.
2. tiktoken. Exact for OpenAI models and close for everything else, because
   modern vocabularies are all BPE over similar corpora.
3. A character-class estimate, for a server that cannot reach the internet to
   fetch a vocabulary and has none cached.

Step 3 exists because `tiktoken.get_encoding` downloads on first use. An
air-gapped deployment must still get an answer, and it must not pay for a
failing network call on every message -- so the outcome is remembered either
way.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import math
import re
import struct
from typing import Any

from open_webui.utils.json_codec import JSONCodec

log = logging.getLogger(__name__)

# The vocabulary to count against, by model family.
#
# A model whose family is not listed is counted with o200k_base. That is not a
# claim about its tokenizer; it is the most recent general-purpose vocabulary,
# and for Llama, Qwen, Mistral and Gemma it lands far closer than any
# character rule. The remaining error is absorbed by the safety margin the
# budget keeps.
_DEFAULT_ENCODING = 'o200k_base'
_LEGACY_OPENAI_ENCODING = 'cl100k_base'

# OpenAI families that predate o200k, and the newer ones that share their
# prefix. gpt-4o is o200k despite starting with "gpt-4", so the newer list has
# to be consulted first.
_O200K_FAMILIES = ('gpt-4o', 'gpt-4.1', 'gpt-5', 'o1', 'o3', 'o4', 'chatgpt-4o')
_CL100K_FAMILIES = ('gpt-4', 'gpt-3.5', 'gpt-35')

# Loaded encoders, and the names known to be unobtainable. A failure is cached
# as None so an offline server stops trying.
_encoders: dict[str, Any] = {}


def _encoding_name_for(model_id: str | None) -> str:
    # A provider prefix is common (openai/gpt-4o, azure/gpt-35-turbo), so match
    # on the last path segment as well as the whole id.
    name = (model_id or '').lower()
    tail = name.rsplit('/', 1)[-1]

    if tail.startswith(_O200K_FAMILIES):
        return _DEFAULT_ENCODING
    if tail.startswith(_CL100K_FAMILIES):
        return _LEGACY_OPENAI_ENCODING
    return _DEFAULT_ENCODING


def get_encoder(model_id: str | None = None) -> Any | None:
    """The tokenizer for a model, or None when none can be loaded.

    Never raises, and never asks twice for something that failed: the first
    attempt may reach the network, and a server that has no network would
    otherwise pay that timeout on every single message.
    """
    name = _encoding_name_for(model_id)
    if name in _encoders:
        return _encoders[name]

    try:
        import tiktoken

        _encoders[name] = tiktoken.get_encoding(name)
    except Exception as error:
        log.info('token counting falls back to estimation; %s is unavailable: %s', name, error)
        _encoders[name] = None
    return _encoders[name]


async def prime_encoder(model_id: str | None = None) -> None:
    """Load the tokenizer off the event loop, before it is needed in anger.

    `tiktoken.get_encoding` reads from disk and, the first time, from the
    network. Neither belongs in a request handler that is already streaming.
    """
    if _encoding_name_for(model_id) not in _encoders:
        await asyncio.to_thread(get_encoder, model_id)


# --- the estimate of last resort ---------------------------------------------

# Scripts written without spaces, where a character is close to a whole token.
# Measured against o200k_base at 0.71-0.77 tokens per character for Chinese,
# Japanese and Korean; 0.85 keeps the estimate on the safe side of all three.
_CJK_RANGES = (
    (0x1100, 0x11FF),  # Hangul Jamo
    (0x3040, 0x30FF),  # Hiragana, Katakana
    (0x3400, 0x4DBF),  # CJK Extension A
    (0x4E00, 0x9FFF),  # CJK Unified
    (0xAC00, 0xD7AF),  # Hangul Syllables
    (0xF900, 0xFAFF),  # CJK Compatibility
    (0x20000, 0x2FA1F),  # CJK Extension B and beyond
)
_CJK_TOKENS_PER_CHAR = 0.85

# Everything else, by character class. Letters run about 4 to 6 characters per
# token in prose; digits, punctuation and symbols run far denser, which is why
# JSON and base64 are where a flat characters-over-four rule goes most wrong.
_LETTER_CHARS_PER_TOKEN = 4.0
_DENSE_CHARS_PER_TOKEN = 2.2
_SPACE_CHARS_PER_TOKEN = 5.0


def _is_cjk(char: str) -> bool:
    code = ord(char)
    return any(low <= code <= high for low, high in _CJK_RANGES)


def estimate_tokens(text: str) -> int:
    """A tokenizer-free count, weighted by what the characters are.

    Not a replacement for a tokenizer -- it cannot be -- but it does not lose
    two thirds of a Japanese message the way dividing by four does.
    """
    if not text:
        return 0

    cjk = letters = digits = spaces = dense = 0
    for char in text:
        if char.isspace():
            spaces += 1
        elif _is_cjk(char):
            cjk += 1
        elif char.isalpha():
            letters += 1
        elif char.isdigit():
            digits += 1
        else:
            dense += 1

    estimate = (
        cjk * _CJK_TOKENS_PER_CHAR
        + letters / _LETTER_CHARS_PER_TOKEN
        + (digits + dense) / _DENSE_CHARS_PER_TOKEN
        + spaces / _SPACE_CHARS_PER_TOKEN
    )
    return max(1, math.ceil(estimate))


def count_text_tokens(text: Any, model_id: str | None = None) -> int:
    """Tokens in a piece of text, tokenizer if there is one and estimate if not."""
    if text is None:
        return 0
    if not isinstance(text, str):
        try:
            text = JSONCodec.dumps(text, ensure_ascii=False)
        except Exception:
            text = str(text)
    if not text:
        return 0

    encoder = get_encoder(model_id)
    if encoder is None:
        return estimate_tokens(text)

    try:
        # Chat content is user data and may contain anything that looks like a
        # special token; counting must never raise over it.
        return len(encoder.encode(text, disallowed_special=()))
    except Exception:
        return estimate_tokens(text)


# --- images -------------------------------------------------------------------

# An image costs by area, and every provider prices it differently: OpenAI
# charges 85 tokens plus 170 per 512-pixel tile, Anthropic roughly width times
# height over 750. For the same 1024x1024 image that is 765 against 1400, so
# counting by the cheaper rule would undercount by nearly half on Claude. The
# expensive rule is the one that keeps a request inside its window.
_IMAGE_TOKENS_PER_PIXEL = 1 / 750
# What an image costs when its size cannot be read. Roughly a 1024x1024 image
# under the expensive rule: high enough that the common paste does not
# undercount, not so high that a small icon distorts the budget.
_IMAGE_TOKENS_UNKNOWN = 1400
# Anthropic and OpenAI both downscale beyond roughly 1568 and 2048 pixels, so
# an enormous image does not cost proportionally more.
_IMAGE_MAX_EDGE = 1568

_DATA_URL = re.compile(r'^data:image/[a-zA-Z0-9.+-]+;base64,')


def _image_dimensions(data: bytes) -> tuple[int, int] | None:
    """Width and height from a file header, without decoding the image.

    PNG and JPEG cover almost everything that reaches a chat: a screenshot, a
    photo, a pasted diagram. GIF is three bytes more work, so it is here too.
    """
    if data[:8] == b'\x89PNG\r\n\x1a\n' and len(data) >= 24:
        width, height = struct.unpack('>II', data[16:24])
        return int(width), int(height)

    if data[:6] in (b'GIF87a', b'GIF89a') and len(data) >= 10:
        width, height = struct.unpack('<HH', data[6:10])
        return int(width), int(height)

    if data[:2] == b'\xff\xd8':
        # Walk the segment chain to the frame header, which is the only place
        # a JPEG states its size.
        offset = 2
        while offset + 9 < len(data):
            if data[offset] != 0xFF:
                return None
            marker = data[offset + 1]
            # Start-of-frame markers, excluding the four that are not frames.
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                height, width = struct.unpack('>HH', data[offset + 5 : offset + 9])
                return int(width), int(height)
            offset += 2 + struct.unpack('>H', data[offset + 2 : offset + 4])[0]

    return None


def count_image_tokens(url: str | None) -> int:
    """What an image in the conversation costs.

    Reads the real size out of the data URL when there is one. A remote URL
    cannot be measured without fetching it, which a token count has no business
    doing, so it gets the documented default.
    """
    if not isinstance(url, str) or not _DATA_URL.match(url):
        return _IMAGE_TOKENS_UNKNOWN

    header = url.split(',', 1)[1][:64]
    try:
        # Base64 decodes in blocks of four characters; a partial block raises.
        data = base64.b64decode(header[: len(header) // 4 * 4])
    except (binascii.Error, ValueError):
        return _IMAGE_TOKENS_UNKNOWN

    try:
        size = _image_dimensions(data)
    except (struct.error, IndexError):
        size = None
    if not size:
        return _IMAGE_TOKENS_UNKNOWN

    width, height = size
    if width <= 0 or height <= 0:
        return _IMAGE_TOKENS_UNKNOWN

    longest = max(width, height)
    if longest > _IMAGE_MAX_EDGE:
        scale = _IMAGE_MAX_EDGE / longest
        width, height = width * scale, height * scale

    return max(1, math.ceil(width * height * _IMAGE_TOKENS_PER_PIXEL))


# --- messages -----------------------------------------------------------------

# Every message carries structure the content does not show: the role, the
# delimiters the chat template puts around it, and for a tool result the call
# it answers. OpenAI documents three tokens per message for its own format;
# four is the number that holds across the templates Llama, Qwen and Mistral
# ship with.
_MESSAGE_OVERHEAD = 4
# The assistant turn the model is being asked to start.
_REPLY_OVERHEAD = 3


def _count_content(content: Any, model_id: str | None) -> int:
    if content is None:
        return 0
    if isinstance(content, str):
        return count_text_tokens(content, model_id)
    if not isinstance(content, list):
        return count_text_tokens(content, model_id)

    total = 0
    for part in content:
        if not isinstance(part, dict):
            total += count_text_tokens(part, model_id)
            continue

        kind = part.get('type')
        if kind in ('image_url', 'input_image', 'image'):
            source = part.get('image_url')
            if isinstance(source, dict):
                source = source.get('url')
            total += count_image_tokens(source or part.get('url') or part.get('data'))
        else:
            total += count_text_tokens(part.get('text') or part.get('content') or part, model_id)
    return total


def count_message_tokens(message: dict, model_id: str | None = None) -> int:
    """What one message costs, including the parts that are not its content.

    Tool calls and their results are counted because in an agentic chat they
    are most of the payload -- a search that returns twenty hits outweighs
    everything the user typed.
    """
    if not isinstance(message, dict):
        return count_text_tokens(message, model_id)

    total = _MESSAGE_OVERHEAD
    total += _count_content(message.get('content'), model_id)

    for field in ('reasoning', 'reasoning_content', 'output', 'tool_calls', 'tool_call_id', 'name', 'files'):
        value = message.get(field)
        if value:
            total += count_text_tokens(value, model_id)

    return total


def count_messages_tokens(messages: list[dict] | None, model_id: str | None = None) -> int:
    """What a whole message list costs, as the request will send it."""
    if not messages:
        return 0
    return sum(count_message_tokens(message, model_id) for message in messages) + _REPLY_OVERHEAD


def count_tools_tokens(tools: Any, model_id: str | None = None) -> int:
    """What the tool definitions cost.

    They are sent on every request of a chat that has tools enabled, and a
    dozen MCP tools with full JSON schemas run to thousands of tokens. Leaving
    them out of the budget is how a request that was calculated to fit does not.
    """
    if not tools:
        return 0
    return count_text_tokens(tools, model_id)


def usage_prompt_tokens(usage: Any) -> int:
    """The prompt tokens a provider reported, under whichever name it used.

    OpenAI says prompt_tokens, Ollama says prompt_eval_count, the Responses API
    says input_tokens, and llama.cpp splits the count into what it processed
    and what it read from its cache.
    """
    if not isinstance(usage, dict):
        return 0

    for key in ('prompt_tokens', 'prompt_eval_count', 'input_tokens'):
        value = usage.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return int(value)

    processed = usage.get('prompt_n')
    cached = usage.get('cache_n')
    if processed is not None or cached is not None:
        total = int(processed or 0) + int(cached or 0)
        if total > 0:
            return total

    return 0


def usage_completion_tokens(usage: Any) -> int:
    """The tokens a provider said it generated, under whichever name it used."""
    if not isinstance(usage, dict):
        return 0

    for key in ('completion_tokens', 'output_tokens', 'eval_count', 'predicted_n'):
        value = usage.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return int(value)
    return 0
