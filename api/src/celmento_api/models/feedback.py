from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class FeedbackMessage(Base):
    __tablename__ = "feedback_message"
    __table_args__ = (
        CheckConstraint("screen = 'profile'", name="feedback_message_screen_known"),
        CheckConstraint(
            "length(text) BETWEEN 1 AND 5000", name="feedback_message_text_length"
        ),
    )

    feedback_message_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=sql_text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT"), index=True
    )
    activated: Mapped[bool] = mapped_column()
    screen: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sql_text("now()")
    )
