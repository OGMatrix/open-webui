#!/usr/bin/env python3
"""Works out what this fork's next release is called, and what is in it.

The fork carries its own commits on top of a moving upstream, so a release
here has to answer two questions at once: what did we change, and which
Open WebUI is it sitting on. Both are read from git rather than kept in a
file, because a file would have to be edited on every upstream merge and
would conflict there every time.

Usage:
    fork-release.py version                 # -> 0.11.3-ogm.1
    fork-release.py notes --version 0.11.3-ogm.1

Run from anywhere inside the repository.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

# The counter that separates our releases from upstream's own tags. Upstream
# uses v0.11.3; ours is v0.11.3-ogm.1, so the two never collide and the base
# it was cut from stays readable in the tag itself.
SUFFIX = 'ogm'
TAG_GLOB = f'v*-{SUFFIX}.*'

# Conventional-commit types, mapped onto the Keep a Changelog headings the
# repository's own CHANGELOG.md already uses.
SECTIONS = [
    ('Added', ('feat',)),
    ('Fixed', ('fix',)),
    ('Changed', ('perf', 'refactor', 'style', 'revert')),
    ('Documentation', ('docs',)),
    ('Internal', ('chore', 'ci', 'build', 'test')),
]
TYPE_TO_SECTION = {t: name for name, types in SECTIONS for t in types}

SUBJECT = re.compile(r'^(?P<type>[a-z]+)(?:\((?P<scope>[^)]*)\))?(?P<breaking>!)?:\s*(?P<text>.+)$')

REPO = Path(__file__).resolve().parent.parent


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(['git', *args], cwd=REPO, capture_output=True, text=True, encoding='utf-8')
    if check and result.returncode != 0:
        sys.exit(f'git {" ".join(args)} failed:\n{result.stderr.strip()}')
    return result.stdout.strip()


def base_version() -> str:
    """The upstream version this fork is currently sitting on."""
    with open(REPO / 'package.json', encoding='utf-8') as handle:
        return json.load(handle)['version']


def fork_tags() -> list[str]:
    """Our own tags, newest first."""
    return [t for t in git('tag', '--list', TAG_GLOB, '--sort=-creatordate').splitlines() if t]


def next_version(base: str) -> str:
    """The next counter for this base, so re-releasing the same base is fine."""
    prefix = f'v{base}-{SUFFIX}.'
    counters = [
        int(tag[len(prefix) :])
        for tag in git('tag', '--list', f'{prefix}*').splitlines()
        if tag.startswith(prefix) and tag[len(prefix) :].isdigit()
    ]
    return f'{base}-{SUFFIX}.{max(counters, default=0) + 1}'


def commits(*revs: str) -> list[tuple[str, str]]:
    """(short hash, subject) for a revision range, oldest first."""
    out = git('log', '--no-merges', '--reverse', '--format=%h%x1f%s', *revs)
    rows = []
    for line in out.splitlines():
        if '\x1f' in line:
            short, subject = line.split('\x1f', 1)
            rows.append((short, subject))
    return rows


def count(*revs: str) -> int:
    out = git('rev-list', '--count', '--no-merges', *revs)
    return int(out or 0)


def classify(rows: list[tuple[str, str]]) -> dict[str, list[str]]:
    """Group commits under Keep a Changelog headings by their type prefix."""
    grouped: dict[str, list[str]] = {}
    for short, subject in rows:
        match = SUBJECT.match(subject)
        if match:
            section = TYPE_TO_SECTION.get(match.group('type'), 'Changed')
            text = match.group('text')
            if match.group('breaking'):
                text = f'**Breaking.** {text}'
            scope = match.group('scope')
            if scope:
                text = f'**{scope}:** {text}'
        else:
            # A message that does not follow the convention is still a change;
            # dropping it would make the changelog quietly incomplete.
            section, text = 'Changed', subject
        grouped.setdefault(section, []).append(f'{text[:1].upper()}{text[1:]} ({short})')
    return grouped


def notes(version: str, previous: str | None, upstream: str) -> str:
    base = base_version()
    head = git('rev-parse', '--short', 'HEAD')

    bounds = ['HEAD', f'^{upstream}']
    if previous:
        bounds.append(f'^{previous}')
    own = commits(*bounds)

    lines = [f'## [{version}] - {dt.date.today().isoformat()}', '']

    upstream_short = git('rev-parse', '--short', upstream)
    lines += [
        f'Built on Open WebUI `{base}` (`{upstream}` at `{upstream_short}`), fork commit `{head}`.',
        '',
    ]

    if previous:
        previous_base = git('show', f'{previous}:package.json')
        previous_base = json.loads(previous_base)['version'] if previous_base else base
        total = count(f'{previous}..HEAD')
        from_upstream = total - len(own)
        if from_upstream > 0 or previous_base != base:
            moved = f'{previous_base} to {base}' if previous_base != base else f'still {base}'
            lines += [
                f'Upstream: {from_upstream} commit(s) merged from open-webui/open-webui, {moved}.',
                '',
            ]

    grouped = classify(own)
    if not grouped:
        lines += ['No fork changes since the previous release; upstream only.', '']
    for section, _ in SECTIONS:
        entries = grouped.get(section)
        if not entries:
            continue
        lines.append(f'### {section}')
        lines.append('')
        lines += [f'- {entry}' for entry in entries]
        lines.append('')

    return '\n'.join(lines).rstrip() + '\n'


#: Where a new entry goes in the changelog. The file states this in a comment
#: of its own so that hand edits above it survive a release.
CHANGELOG = 'CHANGELOG-FORK.md'
MARKER = '<!-- fork-release: new entries are inserted directly below this line -->'


def insert_entry(entry: str, path: str = CHANGELOG) -> int:
    """Put a release entry at the top of the changelog.

    Here rather than inline in the workflow because two jobs need it: the one
    that builds the image, so the running build can name itself, and the one
    that commits. Two copies of this would be two chances to disagree.
    """
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    if MARKER not in text:
        raise SystemExit(f'{path} has lost its insertion marker')

    head, tail = text.split(MARKER, 1)
    entry = entry.strip()
    file.write_text(f'{head}{MARKER}\n\n{entry}\n{tail.lstrip()}', encoding='utf-8', newline='\n')
    return len(entry)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)

    version_cmd = sub.add_parser('version', help='print the next fork version')
    version_cmd.add_argument('--base', default=None, help='override the upstream base')

    notes_cmd = sub.add_parser('notes', help='print release notes as markdown')
    notes_cmd.add_argument('--version', required=True)
    notes_cmd.add_argument(
        '--from',
        dest='previous',
        default=None,
        help='previous fork tag; defaults to the newest one that exists',
    )
    notes_cmd.add_argument('--upstream', default='upstream/dev')

    insert_cmd = sub.add_parser('insert', help='insert an entry into the fork changelog')
    insert_cmd.add_argument('--notes', required=True, help='file holding the entry, or - for stdin')
    insert_cmd.add_argument('--path', default=CHANGELOG)

    args = parser.parse_args()

    if args.command == 'version':
        print(next_version(args.base or base_version()))
        return

    if args.command == 'insert':
        entry = sys.stdin.read() if args.notes == '-' else Path(args.notes).read_text(encoding='utf-8')
        print(f'inserted {insert_entry(entry, args.path)} characters into {args.path}')
        return

    previous = args.previous
    if previous is None:
        tags = fork_tags()
        previous = tags[0] if tags else None
    elif previous == '':
        previous = None

    sys.stdout.write(notes(args.version, previous, args.upstream))


if __name__ == '__main__':
    main()
