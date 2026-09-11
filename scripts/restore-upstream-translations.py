# -*- coding: utf-8 -*-
"""Put back translations upstream has and this branch has lost.

Two syncs of `live` with upstream `dev` left 866 translations empty that
upstream had filled in -- a key empty here, translated there. That is never
something the fork wants: keys are the English source, so the same key means
the same thing on both sides.

Each value is taken verbatim from upstream's file -- the literal as written
there, escapes and all -- and only the value on that one line changes. Keys
this fork added, and values it translated itself, are never touched.

Usage:
    python scripts/restore-upstream-translations.py [upstream-ref]

The ref defaults to upstream/dev. Run by scripts/sync-upstream.sh after every
merge, against the commit that was merged.
"""
import glob
import io
import json
import re
import subprocess
import sys

UPSTREAM = sys.argv[1] if len(sys.argv) > 1 else 'upstream/dev'
ENTRY = re.compile(r'^(\t)("(?:[^"\\]|\\.)*")(\s*:\s*)("(?:[^"\\]|\\.)*")(,?)(\s*)$')


def upstream_literals(path):
    """key -> the value's JSON literal, exactly as upstream writes it."""
    try:
        raw = subprocess.check_output(
            ['git', 'show', '%s:%s' % (UPSTREAM, path)], stderr=subprocess.DEVNULL
        )
    except subprocess.CalledProcessError:
        return {}
    literals = {}
    for line in raw.decode('utf-8').split('\n'):
        match = ENTRY.match(line.rstrip('\r'))
        if match and match.group(4) != '""':
            literals[json.loads(match.group(2))] = match.group(4)
    return literals


def main():
    total = 0
    per_locale = {}
    for raw_path in sorted(glob.glob('src/lib/i18n/locales/*/translation.json')):
        path = raw_path.replace('\\', '/')
        text = io.open(path, encoding='utf-8', newline='').read()
        newline = '\r\n' if '\r\n' in text else '\n'
        lines = text.split(newline)
        theirs = upstream_literals(path)

        restored = 0
        for index, line in enumerate(lines):
            match = ENTRY.match(line)
            if not match or match.group(4) != '""':
                continue
            literal = theirs.get(json.loads(match.group(2)))
            if literal:
                lines[index] = (
                    match.group(1)
                    + match.group(2)
                    + match.group(3)
                    + literal
                    + match.group(5)
                    + match.group(6)
                )
                restored += 1

        if restored:
            out = newline.join(lines)
            json.loads(out)  # still valid JSON
            io.open(path, 'w', encoding='utf-8', newline='').write(out)
            per_locale[path.split('/')[-2]] = restored
            total += restored

    for locale, count in sorted(per_locale.items(), key=lambda item: -item[1]):
        print('%6d  %s' % (count, locale))
    print('restored %d translation(s) in %d locale(s)' % (total, len(per_locale)))
    return total


if __name__ == '__main__':
    main()
