from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class AdminKey(Base):
    __tablename__ = "admin_key"
    __table_args__ = (
        CheckConstraint("key_hash ~ '^[0-9a-f]{64}$'", name="admin_key_digest_valid"),
        CheckConstraint(
            "length(label) BETWEEN 1 AND 100", name="admin_key_label_length"
        ),
    )

    admin_key_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    key_hash: Mapped[str] = mapped_column(Text, unique=True)
    label: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminJournalEntry(Base):
    __tablename__ = "admin_journal_entry"
    __table_args__ = (
        CheckConstraint(
            "action IN ('list_feedback', 'mark_feedback_processed', 'get_statistics', "
            "'get_preseeded_notes', 'replace_preseeded_notes', 'lookup_account', "
            "'grant_subscription', 'upload_legal_document_version', "
            "'list_reserved_login_words', 'add_reserved_login_word', 'list_journal')",
            name="admin_journal_entry_action_known",
        ),
        CheckConstraint(
            "object_type IN ('feedback', 'statistics', 'preseeded_notes', 'account', "
            "'subscription', 'legal_document', 'reserved_login_word', 'journal')",
            name="admin_journal_entry_object_type_known",
        ),
        CheckConstraint(
            "jsonb_typeof(params) = 'object'", name="admin_journal_entry_params_object"
        ),
        CheckConstraint(
            "jsonb_typeof(before) = 'object'", name="admin_journal_entry_before_object"
        ),
        CheckConstraint(
            "jsonb_typeof(after) = 'object'", name="admin_journal_entry_after_object"
        ),
        Index("ix_admin_journal_entry_created_at", "created_at"),
    )

    admin_journal_entry_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    admin_key_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_key.admin_key_id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("clock_timestamp()")
    )
    action: Mapped[str] = mapped_column(Text)
    object_type: Mapped[str] = mapped_column(Text)
    object_id: Mapped[str | None] = mapped_column(Text)
    params: Mapped[dict[str, object]] = mapped_column(JSONB)
    before: Mapped[dict[str, object] | None] = mapped_column(JSONB(none_as_null=True))
    after: Mapped[dict[str, object] | None] = mapped_column(JSONB(none_as_null=True))
