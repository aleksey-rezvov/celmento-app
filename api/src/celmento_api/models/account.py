from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from celmento_api.db import Base


class Account(Base):
    __tablename__ = "account"
    __table_args__ = (
        CheckConstraint(
            "length(first_name) BETWEEN 1 AND 100", name="account_first_name_length"
        ),
        CheckConstraint(
            "length(last_name) BETWEEN 1 AND 100", name="account_last_name_length"
        ),
    )

    account_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    email: Mapped[str] = mapped_column(Text, unique=True)
    first_name: Mapped[str] = mapped_column(Text)
    last_name: Mapped[str] = mapped_column(Text)
    login: Mapped[str] = mapped_column(Text, unique=True)
    language: Mapped[str] = mapped_column(Text)
    time_zone: Mapped[str] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    telegram: Mapped[str | None] = mapped_column(Text)
    whatsapp: Mapped[str | None] = mapped_column(Text)
    photo_key: Mapped[str | None] = mapped_column(Text)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class AccountSession(Base):
    __tablename__ = "session"

    session_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SignInTicket(Base):
    __tablename__ = "sign_in_ticket"

    sign_in_ticket_id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=text("uuidv7()")
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("account.account_id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(Text, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReservedLoginWord(Base):
    __tablename__ = "reserved_login_word"
    __table_args__ = (
        CheckConstraint(
            "source IN ('builtin', 'admin')", name="reserved_login_word_source"
        ),
    )

    reserved_login_word_id: Mapped[str] = mapped_column(Text, primary_key=True)
    source: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
