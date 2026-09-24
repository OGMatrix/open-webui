# -*- coding: utf-8 -*-
"""Put back translations upstream has and this branch has lost.

A sync can lose a translation in two ways, and both have happened here:

- the key survives with an empty value while upstream has it filled in
  (two syncs left 866 like that), or
- the key is dropped entirely, so the interface shows the key itself
  (one sync dropped all 1075 `settings.*` keys upstream had just added,
  in all 64 locales -- every settings page read `settings.admin...label`).

Neither is ever something the fork wants: keys are the English source, so the
same key means the same thing on both sides.

Each value is taken verbatim from upstream's file -- the literal as written
there, escapes and all. A key that is missing here is inserted where upstream
keeps it, after the nearest key ahead of it that this file already has. Keys
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


def upstream_entries(path):
    """(key -> value literal exactly as upstream writes it, keys in upstream's order)."""
    try:
        raw = subprocess.check_output(
            ['git', 'show', '%s:%s' % (UPSTREAM, path)], stderr=subprocess.DEVNULL
        )
    except subprocess.CalledProcessError:
        return {}, []
    literals = {}
    order = []
    for line in raw.decode('utf-8').split('\n'):
        match = ENTRY.match(line.rstrip('\r'))
        if not match:
            continue
        key = json.loads(match.group(2))
        order.append(key)
        if match.group(4) != '""':
            literals[key] = match.group(4)
    return literals, order


def key_at(lines, index):
    match = ENTRY.match(lines[index])
    return json.loads(match.group(2)) if match else None


def fill_empty(lines, literals):
    """Give an empty value the translation upstream has for that key."""
    filled = 0
    for index, line in enumerate(lines):
        match = ENTRY.match(line)
        if not match or match.group(4) != '""':
            continue
        literal = literals.get(json.loads(match.group(2)))
        if literal:
            lines[index] = (
                match.group(1)
                + match.group(2)
                + match.group(3)
                + literal
                + match.group(5)
                + match.group(6)
            )
            filled += 1
    return filled


def add_missing(lines, literals, order):
    """Insert keys this file does not have, where upstream keeps them.

    Walking upstream's order means each key inserted becomes the anchor for the
    next one, so a run of new keys lands in one block rather than scattered.
    """
    positions = {}
    for index in range(len(lines)):
        key = key_at(lines, index)
        if key is not None:
            positions[key] = index

    added = 0
    for position, key in enumerate(order):
        if key in positions or key not in literals:
            continue

        anchor = None
        for earlier in range(position - 1, -1, -1):
            if order[earlier] in positions:
                anchor = positions[order[earlier]]
                break

        at = anchor + 1 if anchor is not None else min(positions.values(), default=1)
        lines.insert(at, '\t%s: %s,' % (json.dumps(key, ensure_ascii=False), literals[key]))
        positions = {name: (index + 1 if index >= at else index) for name, index in positions.items()}
        positions[key] = at
        added += 1
    return added


def fix_commas(lines):
    """A comma after every entry but the last, whatever the inserts shifted."""
    entries = [index for index in range(len(lines)) if ENTRY.match(lines[index])]
    for position, index in enumerate(entries):
        match = ENTRY.match(lines[index])
        comma = '' if position == len(entries) - 1 else ','
        lines[index] = match.group(1) + match.group(2) + match.group(3) + match.group(4) + comma


def main():
    total_filled = total_added = 0
    per_locale = {}
    for raw_path in sorted(glob.glob('src/lib/i18n/locales/*/translation.json')):
        path = raw_path.replace('\\', '/')
        text = io.open(path, encoding='utf-8', newline='').read()
        newline = '\r\n' if '\r\n' in text else '\n'
        lines = text.split(newline)
        literals, order = upstream_entries(path)
        if not literals:
            continue

        before = {key_at(lines, index): lines[index] for index in range(len(lines)) if key_at(lines, index)}

        filled = fill_empty(lines, literals)
        added = add_missing(lines, literals, order)
        if not filled and not added:
            continue
        fix_commas(lines)

        out = newline.join(lines)
        parsed = json.loads(out, object_pairs_hook=lambda pairs: pairs)  # still valid JSON
        keys = [key for key, _ in parsed]
        assert len(keys) == len(set(keys)), '%s: duplicate keys' % path
        assert set(before) <= set(keys), '%s: lost a key' % path

        io.open(path, 'w', encoding='utf-8', newline='').write(out)
        per_locale[path.split('/')[-2]] = (filled, added)
        total_filled += filled
        total_added += added

    for locale, (filled, added) in sorted(per_locale.items(), key=lambda item: -sum(item[1])):
        print('%6d filled %6d added  %s' % (filled, added, locale))
    print(
        'restored %d empty and %d missing translation(s) in %d locale(s)'
        % (total_filled, total_added, len(per_locale))
    )
    return total_filled + total_added


if __name__ == '__main__':
    main()
