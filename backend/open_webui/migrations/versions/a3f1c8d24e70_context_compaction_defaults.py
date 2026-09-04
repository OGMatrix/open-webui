"""move context compaction to automatic detection

Revision ID: a3f1c8d24e70
Revises: c7a4e91b3d52
Create Date: 2026-09-04 12:00:00.000000

Config defaults only apply to keys that have no row yet, and startup seeds a
row for every known key. So an installation that has ever started carries the
old values regardless of what the defaults now say -- without this, the change
would take effect on fresh installations only, which is the silent kind of
not-working.

Two values move, and only from exactly what the old defaults were:

    token_threshold  80000 -> 0    0 means "read it from the model's own
                                   context window". A fixed 80,000 is wrong
                                   for every model it was not chosen for: a
                                   32k model overflows long before it fires,
                                   and two thirds of a 200k model goes unused.

    enable           False -> True The feature only acts when a conversation
                                   is about to stop fitting, and at that point
                                   the alternatives are a refused request or a
                                   silently truncated one.

The second is a judgment call worth stating plainly: a stored False is
indistinguishable from a deliberate opt-out, so an administrator who turned
this off will find it on again and has to turn it off once more. It is a
visible switch in Settings > Interface, and the alternative was for a
default-on feature to remain off for everyone who already runs Open WebUI.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3f1c8d24e70'
down_revision: Union[str, None] = 'c7a4e91b3d52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

config_table = sa.table('config', sa.column('key', sa.Text), sa.column('value', sa.JSON))

ENABLE_KEY = 'chat.context_compaction.enable'
THRESHOLD_KEY = 'chat.context_compaction.token_threshold'

OLD_THRESHOLD = 80000


def _rows(conn) -> dict:
    result = conn.execute(sa.select(config_table.c.key, config_table.c.value).where(
        config_table.c.key.in_([ENABLE_KEY, THRESHOLD_KEY])
    ))
    return {key: value for key, value in result}


def _set(conn, key, value) -> None:
    conn.execute(config_table.update().where(config_table.c.key == key).values(value=value))


def upgrade() -> None:
    conn = op.get_bind()
    if not sa.inspect(conn).has_table('config'):
        return

    rows = _rows(conn)

    # `is False` rather than a plain comparison: JSON false and the integer 0
    # are equal in Python, and these two keys hold one of each.
    if rows.get(ENABLE_KEY) is False:
        _set(conn, ENABLE_KEY, True)

    threshold = rows.get(THRESHOLD_KEY)
    if isinstance(threshold, int) and not isinstance(threshold, bool) and threshold == OLD_THRESHOLD:
        _set(conn, THRESHOLD_KEY, 0)


def downgrade() -> None:
    """Put back the one value that can be put back.

    The threshold is unambiguous: zero was never a setting anyone chose, so it
    can only have come from here.

    The enable flag is not. A True after this migration might have been set by
    it, or by an administrator before or since, and nothing distinguishes the
    two -- so turning it off here would silently undo someone's decision. It is
    left alone, and switching it off is a click in Settings > Interface.
    """
    conn = op.get_bind()
    if not sa.inspect(conn).has_table('config'):
        return

    threshold = _rows(conn).get(THRESHOLD_KEY)
    if isinstance(threshold, int) and not isinstance(threshold, bool) and threshold == 0:
        _set(conn, THRESHOLD_KEY, OLD_THRESHOLD)
