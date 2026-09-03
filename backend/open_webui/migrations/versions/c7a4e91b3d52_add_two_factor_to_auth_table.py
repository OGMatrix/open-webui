"""add two factor columns to auth table

Revision ID: c7a4e91b3d52
Revises: d4c1a8e37b62
Create Date: 2026-09-03 12:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c7a4e91b3d52'
down_revision: Union[str, None] = 'd4c1a8e37b62'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    auth_cols = {column['name'] for column in inspector.get_columns('auth')}

    # The secret is stored encrypted, so this is text rather than anything
    # shaped like a key; see utils/two_factor.py.
    if 'totp_secret' not in auth_cols:
        op.add_column('auth', sa.Column('totp_secret', sa.Text(), nullable=True))

    # Separate from the secret on purpose: a secret exists while enrolment is
    # half finished, and a half-finished enrolment must not lock anyone out.
    if 'totp_enabled' not in auth_cols:
        op.add_column(
            'auth',
            sa.Column('totp_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    # Hashed, one JSON array per account.
    if 'totp_recovery' not in auth_cols:
        op.add_column('auth', sa.Column('totp_recovery', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('auth', 'totp_recovery')
    op.drop_column('auth', 'totp_enabled')
    op.drop_column('auth', 'totp_secret')
