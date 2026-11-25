from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class ClientWriteOperation(StrEnum):
    CREATE_CLIENT = "create_client"
    CREATE_PAYMENT = "create_client_payment"


class ClientRequestReceipt(Base):
    __tablename__ = "client_request_receipt"
    __table_args__ = (
        UniqueConstraint(
            "leader_account_id",
            "operation",
            "idempotency_key",
            name="client_request_receipt_key_unique",
        ),
        CheckConstraint(
            "operation IN ('create_client', 'create_client_payment')",
            name="client_request_receipt_operation_known",
        ),
        CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="client_request_receipt_digest_valid",
        ),
    )

    client_request_receipt_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    leader_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    client_card_id: Mapped[UUID] = mapped_column(
        ForeignKey("client_card.client_card_id", ondelete="RESTRICT"), index=True
    )
    operation: Mapped[str] = mapped_column(Text)
    idempotency_key: Mapped[UUID] = mapped_column()
    request_digest: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
