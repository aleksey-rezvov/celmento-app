"""Store administrator keys and their journal and retain original guest cards."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008"
down_revision: str = "0007"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "admin_key",
        sa.Column(
            "admin_key_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column("key_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "key_hash ~ '^[0-9a-f]{64}$'", name="admin_key_digest_valid"
        ),
        sa.CheckConstraint(
            "length(label) BETWEEN 1 AND 100", name="admin_key_label_length"
        ),
    )
    op.create_table(
        "admin_journal_entry",
        sa.Column(
            "admin_journal_entry_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "admin_key_id",
            sa.Uuid(),
            sa.ForeignKey("admin_key.admin_key_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("clock_timestamp()"),
        ),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("object_id", sa.Text()),
        sa.Column("params", postgresql.JSONB(), nullable=False),
        sa.Column("before", postgresql.JSONB(none_as_null=True)),
        sa.Column("after", postgresql.JSONB(none_as_null=True)),
        sa.CheckConstraint(
            "action IN ('list_feedback', 'mark_feedback_processed', 'get_statistics', "
            "'get_preseeded_notes', 'replace_preseeded_notes', 'lookup_account', "
            "'grant_subscription', 'upload_legal_document_version', "
            "'list_reserved_login_words', 'add_reserved_login_word', 'list_journal')",
            name="admin_journal_entry_action_known",
        ),
        sa.CheckConstraint(
            "object_type IN ('feedback', 'statistics', 'preseeded_notes', 'account', "
            "'subscription', 'legal_document', 'reserved_login_word', 'journal')",
            name="admin_journal_entry_object_type_known",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(params) = 'object'", name="admin_journal_entry_params_object"
        ),
        sa.CheckConstraint(
            "jsonb_typeof(before) = 'object'", name="admin_journal_entry_before_object"
        ),
        sa.CheckConstraint(
            "jsonb_typeof(after) = 'object'", name="admin_journal_entry_after_object"
        ),
    )
    op.create_index(
        "ix_admin_journal_entry_admin_key_id", "admin_journal_entry", ["admin_key_id"]
    )
    op.create_index(
        "ix_admin_journal_entry_created_at", "admin_journal_entry", ["created_at"]
    )
    op.add_column("acceptance", sa.Column("guest_client_card_id", sa.Uuid()))
    op.create_foreign_key(
        "acceptance_guest_client_card_id_fkey",
        "acceptance",
        "client_card",
        ["guest_client_card_id"],
        ["client_card_id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_acceptance_guest_client_card_id", "acceptance", ["guest_client_card_id"]
    )
    op.create_check_constraint(
        "acceptance_guest_card_requires_booking",
        "acceptance",
        "guest_client_card_id IS NULL OR guest_booking_id IS NOT NULL",
    )
    op.execute(
        "UPDATE acceptance SET guest_client_card_id = meeting.client_card_id "
        "FROM meeting WHERE acceptance.meeting_id = meeting.meeting_id "
        "AND meeting.guest_language IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("acceptance", "guest_client_card_id")
    op.drop_table("admin_journal_entry")
    op.drop_table("admin_key")
