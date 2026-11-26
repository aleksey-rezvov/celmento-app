from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class Meeting(Base):
    __tablename__ = "meeting"
    __table_args__ = (
        Index(
            "ix_meeting_leader_account_id_starts_at", "leader_account_id", "starts_at"
        ),
        Index("ix_meeting_client_card_id_starts_at", "client_card_id", "starts_at"),
        UniqueConstraint("public_id", name="meeting_public_id_key"),
        CheckConstraint(
            "type IN ('client_session', 'personal_therapy', 'supervision', 'training', 'mutual_practice')",
            name="meeting_type_known",
        ),
        CheckConstraint(
            "(type = 'client_session') = (client_card_id IS NOT NULL) AND "
            "(type = 'client_session') = (payment_type IS NOT NULL) AND "
            "(type = 'client_session') = (currency_version IS NOT NULL)",
            name="meeting_client_fields_match_type",
        ),
        CheckConstraint(
            "type <> 'client_session' OR (with_whom IS NULL AND topic IS NULL)",
            name="meeting_client_has_no_with_whom",
        ),
        CheckConstraint("duration_minutes > 0", name="meeting_duration_valid"),
        CheckConstraint(
            "(type = 'mutual_practice') = (my_duration_minutes IS NOT NULL) AND "
            "(my_duration_minutes IS NULL OR my_duration_minutes BETWEEN 1 AND duration_minutes)",
            name="meeting_own_duration_valid",
        ),
        CheckConstraint(
            "(status = 'completed') = (actual_duration_minutes IS NOT NULL) AND "
            "(actual_duration_minutes IS NULL OR actual_duration_minutes > 0)",
            name="meeting_actual_duration_matches_status",
        ),
        CheckConstraint("place IN ('online', 'in_person')", name="meeting_place_known"),
        CheckConstraint(
            "(meeting_link IS NULL OR place = 'online') AND "
            "(address IS NULL OR place = 'in_person')",
            name="meeting_location_matches_place",
        ),
        CheckConstraint(
            "price >= 0 AND price < 'Infinity'::numeric", name="meeting_price_valid"
        ),
        CheckConstraint(
            "(type = 'mutual_practice') = (price IS NULL) AND "
            "(type = 'mutual_practice') = (currency IS NULL)",
            name="meeting_price_matches_type",
        ),
        CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')", name="meeting_currency_known"
        ),
        CheckConstraint("currency_version >= 1", name="meeting_currency_version_valid"),
        CheckConstraint(
            "payment_type IN ('paid', 'pro_bono', 'barter')",
            name="meeting_payment_type_known",
        ),
        CheckConstraint(
            "payment_type <> 'paid' OR price > 0", name="meeting_paid_price_valid"
        ),
        CheckConstraint(
            "status IN ('scheduled', 'completed', 'not_taken_place')",
            name="meeting_status_known",
        ),
        CheckConstraint(
            "(status = 'not_taken_place') = (charged IS NOT NULL)",
            name="meeting_charge_decision_matches_status",
        ),
        CheckConstraint(
            "source IN ('specialist', 'self_booked')", name="meeting_source_known"
        ),
        CheckConstraint(
            "guest_language IN ('ru', 'en')", name="meeting_guest_language_known"
        ),
        CheckConstraint(
            "(guest_language IS NULL) = (guest_time_zone IS NULL) AND "
            "(guest_language IS NULL OR source = 'self_booked')",
            name="meeting_guest_locale_matches_booking",
        ),
    )

    meeting_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    # spec:impl meeting-invite-page#make-meeting-id-address-random
    public_id: Mapped[UUID] = mapped_column(server_default=text("gen_random_uuid()"))
    leader_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    type: Mapped[str] = mapped_column(Text)
    client_card_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("client_card.client_card_id", ondelete="RESTRICT")
    )
    with_whom: Mapped[str | None] = mapped_column(Text)
    topic: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_minutes: Mapped[int] = mapped_column()
    my_duration_minutes: Mapped[int | None] = mapped_column()
    actual_duration_minutes: Mapped[int | None] = mapped_column()
    place: Mapped[str] = mapped_column(Text)
    meeting_link: Mapped[str | None] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(Text)
    price: Mapped[Decimal | None] = mapped_column(Numeric(19, 4))
    currency: Mapped[str | None] = mapped_column(Text)
    currency_version: Mapped[int | None] = mapped_column()
    payment_type: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'scheduled'"))
    charged: Mapped[bool | None] = mapped_column()
    comment: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    client_comment: Mapped[str | None] = mapped_column(Text)
    guest_language: Mapped[str | None] = mapped_column(Text)
    guest_time_zone: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class BookingTimeBlock(Base):
    __tablename__ = "booking_time_block"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="booking_time_block_order"),
        UniqueConstraint(
            "account_id", "starts_at", "ends_at", name="booking_time_block_range_unique"
        ),
    )

    booking_time_block_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("leader_profile.account_id", ondelete="CASCADE")
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class MeetingCreateReceipt(Base):
    __tablename__ = "meeting_create_receipt"
    __table_args__ = (
        UniqueConstraint(
            "leader_account_id",
            "idempotency_key",
            name="meeting_create_receipt_key_unique",
        ),
        CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="meeting_create_receipt_digest_valid",
        ),
    )

    meeting_create_receipt_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    leader_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    idempotency_key: Mapped[UUID] = mapped_column()
    meeting_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("meeting.meeting_id", ondelete="SET NULL"), index=True
    )
    request_digest: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class GuestBookingReceipt(Base):
    __tablename__ = "guest_booking_receipt"
    __table_args__ = (
        UniqueConstraint(
            "leader_account_id",
            "idempotency_key",
            name="guest_booking_receipt_key_unique",
        ),
        CheckConstraint(
            "request_digest ~ '^[0-9a-f]{64}$'",
            name="guest_booking_receipt_digest_valid",
        ),
    )

    guest_booking_receipt_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    leader_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    idempotency_key: Mapped[UUID] = mapped_column()
    meeting_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("meeting.meeting_id", ondelete="SET NULL"), index=True
    )
    public_id: Mapped[UUID] = mapped_column()
    request_digest: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class MeetingExpenseCorrection(Base):
    __tablename__ = "meeting_expense_correction"
    __table_args__ = (
        CheckConstraint(
            "amount <> 0 AND amount > '-Infinity'::numeric AND amount < 'Infinity'::numeric",
            name="meeting_expense_correction_amount_valid",
        ),
        CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')",
            name="meeting_expense_correction_currency_known",
        ),
    )

    meeting_expense_correction_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    meeting_id: Mapped[UUID] = mapped_column(
        ForeignKey("meeting.meeting_id", ondelete="CASCADE"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("clock_timestamp()")
    )
