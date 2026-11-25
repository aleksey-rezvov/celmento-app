from datetime import date as LocalDate
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class BalanceOperation(Base):
    __tablename__ = "balance_operation"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('payment', 'session_charge', 'missed_charge', "
            "'refund_to_balance', 'deleted_meeting_charge', 'correction')",
            name="balance_operation_kind_known",
        ),
        CheckConstraint(
            "amount > '-Infinity'::numeric AND amount < 'Infinity'::numeric",
            name="balance_operation_amount_finite",
        ),
        CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')",
            name="balance_operation_currency_known",
        ),
        CheckConstraint(
            "currency_version >= 1", name="balance_operation_currency_version_valid"
        ),
        CheckConstraint(
            "(kind <> 'payment' AND created_by_system) OR "
            "(kind = 'payment' AND NOT created_by_system AND amount > 0 AND meeting_id IS NULL)",
            name="balance_operation_payment_valid",
        ),
    )

    balance_operation_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    client_card_id: Mapped[UUID] = mapped_column(
        ForeignKey("client_card.client_card_id", ondelete="RESTRICT"), index=True
    )
    kind: Mapped[str] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(Text)
    currency_version: Mapped[int] = mapped_column()
    date: Mapped[LocalDate] = mapped_column()
    comment: Mapped[str | None] = mapped_column(Text)
    meeting_id: Mapped[UUID | None] = mapped_column(index=True)
    created_by_system: Mapped[bool] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
