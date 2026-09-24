"""Handing the reader a file, from wherever the assistant produced it.

The assistant works on files in places the browser cannot reach: a terminal it
runs commands in, a filesystem exposed over MCP, or nothing at all -- text it
just wrote in the answer. Presenting a file turns any of those into one thing
the reader can keep: a copy stored here, owned by them, attached to the chat.

The copy is the point. A link back into a terminal session is dead the moment
that session ends, and a chat is read weeks later. Copying costs storage, so a
size limit applies (`file.present_max_size`, in MB).

What this module does not do is decide anything about the chat: it resolves a
path to bytes, stores them, and hands back a file item. The builtin tool around
it -- `present_file` in tools/builtin.py -- is what the model calls.
"""

import base64
import io
import logging
import mimetypes
import os
import re
from typing import Any
from urllib.parse import quote

import aiohttp
from fastapi import UploadFile
from open_webui.env import AIOHTTP_CLIENT_SESSION_SSL
from open_webui.models.config import Config
from open_webui.models.users import UserModel
from open_webui.utils.access_control import has_connection_access
from open_webui.utils.mcp import filesystem as mcp_filesystem
from open_webui.utils.terminals import get_terminal_request_info

log = logging.getLogger(__name__)

#: Admin setting, in MB. Generous enough for a report, a dataset or a recording,
#: small enough that a runaway loop cannot quietly fill the disk.
MAX_SIZE_KEY = 'file.present_max_size'
DEFAULT_MAX_SIZE_MB = 50

#: Read in pieces so a file past the limit is dropped before it is all in memory.
CHUNK = 256 * 1024

_UNSAFE_NAME = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')
_DATA_URI = re.compile(r'^data:([\w.+-]+/[\w.+-]+)?(;charset=[\w-]+)?(;base64)?,', re.IGNORECASE)


class PresentError(Exception):
    """Something the model can act on: the message is written for it."""


async def max_size_bytes() -> int:
    configured = await Config.get(MAX_SIZE_KEY, DEFAULT_MAX_SIZE_MB)
    try:
        megabytes = float(configured)
    except (TypeError, ValueError):
        megabytes = DEFAULT_MAX_SIZE_MB
    return int(max(megabytes, 0) * 1024 * 1024)


def format_size(size: int) -> str:
    """A size a person reads, for the line the model gets back."""
    units = ('B', 'KB', 'MB', 'GB')
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f'{value:.0f} {unit}' if unit == 'B' or value >= 100 else f'{value:.1f} {unit}'
        value /= 1024
    return f'{size} B'


def file_name_for(name: str, path: str = '', content_type: str = '') -> str:
    """The name the file is offered under.

    Taken from what the model asked for, else from the path it came from. Any
    directory part is dropped: this names a download, not a location.
    """
    candidate = (name or '').strip() or os.path.basename((path or '').replace('\\', '/').rstrip('/'))
    candidate = _UNSAFE_NAME.sub('', candidate).strip().strip('.')
    candidate = candidate[:255]
    if not candidate:
        candidate = 'file'
    if '.' not in candidate and content_type:
        extension = mimetypes.guess_extension(content_type.split(';')[0].strip())
        if extension:
            candidate = f'{candidate}{extension}'
    return candidate


#: Types a source hands out when it does not know either.
WEAK_TYPES = {'', 'application/octet-stream', 'binary/octet-stream', 'text/plain'}

#: Formats worth naming ourselves. `mimetypes` reads the registry on Windows,
#: where .csv belongs to Excel and .md to nothing, so the same file would be
#: handed over as a different type depending on the machine serving it.
KNOWN_TYPES = {
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'csv': 'text/csv',
    'tsv': 'text/tab-separated-values',
    'txt': 'text/plain',
    'log': 'text/plain',
    'json': 'application/json',
    'yaml': 'application/yaml',
    'yml': 'application/yaml',
    'toml': 'text/plain',
    'ini': 'text/plain',
    'sql': 'text/plain',
    'sh': 'text/x-shellscript',
    'py': 'text/x-python',
    'js': 'text/javascript',
    'ts': 'text/plain',
}


def content_type_for(name: str, content_type: str = '') -> str:
    """What the file is.

    A declared type wins, unless it is one of the types that say almost
    nothing: content written into the call arrives as plain text, and
    `notes.md` is markdown however it was written.
    """
    declared = (content_type or '').split(';')[0].strip().lower()
    if declared not in WEAK_TYPES:
        return declared
    extension = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    if extension in KNOWN_TYPES:
        return KNOWN_TYPES[extension]
    guessed, _ = mimetypes.guess_type(name)
    return guessed or declared or 'application/octet-stream'


def bytes_from_content(content: str) -> tuple[bytes, str]:
    """The bytes of content the model wrote out itself.

    Plain text in the usual case. A `data:` URI is decoded, which is how a
    model that produced something binary -- a small image, a PDF from a tool --
    can still hand it over without a file to point at.
    """
    match = _DATA_URI.match(content or '')
    if match:
        payload = content[match.end() :]
        declared = match.group(1) or 'text/plain'
        if match.group(3):
            try:
                return base64.b64decode(payload, validate=True), declared
            except Exception as error:
                raise PresentError('content is not valid base64') from error
        return payload.encode('utf-8'), declared
    return (content or '').encode('utf-8'), 'text/plain'


