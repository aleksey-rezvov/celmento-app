from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class PreseededNoteSet(Base):
    __tablename__ = "preseeded_note_set"
    __table_args__ = (
        CheckConstraint(
            "preseeded_note_set_id IN ('ru', 'en')",
            name="preseeded_note_set_language_known",
        ),
        CheckConstraint("version >= 1", name="preseeded_note_set_version_positive"),
        CheckConstraint(
            "jsonb_typeof(content) = 'object'", name="preseeded_note_set_content_object"
        ),
    )

    preseeded_note_set_id: Mapped[str] = mapped_column(Text, primary_key=True)
    version: Mapped[int] = mapped_column()
    content: Mapped[dict[str, object]] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
