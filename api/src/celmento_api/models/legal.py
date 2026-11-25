from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class LegalDocumentVersion(Base):
    __tablename__ = "legal_document_version"
    __table_args__ = (
        UniqueConstraint(
            "document", "version", name="legal_document_version_document_version_key"
        ),
        Index(
            "legal_document_version_document_uploaded_at_idx", "document", "uploaded_at"
        ),
    )

    legal_document_version_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    document: Mapped[str] = mapped_column(Text)
    version: Mapped[str] = mapped_column(Text)
    title_ru: Mapped[str] = mapped_column(Text)
    title_en: Mapped[str] = mapped_column(Text)
    text_ru: Mapped[str] = mapped_column(Text)
    text_en: Mapped[str] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class Acceptance(Base):
    __tablename__ = "acceptance"
    __table_args__ = (
        CheckConstraint(
            "(account_id IS NULL) <> (meeting_id IS NULL)",
            name="acceptance_has_one_subject",
        ),
        CheckConstraint(
            "(kind = 'age_confirmation') = (version IS NULL)",
            name="acceptance_requires_document_version",
        ),
    )

    acceptance_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT"), index=True
    )
    meeting_id: Mapped[UUID | None] = mapped_column(index=True)
    kind: Mapped[str] = mapped_column(Text)
    version: Mapped[str | None] = mapped_column(Text)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
