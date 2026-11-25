"""Record guest booking consent and retain it when the meeting is deleted."""

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str = "0005"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("acceptance", sa.Column("guest_booking_id", sa.Uuid()))
    op.execute(
        "UPDATE acceptance SET guest_booking_id = meeting_id WHERE account_id IS NULL"
    )
    op.drop_constraint("acceptance_has_one_subject", "acceptance", type_="check")
    op.execute(
        "UPDATE acceptance SET meeting_id = NULL WHERE meeting_id IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM meeting WHERE meeting.meeting_id = acceptance.meeting_id)"
    )
    op.create_check_constraint(
        "acceptance_has_one_subject",
        "acceptance",
        "(account_id IS NULL) <> (guest_booking_id IS NULL)",
    )
    op.create_check_constraint(
        "acceptance_live_meeting_matches_booking",
        "acceptance",
        "meeting_id IS NULL OR (guest_booking_id IS NOT NULL AND meeting_id = guest_booking_id)",
    )
    op.create_foreign_key(
        "acceptance_meeting_id_fkey",
        "acceptance",
        "meeting",
        ["meeting_id"],
        ["meeting_id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_acceptance_guest_booking_id", "acceptance", ["guest_booking_id"]
    )
    op.add_column("meeting", sa.Column("guest_language", sa.Text()))
    op.add_column("meeting", sa.Column("guest_time_zone", sa.Text()))
    op.add_column(
        "meeting",
        sa.Column(
            "public_id",
            sa.Uuid(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
    )
    op.create_unique_constraint("meeting_public_id_key", "meeting", ["public_id"])
    op.create_check_constraint(
        "meeting_guest_language_known", "meeting", "guest_language IN ('ru', 'en')"
    )
    op.create_check_constraint(
        "meeting_guest_locale_matches_booking",
        "meeting",
        "(guest_language IS NULL) = (guest_time_zone IS NULL) AND "
        "(guest_language IS NULL OR source = 'self_booked')",
    )
    op.create_table(
        "guest_booking_receipt",
        sa.Column(
            "guest_booking_receipt_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "leader_account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column(
            "meeting_id",
            sa.Uuid(),
            sa.ForeignKey("meeting.meeting_id", ondelete="SET NULL"),
        ),
        sa.Column("public_id", sa.Uuid(), nullable=False),
        sa.Column("request_digest", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "leader_account_id",
            "idempotency_key",
            name="guest_booking_receipt_key_unique",
        ),
        sa.CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="guest_booking_receipt_digest_valid",
        ),
    )
    op.create_index(
        "ix_guest_booking_receipt_meeting_id", "guest_booking_receipt", ["meeting_id"]
    )


def downgrade() -> None:
    op.drop_table("guest_booking_receipt")
    op.drop_constraint("meeting_guest_locale_matches_booking", "meeting", type_="check")
    op.drop_constraint("meeting_guest_language_known", "meeting", type_="check")
    op.drop_constraint("meeting_public_id_key", "meeting", type_="unique")
    op.drop_column("meeting", "public_id")
    op.drop_column("meeting", "guest_time_zone")
    op.drop_column("meeting", "guest_language")
    op.drop_constraint("acceptance_meeting_id_fkey", "acceptance", type_="foreignkey")
    op.drop_constraint(
        "acceptance_live_meeting_matches_booking", "acceptance", type_="check"
    )
    op.drop_constraint("acceptance_has_one_subject", "acceptance", type_="check")
    op.execute(
        "UPDATE acceptance SET meeting_id = guest_booking_id WHERE meeting_id IS NULL"
    )
    op.create_check_constraint(
        "acceptance_has_one_subject",
        "acceptance",
        "(account_id IS NULL) <> (meeting_id IS NULL)",
    )
    op.drop_index("ix_acceptance_guest_booking_id", table_name="acceptance")
    op.drop_column("acceptance", "guest_booking_id")
