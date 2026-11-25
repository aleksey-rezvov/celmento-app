"""Create client cards, balance operations, subscriptions and request receipts."""

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str = "0002"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "client_card",
        sa.Column(
            "client_card_id",
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
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("photo_key", sa.Text()),
        sa.Column("phone", sa.Text()),
        sa.Column("email", sa.Text()),
        sa.Column("telegram", sa.Text()),
        sa.Column("whatsapp", sa.Text()),
        sa.Column("other_contact", sa.Text()),
        sa.Column("preferred_channel", sa.Text()),
        sa.Column("self_given_email", sa.Text()),
        sa.Column("rate", sa.Numeric(19, 4)),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column(
            "currency_version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column("payment_type", sa.Text(), nullable=False),
        sa.Column("request", sa.Text()),
        sa.Column("goals", sa.Text()),
        sa.Column("info", sa.Text()),
        sa.Column("hypotheses", sa.Text()),
        sa.Column(
            "status", sa.Text(), server_default=sa.text("'active'"), nullable=False
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column(
            "linked_account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
        ),
        sa.Column("link_method", sa.Text()),
        sa.Column("unlinked_by_client_at", sa.DateTime(timezone=True)),
        sa.Column(
            "auto_link_blocked",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "is_new", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("guest_language", sa.Text()),
        sa.Column("guest_time_zone", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("length(btrim(name)) > 0", name="client_card_name_nonempty"),
        sa.CheckConstraint(
            "preferred_channel IN ('phone', 'email', 'telegram', 'whatsapp', 'other')",
            name="client_card_preferred_channel_known",
        ),
        sa.CheckConstraint(
            "self_given_email <> '' AND self_given_email = lower(btrim(self_given_email))",
            name="client_card_self_given_email_normalized",
        ),
        sa.CheckConstraint(
            "rate >= 0 AND rate < 'Infinity'::numeric", name="client_card_rate_valid"
        ),
        sa.CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')", name="client_card_currency_known"
        ),
        sa.CheckConstraint(
            "currency_version >= 1", name="client_card_currency_version_valid"
        ),
        sa.CheckConstraint(
            "payment_type IN ('paid', 'pro_bono', 'barter')",
            name="client_card_payment_type_known",
        ),
        sa.CheckConstraint(
            "payment_type <> 'paid' OR rate IS NULL OR rate > 0",
            name="client_card_paid_rate_valid",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'archived')", name="client_card_status_known"
        ),
        sa.CheckConstraint(
            "(status = 'archived') = (archived_at IS NOT NULL)",
            name="client_card_archive_time_matches_status",
        ),
        sa.CheckConstraint(
            "linked_account_id IS DISTINCT FROM leader_account_id",
            name="client_card_link_excludes_leader",
        ),
        sa.CheckConstraint(
            "link_method IN ('auto', 'login')", name="client_card_link_method_known"
        ),
        sa.CheckConstraint(
            "(linked_account_id IS NULL) = (link_method IS NULL)",
            name="client_card_link_has_method",
        ),
        sa.CheckConstraint(
            "source IN ('created', 'booked_via_link')", name="client_card_source_known"
        ),
        sa.CheckConstraint(
            "NOT is_new OR source = 'booked_via_link'",
            name="client_card_new_only_from_booking",
        ),
        sa.CheckConstraint(
            "guest_language IN ('ru', 'en')", name="client_card_guest_language_known"
        ),
    )
    op.create_index(
        "ix_client_card_leader_account_id_self_given_email",
        "client_card",
        ["leader_account_id", "self_given_email"],
    )
    op.create_index(
        "ix_client_card_self_given_email", "client_card", ["self_given_email"]
    )
    op.create_index(
        "ix_client_card_linked_account_id", "client_card", ["linked_account_id"]
    )
    op.create_index(
        "client_card_leader_linked_account_unique",
        "client_card",
        ["leader_account_id", "linked_account_id"],
        unique=True,
        postgresql_where=sa.text("linked_account_id IS NOT NULL"),
    )
    op.create_table(
        "balance_operation",
        sa.Column(
            "balance_operation_id",
            sa.Uuid(),
            server_default=sa.text("uuidv7()"),
            primary_key=True,
        ),
        sa.Column(
            "client_card_id",
            sa.Uuid(),
            sa.ForeignKey("client_card.client_card_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(19, 4), nullable=False),
        sa.Column("currency", sa.Text(), nullable=False),
        sa.Column("currency_version", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("comment", sa.Text()),
        sa.Column("meeting_id", sa.Uuid()),
        sa.Column("created_by_system", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('payment', 'session_charge', 'missed_charge', "
            "'refund_to_balance', 'deleted_meeting_charge', 'correction')",
            name="balance_operation_kind_known",
        ),
        sa.CheckConstraint(
            "amount > '-Infinity'::numeric AND amount < 'Infinity'::numeric",
            name="balance_operation_amount_finite",
        ),
        sa.CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')", name="balance_operation_currency_known"
        ),
        sa.CheckConstraint(
            "currency_version >= 1", name="balance_operation_currency_version_valid"
        ),
        sa.CheckConstraint(
            "(kind <> 'payment' AND created_by_system) OR "
            "(kind = 'payment' AND NOT created_by_system AND amount > 0 AND meeting_id IS NULL)",
            name="balance_operation_payment_valid",
        ),
    )
    op.create_index(
        "ix_balance_operation_client_card_id", "balance_operation", ["client_card_id"]
    )
    op.create_index(
        "ix_balance_operation_meeting_id", "balance_operation", ["meeting_id"]
    )
    op.create_table(
        "subscription",
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("until", sa.Date(), nullable=False),
        sa.Column("granted_by", sa.Text(), nullable=False),
        sa.Column(
            "granted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_table(
        "client_request_receipt",
        sa.Column(
            "client_request_receipt_id",
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
        sa.Column(
            "client_card_id",
            sa.Uuid(),
            sa.ForeignKey("client_card.client_card_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("request_digest", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "leader_account_id",
            "operation",
            "idempotency_key",
            name="client_request_receipt_key_unique",
        ),
        sa.CheckConstraint(
            "operation IN ('create_client', 'create_client_payment')",
            name="client_request_receipt_operation_known",
        ),
        sa.CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="client_request_receipt_digest_valid",
        ),
    )
    op.create_index(
        "ix_client_request_receipt_client_card_id",
        "client_request_receipt",
        ["client_card_id"],
    )


def downgrade() -> None:
    op.drop_table("client_request_receipt")
    op.drop_table("subscription")
    op.drop_table("balance_operation")
    op.drop_table("client_card")
