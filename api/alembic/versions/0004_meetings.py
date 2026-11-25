"""Add meetings and retain their references in balance operations."""

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str = "0003"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "meeting",
        sa.Column(
            "meeting_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column(
            "leader_account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column(
            "client_card_id",
            sa.Uuid(),
            sa.ForeignKey("client_card.client_card_id", ondelete="RESTRICT"),
        ),
        sa.Column("with_whom", sa.Text()),
        sa.Column("topic", sa.Text()),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("my_duration_minutes", sa.Integer()),
        sa.Column("actual_duration_minutes", sa.Integer()),
        sa.Column("place", sa.Text(), nullable=False),
        sa.Column("meeting_link", sa.Text()),
        sa.Column("address", sa.Text()),
        sa.Column("price", sa.Numeric(19, 4)),
        sa.Column("currency", sa.Text()),
        sa.Column("currency_version", sa.Integer()),
        sa.Column("payment_type", sa.Text()),
        sa.Column(
            "status", sa.Text(), server_default=sa.text("'scheduled'"), nullable=False
        ),
        sa.Column("charged", sa.Boolean()),
        sa.Column("comment", sa.Text()),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("client_comment", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "type IN ('client_session', 'personal_therapy', 'supervision', 'training', 'mutual_practice')",
            name="meeting_type_known",
        ),
        sa.CheckConstraint(
            "(type = 'client_session') = (client_card_id IS NOT NULL) AND "
            "(type = 'client_session') = (payment_type IS NOT NULL) AND "
            "(type = 'client_session') = (currency_version IS NOT NULL)",
            name="meeting_client_fields_match_type",
        ),
        sa.CheckConstraint(
            "type <> 'client_session' OR (with_whom IS NULL AND topic IS NULL)",
            name="meeting_client_has_no_with_whom",
        ),
        sa.CheckConstraint("duration_minutes > 0", name="meeting_duration_valid"),
        sa.CheckConstraint(
            "(type = 'mutual_practice') = (my_duration_minutes IS NOT NULL) AND "
            "(my_duration_minutes IS NULL OR my_duration_minutes BETWEEN 1 AND duration_minutes)",
            name="meeting_own_duration_valid",
        ),
        sa.CheckConstraint(
            "(status = 'completed') = (actual_duration_minutes IS NOT NULL) AND "
            "(actual_duration_minutes IS NULL OR actual_duration_minutes > 0)",
            name="meeting_actual_duration_matches_status",
        ),
        sa.CheckConstraint(
            "place IN ('online', 'in_person')", name="meeting_place_known"
        ),
        sa.CheckConstraint(
            "(meeting_link IS NULL OR place = 'online') AND "
            "(address IS NULL OR place = 'in_person')",
            name="meeting_location_matches_place",
        ),
        sa.CheckConstraint(
            "price >= 0 AND price < 'Infinity'::numeric", name="meeting_price_valid"
        ),
        sa.CheckConstraint(
            "(type = 'mutual_practice') = (price IS NULL) AND "
            "(type = 'mutual_practice') = (currency IS NULL)",
            name="meeting_price_matches_type",
        ),
        sa.CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')", name="meeting_currency_known"
        ),
        sa.CheckConstraint(
            "currency_version >= 1", name="meeting_currency_version_valid"
        ),
        sa.CheckConstraint(
            "payment_type IN ('paid', 'pro_bono', 'barter')",
            name="meeting_payment_type_known",
        ),
        sa.CheckConstraint(
            "payment_type <> 'paid' OR price > 0", name="meeting_paid_price_valid"
        ),
        sa.CheckConstraint(
            "status IN ('scheduled', 'completed', 'not_taken_place')",
            name="meeting_status_known",
        ),
        sa.CheckConstraint(
            "(status = 'not_taken_place') = (charged IS NOT NULL)",
            name="meeting_charge_decision_matches_status",
        ),
        sa.CheckConstraint(
            "source IN ('specialist', 'self_booked')", name="meeting_source_known"
        ),
    )
    op.create_index(
        "ix_meeting_leader_account_id_starts_at",
        "meeting",
        ["leader_account_id", "starts_at"],
    )
    op.create_index(
        "ix_meeting_client_card_id_starts_at",
        "meeting",
        ["client_card_id", "starts_at"],
    )
    op.create_foreign_key(
        "fk_balance_operation_meeting_id",
        "balance_operation",
        "meeting",
        ["meeting_id"],
        ["meeting_id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "meeting_create_receipt",
        sa.Column(
            "meeting_create_receipt_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
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
            name="meeting_create_receipt_key_unique",
        ),
        sa.CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="meeting_create_receipt_digest_valid",
        ),
    )
    op.create_index(
        "ix_meeting_create_receipt_meeting_id", "meeting_create_receipt", ["meeting_id"]
    )

    op.create_table(
        "meeting_expense_correction",
        sa.Column(
            "meeting_expense_correction_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column(
            "meeting_id",
            sa.Uuid(),
            sa.ForeignKey("meeting.meeting_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("clock_timestamp()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "amount <> 0 AND amount > '-Infinity'::numeric AND amount < 'Infinity'::numeric",
            name="meeting_expense_correction_amount_valid",
        ),
        sa.CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')",
            name="meeting_expense_correction_currency_known",
        ),
    )
    op.create_index(
        "ix_meeting_expense_correction_meeting_id",
        "meeting_expense_correction",
        ["meeting_id"],
    )


def downgrade() -> None:
    op.drop_table("meeting_expense_correction")
    op.drop_table("meeting_create_receipt")
    op.drop_constraint(
        "fk_balance_operation_meeting_id", "balance_operation", type_="foreignkey"
    )
    op.drop_table("meeting")
