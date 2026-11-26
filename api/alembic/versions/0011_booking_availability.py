"""Store additional working windows and dated booking closures."""

import sqlalchemy as sa

from alembic import op

revision: str = "0011"
down_revision: str = "0010"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "working_interval",
        sa.Column(
            "working_interval_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("weekday", sa.Text(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.ForeignKeyConstraint(
            ("account_id", "weekday"),
            ("working_day.account_id", "working_day.weekday"),
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "account_id", "weekday", "start_time", name="working_interval_start_unique"
        ),
        sa.CheckConstraint("end_time > start_time", name="working_interval_order"),
        sa.CheckConstraint(
            "extract(minute FROM start_time) % 15 = 0 "
            "AND extract(second FROM start_time) = 0 "
            "AND extract(hour FROM start_time) < 24 "
            "AND extract(minute FROM end_time) % 15 = 0 "
            "AND extract(second FROM end_time) = 0 "
            "AND extract(hour FROM end_time) < 24",
            name="working_interval_quarter_hours",
        ),
    )
    op.create_table(
        "booking_time_block",
        sa.Column(
            "booking_time_block_id",
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
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="booking_time_block_order"),
        sa.UniqueConstraint(
            "account_id", "starts_at", "ends_at", name="booking_time_block_range_unique"
        ),
    )


def downgrade() -> None:
    op.drop_table("booking_time_block")
    op.drop_table("working_interval")
