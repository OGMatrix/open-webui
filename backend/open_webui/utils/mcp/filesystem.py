"""Browsing a filesystem that is exposed over MCP.

A filesystem MCP server is configured so a model can read a project. The same
connection can show that project to the person watching, which is otherwise
guesswork: the chat says it read a file, and there is no way to look.

Two things shape this module.

**It only reads.** The operations below are a closed set, and every one of them
maps to a tool that cannot change anything. A server may well offer
`write_file` and `move_file`; nothing here can reach them. The browser is a
window, not a second way to act, and the button that deletes a file should be
the one the user went looking for rather than one that happened to be nearby.

**It does not trust the shape of an answer.** MCP tools return text meant for a
model to read, and different servers format it differently. Every parser tries
structured output first, then JSON, then the documented text layout, and
finally hands back the raw text rather than pretending the directory was empty.
"""

import json
import logging
import re
from typing import Any

log = logging.getLogger(__name__)

#: Operation -> the tool names that can serve it, best first.
#:
#: Only tools that read. Adding a writing tool here would turn the file browser
#: into a way to change the filesystem, which is not what it is for.
READ_OPERATIONS: dict[str, tuple[str, ...]] = {
    'roots': ('list_allowed_directories',),
    'list': ('list_directory_with_sizes', 'list_directory'),
    'tree': ('directory_tree',),
    'read': ('read_text_file', 'read_file'),
    'info': ('get_file_info',),
    'search': ('search_files',),
}


def resolve_tools(specs: list[dict] | None) -> dict[str, str]:
    """Which tool this server offers for each operation it can serve."""
    available = {spec.get('name') for spec in (specs or []) if isinstance(spec, dict)}
    resolved = {}
    for operation, candidates in READ_OPERATIONS.items():
        for candidate in candidates:
            if candidate in available:
                resolved[operation] = candidate
                break
    return resolved


def is_filesystem_server(specs: list[dict] | None) -> bool:
    """Whether this server can show a directory at all.

    Listing is the one operation without which there is nothing to show; a
    server that can only read a file by name has no tree to offer.
    """
    return 'list' in resolve_tools(specs)


def result_text(content: Any) -> str:
    """The text of an MCP tool result.

    A result is a list of content blocks; the text ones are what a filesystem
    server answers with, and they are joined in order.
    """
    if content is None:
        return ''
    if isinstance(content, str):
        return content

    parts = []
    for block in content if isinstance(content, list) else [content]:
        if isinstance(block, dict):
            if block.get('type') == 'text' and isinstance(block.get('text'), str):
                parts.append(block['text'])
        elif isinstance(block, str):
            parts.append(block)
    return '\n'.join(parts)


def _loads(text: str) -> Any:
    """JSON in a string, or None. Servers often answer with JSON as text."""
    stripped = (text or '').strip()
    if not stripped or stripped[0] not in '[{':
        return None
    try:
        return json.loads(stripped)
    except (ValueError, TypeError):
        return None


#: `[FILE] name.txt` or `[DIR] subdir`, optionally followed by a size.
_ENTRY = re.compile(r'^\s*\[(FILE|DIR)\]\s+(.+?)\s*$')
#: The size `list_directory_with_sizes` appends, e.g. `  1.23 KB` or `  512 B`.
_TRAILING_SIZE = re.compile(r'^(.*?)\s{2,}([\d.,]+)\s*(B|KB|MB|GB|TB|bytes?)\s*$', re.IGNORECASE)

_UNIT_FACTOR = {
    'b': 1,
    'byte': 1,
    'bytes': 1,
    'kb': 1024,
    'mb': 1024**2,
    'gb': 1024**3,
    'tb': 1024**4,
}


def _parse_size(number: str, unit: str) -> int | None:
    try:
        value = float(number.replace(',', ''))
    except ValueError:
        return None
    factor = _UNIT_FACTOR.get(unit.strip().lower())
    if factor is None:
        return None
    return int(round(value * factor))


def _entry(name: str, is_directory: bool, size: int | None = None) -> dict:
    return {'name': name, 'type': 'directory' if is_directory else 'file', 'size': size}


def _entry_from_object(item: dict) -> dict | None:
    """One entry out of a structured listing, whatever the server called things."""
    name = item.get('name') or item.get('path') or item.get('file') or item.get('filename')
    if not isinstance(name, str) or not name:
        return None

    kind = str(item.get('type') or item.get('kind') or '').lower()
    is_directory = (
        kind in ('directory', 'dir', 'folder')
        or bool(item.get('isDirectory'))
        or bool(item.get('is_directory'))
        or 'children' in item
    )

    size = item.get('size') or item.get('bytes')
    if not isinstance(size, int):
        size = None

    # A structured listing may give the full path; the tree shows names.
    name = name.rstrip('/\\').rsplit('/', 1)[-1].rsplit('\\', 1)[-1] or name

    return _entry(name, is_directory, size)


