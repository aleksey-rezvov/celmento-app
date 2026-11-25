from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy import text as sql
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class Folder(Base):
    __tablename__ = "folder"
    __table_args__ = (
        CheckConstraint(
            "length(name) <= 50 AND length(btrim(name)) > 0", name="folder_name_valid"
        ),
        CheckConstraint(
            "color IN ('pink', 'blue', 'lilac', 'yellow', 'green', 'peach')",
            name="folder_color_known",
        ),
        Index("ix_folder_owner_created", "owner_account_id", "created_at", "folder_id"),
    )

    folder_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=sql("uuidv7()")
    )
    owner_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sql("now()")
    )


class Note(Base):
    __tablename__ = "note"
    __table_args__ = (
        CheckConstraint("length(title) <= 200", name="note_title_length"),
        CheckConstraint("length(text) <= 20000", name="note_text_length"),
        CheckConstraint("reply_to_note_id <> note_id", name="note_reply_to_other"),
        Index("ix_note_author_updated", "author_account_id", "updated_at", "note_id"),
    )

    note_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=sql("uuidv7()")
    )
    author_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    title: Mapped[str] = mapped_column(Text, server_default=sql("''"))
    text: Mapped[str] = mapped_column(Text, server_default=sql("''"))
    folder_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("folder.folder_id", ondelete="SET NULL"), index=True
    )
    reply_to_note_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("note.note_id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sql("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sql("now()")
    )


class NoteTag(Base):
    __tablename__ = "note_tag"
    __table_args__ = (
        CheckConstraint(
            "(target_kind = 'client_card' AND client_card_id IS NOT NULL AND account_id IS NULL) OR "
            "(target_kind = 'account' AND account_id IS NOT NULL AND client_card_id IS NULL)",
            name="note_tag_target_matches_kind",
        ),
        UniqueConstraint("note_id", "client_card_id", name="note_tag_card_unique"),
        UniqueConstraint("note_id", "account_id", name="note_tag_account_unique"),
    )

    note_tag_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=sql("uuidv7()")
    )
    note_id: Mapped[UUID] = mapped_column(
        ForeignKey("note.note_id", ondelete="CASCADE")
    )
    target_kind: Mapped[str] = mapped_column(Text)
    client_card_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("client_card.client_card_id", ondelete="RESTRICT"), index=True
    )
    account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sql("now()")
    )


class NoteChecklistTick(Base):
    __tablename__ = "note_checklist_tick"
    __table_args__ = (
        CheckConstraint(
            "0 <= ALL(checked_items) AND array_position(checked_items, NULL) IS NULL",
            name="note_checklist_tick_positions_valid",
        ),
    )

    note_id: Mapped[UUID] = mapped_column(
        ForeignKey("note.note_id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    checked_items: Mapped[list[int]] = mapped_column(ARRAY(Integer()))


class TagHistory(Base):
    __tablename__ = "tag_history"

    leader_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"), primary_key=True
    )
    client_card_id: Mapped[UUID] = mapped_column(
        ForeignKey("client_card.client_card_id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    first_tagged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sql("now()")
    )


class NoteWriteOperation(StrEnum):
    CREATE_NOTE = "create_note"
    REPLY_TO_NOTE = "reply_to_note"


class NoteRequestReceipt(Base):
    __tablename__ = "note_request_receipt"
    __table_args__ = (
        CheckConstraint(
            "operation IN ('create_note', 'reply_to_note')",
            name="note_request_receipt_operation_known",
        ),
        CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="note_request_receipt_digest_valid",
        ),
        UniqueConstraint(
            "account_id",
            "operation",
            "idempotency_key",
            name="note_request_receipt_key_unique",
        ),
    )

    note_request_receipt_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=sql("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    operation: Mapped[str] = mapped_column(Text)
    idempotency_key: Mapped[UUID] = mapped_column()
    request_digest: Mapped[str] = mapped_column(Text)
    note_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("note.note_id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sql("now()")
    )
