"""Store subscription requests and plan statistics events."""

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str = "0006"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "subscription_request",
        sa.Column(
            "subscription_request_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("term", sa.Text(), nullable=False),
        sa.Column("level", sa.Text(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "term IN ('month', 'year')", name="subscription_request_term_known"
        ),
        sa.CheckConstraint(
            "level IN ('partner', 'promo', 'base')",
            name="subscription_request_level_known",
        ),
        sa.CheckConstraint(
            "currency IN ('RUB', 'EUR')", name="subscription_request_currency_known"
        ),
        sa.CheckConstraint(
            "source IN ('limit_screen', 'profile')",
            name="subscription_request_source_known",
        ),
    )
    op.create_index(
        "ix_subscription_request_created_at", "subscription_request", ["created_at"]
    )
    op.create_table(
        "stats_event",
        sa.Column(
            "stats_event_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('limit_hit', 'plans_opened')", name="stats_event_kind_known"
        ),
    )
    op.create_index("ix_stats_event_account_id", "stats_event", ["account_id"])
    op.create_index(
        "ix_stats_event_kind_created_at", "stats_event", ["kind", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("stats_event")
    op.drop_table("subscription_request")
