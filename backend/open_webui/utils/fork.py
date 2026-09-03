"""What this fork is, and what changed in it.

Kept apart from upstream's own version and changelog rather than replacing
them. The Open WebUI License forbids altering, removing, obscuring or replacing
the identifiers that distinguish the software, and the source marks the release
identifier as one of them; the fork's own build is stated alongside, never in
place of. See NOTICE-FORK.md.

The version is read out of CHANGELOG-FORK.md rather than kept in a field of its
own. The release workflow writes that file, so the two cannot disagree, and
package.json stays untouched — a fork version written into a file upstream also
edits would put a conflict in the way of every upstream merge.
"""

import logging
import os
import pkgutil

import markdown
from bs4 import BeautifulSoup
from open_webui.env import BASE_DIR, parse_section

log = logging.getLogger(__name__)

CHANGELOG_FILE = 'CHANGELOG-FORK.md'

#: Where this fork lives. Overridable so a further fork of it is not left
#: pointing at releases that are not its own.
FORK_REPO_URL = os.environ.get('FORK_REPO_URL', 'https://github.com/OGMatrix/open-webui').rstrip('/')


def _read_changelog() -> str:
    """The fork changelog, from the checkout or from the installed package."""
    path = BASE_DIR / CHANGELOG_FILE
    try:
        with open(str(path.absolute()), encoding='utf8') as handle:
            return handle.read()
    except Exception:
        try:
            return (pkgutil.get_data('open_webui', CHANGELOG_FILE) or b'').decode()
        except Exception:
            # A checkout that has never cut a release has no such file, and that
            # is not an error: there is simply nothing of the fork to report.
            log.debug('no %s found; fork details will be omitted', CHANGELOG_FILE)
            return ''


def _parse(content: str) -> dict:
    """Same shape as upstream's changelog, so the dialog can render either."""
    if not content.strip():
        return {}

    soup = BeautifulSoup(markdown.markdown(content), 'html.parser')
    versions: dict = {}

    for heading in soup.find_all('h2'):
        text = heading.get_text().strip()
        if ' - ' not in text:
            continue
        label, date = text.split(' - ', 1)
        version = label.strip().strip('[]')
        if not version:
            continue

        entry: dict = {'date': date.strip()}
        current = heading.find_next_sibling()
        while current and current.name != 'h2':
            if current.name == 'h3':
                entry[current.get_text().lower()] = parse_section(current.find_next_sibling('ul'))
            current = current.find_next_sibling()

        versions[version] = entry

    return versions


FORK_CHANGELOG = _parse(_read_changelog())

#: The newest release named in the changelog, or empty before the first one.
FORK_VERSION = next(iter(FORK_CHANGELOG), '')


def release_url(version: str = '') -> str:
    """Where the notes for a fork release are published."""
    tag = (version or FORK_VERSION).strip()
    return f'{FORK_REPO_URL}/releases/tag/v{tag}' if tag else f'{FORK_REPO_URL}/releases'


def fork_info() -> dict:
    """What the interface needs to name this build beside upstream's."""
    return {
        'version': FORK_VERSION,
        'repo_url': FORK_REPO_URL,
        'release_url': release_url(),
    }
