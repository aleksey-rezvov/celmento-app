"""Store a certification hours goal for each leader and hours log."""

import sqlalchemy as sa

from alembic import op

revision: str = "0010"
down_revision: str = "0009"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "hours_goal",
        sa.Column(
            "hours_goal_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("leader_profile.account_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("log_type", sa.Text(), nullable=False),
        sa.Column("hours", sa.Numeric(7, 2), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.UniqueConstraint(
            "account_id", "log_type", name="hours_goal_account_log_unique"
        ),
        sa.CheckConstraint(
            "log_type IN ('practice', 'supervision', 'therapy', 'training')",
            name="hours_goal_log_type_known",
        ),
        sa.CheckConstraint(
            "hours BETWEEN 0.01 AND 99999.99", name="hours_goal_hours_valid"
        ),
        sa.CheckConstraint(
            "length(label) BETWEEN 1 AND 120", name="hours_goal_label_length"
        ),
    )


def downgrade() -> None:
    op.drop_table("hours_goal")
