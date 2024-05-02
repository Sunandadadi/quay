"""create new table

Revision ID: 15905c71f57c
Revises: 36cd2b747a08
Create Date: 2024-05-01 13:54:56.469927

"""

# revision identifiers, used by Alembic.
revision = '15905c71f57c'
down_revision = '36cd2b747a08'

import sqlalchemy as sa


def upgrade(op, tables, tester):
    op.create_table(
        "manifestlog",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_manifestlog")),
    )

def downgrade(op, tables, tester):
    op.drop_table("manifestlog")
