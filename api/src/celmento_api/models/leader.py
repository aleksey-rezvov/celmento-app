from datetime import time
from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, Text, Time, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class LeaderProfile(Base):
    __tablename__ = "leader_profile"
    __table_args__ = (
        CheckConstraint(
            "specializations <@ ARRAY['coach', 'psychologist', 'psychotherapist', "
            "'psychoanalyst', 'consultant', 'mentor', 'other']::text[]",
            name="leader_profile_specializations_known",
        ),
        CheckConstraint("length(about) <= 1000", name="leader_profile_about_length"),
        CheckConstraint("cardinality(links) <= 5", name="leader_profile_maximum_links"),
        CheckConstraint(
            "main_channel IN ('phone', 'telegram', 'whatsapp', 'email')",
            name="leader_profile_main_channel_known",
        ),
        CheckConstraint(
            "session_duration_minutes IN (15, 30, 45, 60, 75, 90)",
            name="leader_profile_session_duration_known",
        ),
        CheckConstraint(
            "session_format IN ('online', 'in_person', 'both')",
            name="leader_profile_session_format_known",
        ),
        CheckConstraint(
            "default_rate >= 0 AND default_rate < 'Infinity'::numeric",
            name="leader_profile_default_rate_valid",
        ),
        CheckConstraint(
            "default_currency IN ('RUB', 'EUR', 'USD')",
            name="leader_profile_default_currency_known",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"), primary_key=True
    )
    specializations: Mapped[list[str]] = mapped_column(
        ARRAY(Text()), server_default=text("'{}'::text[]")
    )
    specialization_other: Mapped[str | None] = mapped_column(Text)
    about: Mapped[str] = mapped_column(Text, server_default=text("''"))
    contact_email: Mapped[str | None] = mapped_column(Text)
    links: Mapped[list[str]] = mapped_column(
        ARRAY(Text()), server_default=text("'{}'::text[]")
    )
    main_channel: Mapped[str | None] = mapped_column(Text)
    session_duration_minutes: Mapped[int | None] = mapped_column()
    session_format: Mapped[str | None] = mapped_column(Text)
    default_meeting_link: Mapped[str | None] = mapped_column(Text)
    default_rate: Mapped[Decimal | None] = mapped_column(Numeric(19, 4))
    default_currency: Mapped[str | None] = mapped_column(Text)
    preseeded_notes_version: Mapped[int | None] = mapped_column()


class WorkingDay(Base):
    __tablename__ = "working_day"
    __table_args__ = (
        CheckConstraint(
            "weekday IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')",
            name="working_day_weekday_known",
        ),
        CheckConstraint(
            "NOT working OR end_time > start_time", name="working_day_order"
        ),
        CheckConstraint(
            "extract(minute FROM start_time) % 15 = 0 "
            "AND extract(second FROM start_time) = 0 "
            "AND extract(hour FROM start_time) < 24 "
            "AND extract(minute FROM end_time) % 15 = 0 "
            "AND extract(second FROM end_time) = 0 "
            "AND extract(hour FROM end_time) < 24",
            name="working_day_quarter_hours",
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("leader_profile.account_id", ondelete="CASCADE"), primary_key=True
    )
    weekday: Mapped[str] = mapped_column(Text, primary_key=True)
    working: Mapped[bool] = mapped_column()
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
