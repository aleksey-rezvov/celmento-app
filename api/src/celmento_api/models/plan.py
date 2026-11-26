from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class StatsEventKind(StrEnum):
    LIMIT_HIT = "limit_hit"
    PLANS_OPENED = "plans_opened"


class SubscriptionRequest(Base):
    __tablename__ = "subscription_request"
    __table_args__ = (
        CheckConstraint(
            "term IN ('month', 'year')", name="subscription_request_term_known"
        ),
        CheckConstraint(
            "level IN ('partner', 'promo', 'base')",
            name="subscription_request_level_known",
        ),
        CheckConstraint(
            "currency IN ('RUB', 'EUR')", name="subscription_request_currency_known"
        ),
        CheckConstraint(
            "source IN ('limit_screen', 'profile')",
            name="subscription_request_source_known",
        ),
        Index("ix_subscription_request_created_at", "created_at"),
    )

    subscription_request_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT"), unique=True
    )
    term: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class StatsEvent(Base):
    __tablename__ = "stats_event"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('limit_hit', 'plans_opened')", name="stats_event_kind_known"
        ),
        Index("ix_stats_event_kind_created_at", "kind", "created_at"),
    )

    stats_event_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT"), index=True
    )
    kind: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