def _media_bytes(content: Any) -> tuple[bytes, str] | None:
    """Base64 out of an MCP result, for servers that can read a binary file."""
    blocks = content if isinstance(content, list) else [content]
    for block in blocks:
        if not isinstance(block, dict):
            continue
        data = block.get('data')
        if isinstance(data, str) and data:
            try:
                return base64.b64decode(data, validate=True), str(block.get('mimeType') or '')
            except Exception:
                continue
    return None


async def read_from_terminal(request, user, metadata: dict, limit: int, path: str) -> tuple[bytes, str] | None:
    """The file as the terminal this chat is working in sees it.

    None when no terminal is connected, so the caller can try the next source;
    a PresentError when the terminal is there and says no.
    """
    info = await get_terminal_request_info(request, user, metadata or {})
    if not info:
        return None

    url, headers, cookies = info
    endpoint = f'{str(url).rstrip("/")}/files/view?path={quote(path, safe="")}'
    try:
        async with aiohttp.ClientSession(cookies=cookies or None) as session:
            async with session.get(endpoint, headers=headers, ssl=AIOHTTP_CLIENT_SESSION_SSL) as response:
                if response.status == 404:
                    raise PresentError(f'no file at {path} on the terminal')
                if response.status >= 400:
                    raise PresentError(f'the terminal refused to read {path} (HTTP {response.status})')

                data = bytearray()
                async for chunk in response.content.iter_chunked(CHUNK):
                    data.extend(chunk)
                    if len(data) > limit:
                        raise PresentError(f'{path} is larger than the {format_size(limit)} a presented file may be')
                return bytes(data), response.headers.get('Content-Type', '')
    except PresentError:
        raise
    except Exception as error:
        log.debug('present_file: terminal read failed for %s: %s', path, error)
        raise PresentError(f'the terminal could not be reached for {path}') from error


async def _ask_server(request, user_model, connection, path: str, refusals: list[str]) -> tuple[bytes, str] | None:
    """What one filesystem server has for this path, if anything.

    Binary first where the server can read it, text otherwise: a server that
    only knows `read_text_file` still hands over a CSV correctly, and one that
    knows `read_media_file` is the only way a PDF survives the trip.
    """
    from open_webui.utils.tools import build_tool_server_headers

    server_id = str(connection.get('id') or '')
    url = connection.get('url', '')
    try:
        headers, _ = await build_tool_server_headers(connection, request, user_model, server_id=server_id)
        specs = await mcp_filesystem.fetch_specs(url, headers or None, (server_id, str(user_model.id)))
    except Exception as error:
        log.debug('present_file: %s did not answer: %s', server_id, error)
        return None

    tools = mcp_filesystem.resolve_tools(specs)
    for operation in ('media', 'read'):
        tool_name = tools.get(operation)
        if not tool_name:
            continue
        try:
            result = await mcp_filesystem.call(url, headers or None, tool_name, {'path': path})
        except Exception as error:
            # Kept rather than raised: another server may still have the file,
            # and if none does this is the reason worth telling the model.
            refusals.append(str(error).strip().splitlines()[0][:200])
            continue

        content = result.get('content')
        media = _media_bytes(content) if operation == 'media' else None
        if media:
            return media
        text = mcp_filesystem.result_text(content)
        if text:
            return text.encode('utf-8'), ''
    return None


async def read_from_filesystem(request, user, limit: int, path: str) -> tuple[bytes, str] | None:
    """The file from a filesystem MCP server this user may reach.

    Every enabled server is asked, in configuration order, until one has it: a
    path only exists on one of them, and the model does not name the server.
    """
    user_model = user if isinstance(user, UserModel) else UserModel(**user)
    connections = mcp_filesystem.mcp_connections(await Config.get('tool_server.connections', []))
    refusals: list[str] = []

    for connection in connections:
        if not await has_connection_access(user_model, connection):
            continue
        found = await _ask_server(request, user_model, connection, path, refusals)
        if found is None:
            continue
        data, content_type = found
        if len(data) > limit:
            raise PresentError(f'{path} is larger than the {format_size(limit)} a presented file may be')
        return data, content_type

    if refusals:
        raise PresentError(f'the filesystem could not read {path}: {refusals[0]}')
    return None


async def store_presented_file(request, user, metadata: dict, name: str, data: bytes, content_type: str) -> dict:
    """Keep the bytes as a file of this user's, and describe it for the chat.

    Stored without indexing: this is a download, not something to search. The
    item mirrors what an uploaded file looks like, plus `presented`, which is
    what tells the chat to show it as a handed-over file rather than as an
    attachment of the question.
    """
    from open_webui.routers.files import upload_file_handler

    metadata = metadata or {}
    upload = UploadFile(
        file=io.BytesIO(data),
        filename=name,
        headers={'content-type': content_type},
    )
    file_item = await upload_file_handler(
        request,
        file=upload,
        metadata={key: metadata.get(key) for key in ('chat_id', 'message_id', 'session_id') if metadata.get(key)},
        process=False,
        user=user if isinstance(user, UserModel) else UserModel(**user),
    )
    file_id = file_item.id if hasattr(file_item, 'id') else file_item['id']

    return {
        'type': 'file',
        'id': file_id,
        'url': f'/api/v1/files/{file_id}/content',
        'name': name,
        'size': len(data),
        'content_type': content_type,
        'presented': True,
    }
