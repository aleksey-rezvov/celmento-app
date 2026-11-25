from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class Notice(Base):
    __tablename__ = "notice"
    __table_args__ = (
        CheckConstraint(
            "tab IN ('people', 'meetings', 'profile')", name="notice_tab_known"
        ),
        CheckConstraint(
            "key IN ('notify.limit_new_client', 'notify.archived_client_tried', "
            "'notify.invite_registered', 'client.linked_notice', "
            "'notify.rescheduled', 'notify.cancelled', 'admin.access_granted')",
            name="notice_key_known",
        ),
        CheckConstraint("jsonb_typeof(params) = 'object'", name="notice_params_object"),
    )

    notice_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"), index=True
    )
    tab: Mapped[str] = mapped_column(Text)
    key: Mapped[str] = mapped_column(Text)
    params: Mapped[dict[str, str]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
