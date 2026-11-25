"""Add private folders, notes, sharing and templates for new leaders."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005"
down_revision: str = "0004"
branch_labels: tuple[str, ...] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "folder",
        sa.Column(
            "folder_id", sa.Uuid(), primary_key=True, server_default=sa.text("uuidv7()")
        ),
        sa.Column(
            "owner_account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("color", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "length(name) <= 50 AND length(btrim(name)) > 0", name="folder_name_valid"
        ),
        sa.CheckConstraint(
            "color IN ('pink', 'blue', 'lilac', 'yellow', 'green', 'peach')",
            name="folder_color_known",
        ),
    )
    op.create_index(
        "ix_folder_owner_created",
        "folder",
        ["owner_account_id", "created_at", "folder_id"],
    )
    op.create_table(
        "note",
        sa.Column(
            "note_id", sa.Uuid(), primary_key=True, server_default=sa.text("uuidv7()")
        ),
        sa.Column(
            "author_account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("text", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column(
            "folder_id",
            sa.Uuid(),
            sa.ForeignKey("folder.folder_id", ondelete="SET NULL"),
        ),
        sa.Column(
            "reply_to_note_id",
            sa.Uuid(),
            sa.ForeignKey("note.note_id", ondelete="SET NULL"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("length(title) <= 200", name="note_title_length"),
        sa.CheckConstraint("length(text) <= 20000", name="note_text_length"),
        sa.CheckConstraint("reply_to_note_id <> note_id", name="note_reply_to_other"),
    )
    op.create_index(
        "ix_note_author_updated", "note", ["author_account_id", "updated_at", "note_id"]
    )
    op.create_index("ix_note_folder_id", "note", ["folder_id"])
    op.create_index("ix_note_reply_to_note_id", "note", ["reply_to_note_id"])
    op.create_table(
        "note_tag",
        sa.Column(
            "note_tag_id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("uuidv7()"),
        ),
        sa.Column(
            "note_id",
            sa.Uuid(),
            sa.ForeignKey("note.note_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_kind", sa.Text(), nullable=False),
        sa.Column(
            "client_card_id",
            sa.Uuid(),
            sa.ForeignKey("client_card.client_card_id", ondelete="RESTRICT"),
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "(target_kind = 'client_card' AND client_card_id IS NOT NULL AND account_id IS NULL) OR "
            "(target_kind = 'account' AND account_id IS NOT NULL AND client_card_id IS NULL)",
            name="note_tag_target_matches_kind",
        ),
        sa.UniqueConstraint("note_id", "client_card_id", name="note_tag_card_unique"),
        sa.UniqueConstraint("note_id", "account_id", name="note_tag_account_unique"),
    )
    op.create_index("ix_note_tag_client_card_id", "note_tag", ["client_card_id"])
    op.create_index("ix_note_tag_account_id", "note_tag", ["account_id"])
    op.create_table(
        "note_checklist_tick",
        sa.Column(
            "note_id",
            sa.Uuid(),
            sa.ForeignKey("note.note_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("checked_items", postgresql.ARRAY(sa.Integer()), nullable=False),
        sa.CheckConstraint(
            "0 <= ALL(checked_items) AND array_position(checked_items, NULL) IS NULL",
            name="note_checklist_tick_positions_valid",
        ),
    )
    op.create_index(
        "ix_note_checklist_tick_account_id", "note_checklist_tick", ["account_id"]
    )
    op.create_table(
        "tag_history",
        sa.Column(
            "leader_account_id",
            sa.Uuid(),
            sa.ForeignKey("account.account_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "client_card_id",
            sa.Uuid(),
            sa.ForeignKey("client_card.client_card_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "first_tagged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_tag_history_client_card_id", "tag_history", ["client_card_id"])
    op.create_table(
        "preseeded_note_set",
        sa.Column("preseeded_note_set_id", sa.Text(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "preseeded_note_set_id IN ('ru', 'en')",
            name="preseeded_note_set_language_known",
        ),
        sa.CheckConstraint("version >= 1", name="preseeded_note_set_version_positive"),
        sa.CheckConstraint(
            "jsonb_typeof(content) = 'object'", name="preseeded_note_set_content_object"
        ),
    )
    op.create_table(
        "note_request_receipt",
        sa.Column(
            "note_request_receipt_id",
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
        sa.Column("operation", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("request_digest", sa.Text(), nullable=False),
        sa.Column(
            "note_id", sa.Uuid(), sa.ForeignKey("note.note_id", ondelete="SET NULL")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "operation IN ('create_note', 'reply_to_note')",
            name="note_request_receipt_operation_known",
        ),
        sa.CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="note_request_receipt_digest_valid",
        ),
        sa.UniqueConstraint(
            "account_id",
            "operation",
            "idempotency_key",
            name="note_request_receipt_key_unique",
        ),
    )
    op.create_index(
        "ix_note_request_receipt_note_id", "note_request_receipt", ["note_id"]
    )


def downgrade() -> None:
    op.drop_table("note_request_receipt")
    op.drop_table("preseeded_note_set")
    op.drop_table("tag_history")
    op.drop_table("note_checklist_tick")
    op.drop_table("note_tag")
    op.drop_table("note")
    op.drop_table("folder")
