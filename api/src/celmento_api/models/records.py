from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class HoursGoal(Base):
    __tablename__ = "hours_goal"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "log_type", name="hours_goal_account_log_unique"
        ),
        CheckConstraint(
            "log_type IN ('practice', 'supervision', 'therapy', 'training')",
            name="hours_goal_log_type_known",
        ),
        CheckConstraint(
            "hours BETWEEN 0.01 AND 99999.99", name="hours_goal_hours_valid"
        ),
        CheckConstraint(
            "length(label) BETWEEN 1 AND 120", name="hours_goal_label_length"
        ),
    )

    hours_goal_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("leader_profile.account_id", ondelete="CASCADE")
    )
    log_type: Mapped[str] = mapped_column(Text)
    hours: Mapped[Decimal] = mapped_column(Numeric(7, 2))
    label: Mapped[str] = mapped_column(Text)
