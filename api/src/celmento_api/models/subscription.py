from datetime import date, datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class Subscription(Base):
    __tablename__ = "subscription"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"), primary_key=True
    )
    until: Mapped[date] = mapped_column()
    granted_by: Mapped[str] = mapped_column(Text)
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