def parse_directory_listing(content: Any, structured: Any = None) -> dict:
    """The entries of a directory, from whatever the server sent back.

    Returns ``{'entries': [...], 'raw': str, 'parsed': bool}``. When nothing
    could be recognised, ``parsed`` is False and ``raw`` carries the answer, so
    the caller can show the reader what the server actually said instead of an
    empty folder that may not be empty.
    """
    text = result_text(content)

    for candidate in (structured, _loads(text)):
        items = candidate
        if isinstance(items, dict):
            # Servers wrap the list under a key of their choosing.
            for key in ('entries', 'files', 'items', 'result', 'contents', 'children'):
                if isinstance(items.get(key), list):
                    items = items[key]
                    break
        if isinstance(items, list):
            entries = [
                entry for entry in (_entry_from_object(item) for item in items if isinstance(item, dict)) if entry
            ]
            if entries:
                return {'entries': entries, 'raw': text, 'parsed': True}

    entries = []
    for line in text.splitlines():
        match = _ENTRY.match(line)
        if not match:
            continue

        kind, remainder = match.group(1), match.group(2)
        size = None

        sized = _TRAILING_SIZE.match(remainder)
        if sized:
            remainder = sized.group(1).rstrip()
            size = _parse_size(sized.group(2), sized.group(3))

        entries.append(_entry(remainder, kind == 'DIR', size))

    return {'entries': entries, 'raw': text, 'parsed': bool(entries)}


def parse_allowed_directories(content: Any, structured: Any = None) -> list[str]:
    """The roots a server is willing to show.

    Without these there is nowhere for the tree to start, so a server that does
    not answer leaves the caller to ask the user for a path.
    """
    for candidate in (structured, _loads(result_text(content))):
        if isinstance(candidate, dict):
            candidate = candidate.get('directories') or candidate.get('roots')
        if isinstance(candidate, list):
            roots = [item for item in candidate if isinstance(item, str) and item.strip()]
            if roots:
                return roots

    roots = []
    for line in result_text(content).splitlines():
        line = line.strip()
        # The header the reference server prints before the list.
        if not line or line.lower().startswith('allowed director'):
            continue
        roots.append(line)
    return roots


_INFO_LINE = re.compile(r'^\s*([A-Za-z_][A-Za-z0-9_ ]*)\s*:\s*(.*?)\s*$')

_INFO_ALIASES = {
    'size': 'size',
    'created': 'created',
    'modified': 'modified',
    'accessed': 'accessed',
    'isdirectory': 'isDirectory',
    'isfile': 'isFile',
    'permissions': 'permissions',
    'name': 'name',
    'type': 'type',
}


def parse_file_info(content: Any, structured: Any = None) -> dict:
    """What a server knows about one entry.

    The modified time is the point of this: it is what lets the browser say
    which files moved since the reader last looked.
    """
    for candidate in (structured, _loads(result_text(content))):
        if isinstance(candidate, dict) and candidate:
            return candidate

    info: dict[str, Any] = {}
    for line in result_text(content).splitlines():
        match = _INFO_LINE.match(line)
        if not match:
            continue
        key = _INFO_ALIASES.get(match.group(1).replace(' ', '').lower())
        if not key:
            continue

        value: Any = match.group(2)
        if key == 'size':
            try:
                value = int(str(value).split()[0].replace(',', ''))
            except (ValueError, IndexError):
                pass
        elif key in ('isDirectory', 'isFile'):
            value = str(value).strip().lower() in ('true', 'yes', '1')
        info[key] = value

    return info


# ── connecting ────────────────────────────────────────────────────────────────

#: How long a server's tool list is trusted, keyed by server and user.
#:
#: Listing tools means dialling the server, and the file browser asks which
#: servers are filesystems every time it opens. The list changes when an admin
#: reconfigures a server, which is rare enough that a minute is generous.
_SPEC_CACHE_TTL = 60.0
_spec_cache: dict[tuple[str, str], tuple[float, list[dict]]] = {}


def find_connection(connections: list[dict] | None, server_id: str) -> dict | None:
    """The enabled MCP connection with this id."""
    for connection in connections or []:
        if connection.get('type', 'openapi') != 'mcp':
            continue
        if not (connection.get('config') or {}).get('enable'):
            continue
        if ((connection.get('info') or {}).get('id')) == server_id:
            return connection
    return None


def mcp_connections(connections: list[dict] | None) -> list[dict]:
    """Every enabled MCP connection, in configuration order."""
    return [
        connection
        for connection in connections or []
        if connection.get('type', 'openapi') == 'mcp' and (connection.get('config') or {}).get('enable')
    ]


async def fetch_specs(url: str, headers: dict | None, cache_key: tuple[str, str]) -> list[dict]:
    """This server's tool list, remembered briefly.

    Connecting is the expensive part, and the browser asks which servers are
    filesystems every time it opens.
    """
    import time

    from open_webui.utils.mcp.client import MCPClient

    cached = _spec_cache.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    client = MCPClient()
    try:
        await client.connect(url, headers=headers)
        specs = await client.list_tool_specs() or []
    finally:
        await client.disconnect()

    _spec_cache[cache_key] = (time.monotonic() + _SPEC_CACHE_TTL, specs)
    return specs


async def call(url: str, headers: dict | None, tool_name: str, arguments: dict) -> dict:
    """One tool call, with whatever structure the server chose to send.

    The caller has already decided that `tool_name` is one of the reading tools
    this module knows about; nothing here can be asked to run something else.
    """
    from open_webui.utils.mcp.client import MCPClient

    client = MCPClient()
    try:
        await client.connect(url, headers=headers)
        return await client.call_tool_result(tool_name, arguments)
    finally:
        await client.disconnect()
