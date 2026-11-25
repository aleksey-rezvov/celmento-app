from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class ClientCard(Base):
    __tablename__ = "client_card"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="client_card_name_nonempty"),
        CheckConstraint(
            "preferred_channel IN ('phone', 'email', 'telegram', 'whatsapp', 'other')",
            name="client_card_preferred_channel_known",
        ),
        CheckConstraint(
            "self_given_email <> '' AND self_given_email = lower(btrim(self_given_email))",
            name="client_card_self_given_email_normalized",
        ),
        CheckConstraint(
            "rate >= 0 AND rate < 'Infinity'::numeric", name="client_card_rate_valid"
        ),
        CheckConstraint(
            "currency IN ('RUB', 'EUR', 'USD')", name="client_card_currency_known"
        ),
        CheckConstraint(
            "currency_version >= 1", name="client_card_currency_version_valid"
        ),
        CheckConstraint(
            "payment_type IN ('paid', 'pro_bono', 'barter')",
            name="client_card_payment_type_known",
        ),
        CheckConstraint(
            "payment_type <> 'paid' OR rate IS NULL OR rate > 0",
            name="client_card_paid_rate_valid",
        ),
        CheckConstraint(
            "status IN ('active', 'archived')", name="client_card_status_known"
        ),
        CheckConstraint(
            "(status = 'archived') = (archived_at IS NOT NULL)",
            name="client_card_archive_time_matches_status",
        ),
        CheckConstraint(
            "linked_account_id IS DISTINCT FROM leader_account_id",
            name="client_card_link_excludes_leader",
        ),
        CheckConstraint(
            "link_method IN ('auto', 'login')", name="client_card_link_method_known"
        ),
        CheckConstraint(
            "(linked_account_id IS NULL) = (link_method IS NULL)",
            name="client_card_link_has_method",
        ),
        CheckConstraint(
            "source IN ('created', 'booked_via_link')", name="client_card_source_known"
        ),
        CheckConstraint(
            "NOT is_new OR source = 'booked_via_link'",
            name="client_card_new_only_from_booking",
        ),
        CheckConstraint(
            "guest_language IN ('ru', 'en')", name="client_card_guest_language_known"
        ),
        Index(
            "ix_client_card_leader_account_id_self_given_email",
            "leader_account_id",
            "self_given_email",
        ),
        Index(
            "client_card_leader_linked_account_unique",
            "leader_account_id",
            "linked_account_id",
            unique=True,
            postgresql_where=text("linked_account_id IS NOT NULL"),
        ),
    )

    client_card_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    leader_account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(Text)
    photo_key: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    telegram: Mapped[str | None] = mapped_column(Text)
    whatsapp: Mapped[str | None] = mapped_column(Text)
    other_contact: Mapped[str | None] = mapped_column(Text)
    preferred_channel: Mapped[str | None] = mapped_column(Text)
    self_given_email: Mapped[str | None] = mapped_column(Text, index=True)
    rate: Mapped[Decimal | None] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(Text)
    currency_version: Mapped[int] = mapped_column(server_default=text("1"))
    payment_type: Mapped[str] = mapped_column(Text)
    request: Mapped[str | None] = mapped_column(Text)
    goals: Mapped[str | None] = mapped_column(Text)
    info: Mapped[str | None] = mapped_column(Text)
    hypotheses: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'active'"))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    linked_account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("account.account_id", ondelete="RESTRICT"), index=True
    )
    link_method: Mapped[str | None] = mapped_column(Text)
    unlinked_by_client_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    auto_link_blocked: Mapped[bool] = mapped_column(server_default=text("false"))
    is_new: Mapped[bool] = mapped_column(server_default=text("false"))
    source: Mapped[str] = mapped_column(Text)
    guest_language: Mapped[str | None] = mapped_column(Text)
    guest_time_zone: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
