from datetime import time
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import address_url, current_contour
from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import (
    AcceptanceKind,
    ContactChannel,
    Currency,
    ErrorCode,
    Language,
    SessionFormat,
    Specialization,
    Weekday,
)
from celmento_api.models.leader import LeaderProfile as LeaderRecord
from celmento_api.models.leader import WorkingDay as WorkingDayRecord
from celmento_api.models.legal import Acceptance
from celmento_api.schemas.account import Account as AccountView
from celmento_api.schemas.account import (
    AccountUpdateFields,
    LeaderProfile,
    LeaderProfileUpdate,
    WorkingDay,
)
from celmento_api.schemas.documents import AcceptanceRecord
from celmento_api.schemas.money import format_amount
from celmento_api.services.logins import require_available_login
from celmento_api.services.plan_status import plan_status
from celmento_api.services.plans import stored_subscription_request
from celmento_api.storage import photo_url

DEFAULT_SESSION_DURATION: int = 60
DEFAULT_SESSION_FORMAT: SessionFormat = SessionFormat.ONLINE
DEFAULT_CURRENCY: Currency = Currency.RUB
DEFAULT_WORK_START: time = time(10)
DEFAULT_WORK_END: time = time(18)
DAYS_OFF: frozenset[Weekday] = frozenset({Weekday.SAT, Weekday.SUN})
type WorkingHours = tuple[bool, time, time]


async def leader_record(session: AsyncSession, account_id: UUID) -> LeaderRecord:
    profile = await session.get(LeaderRecord, account_id)
    if profile is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return profile


def leader_contact(
    account: Account, profile: LeaderRecord, channel: str | None
) -> str | None:
    if channel is None:
        return None
    return {
        ContactChannel.PHONE.value: account.phone,
        ContactChannel.TELEGRAM.value: account.telegram,
        ContactChannel.WHATSAPP.value: account.whatsapp,
        ContactChannel.EMAIL.value: profile.contact_email,
    }.get(channel)


async def _working_days(
    session: AsyncSession, account_id: UUID
) -> dict[Weekday, WorkingDayRecord]:
    days = await session.scalars(
        select(WorkingDayRecord).where(WorkingDayRecord.account_id == account_id)
    )
    return {Weekday(day.weekday): day for day in days}


def _default_working_day(weekday: Weekday) -> WorkingHours:
    return weekday not in DAYS_OFF, DEFAULT_WORK_START, DEFAULT_WORK_END


async def effective_working_hours(
    session: AsyncSession, account_id: UUID
) -> dict[Weekday, WorkingHours]:
    overrides = await _working_days(session, account_id)
    hours = {weekday: _default_working_day(weekday) for weekday in Weekday}
    for weekday, row in overrides.items():
        hours[weekday] = row.working, row.start_time, row.end_time
    return hours


def _working_day_view(weekday: Weekday, hours: WorkingHours) -> WorkingDay:
    working, start, end = hours
    return WorkingDay(
        weekday=weekday,
        working=working,
        start=start.isoformat(timespec="minutes"),
        end=end.isoformat(timespec="minutes"),
    )


async def leader_view(session: AsyncSession, account: Account) -> LeaderProfile:
    profile = await leader_record(session, account.account_id)
    days = await effective_working_hours(session, account.account_id)
    request = await stored_subscription_request(session, account.account_id)
    return LeaderProfile(
        specializations=[Specialization(item) for item in profile.specializations],
        specialization_other=profile.specialization_other,
        about=profile.about,
        contact_email=profile.contact_email,
        links=profile.links,
        main_channel=ContactChannel(profile.main_channel)
        if profile.main_channel is not None
        else None,
        booking_url=address_url(account.login),
        # spec:impl working-hours-booking-rules#give-new-leader-monday-friday
        working_hours=[_working_day_view(day, hours) for day, hours in days.items()],
        session_duration_minutes=profile.session_duration_minutes
        or DEFAULT_SESSION_DURATION,
        session_format=SessionFormat(profile.session_format or DEFAULT_SESSION_FORMAT),
        default_meeting_link=profile.default_meeting_link,
        default_rate=format_amount(profile.default_rate)
        if profile.default_rate is not None
        else None,
        default_currency=Currency(profile.default_currency or DEFAULT_CURRENCY),
        plan=await plan_status(session, account),
        subscription_requested_at=request.created_at if request is not None else None,
    )


async def account_view(
    session: AsyncSession, account: Account, origin: str
) -> AccountView:
    accepted = await session.scalars(
        select(Acceptance)
        .where(Acceptance.account_id == account.account_id)
        .order_by(Acceptance.accepted_at, Acceptance.acceptance_id),
    )
    return AccountView(
        id=account.account_id,
        contour=current_contour(),
        email=account.email,
        first_name=account.first_name,
        last_name=account.last_name,
        photo_url=photo_url(account.photo_key, origin),
        phone=account.phone,
        telegram=account.telegram,
        whatsapp=account.whatsapp,
        login=account.login,
        address_url=address_url(account.login),
        language=Language(account.language),
        time_zone=account.time_zone,
        activated=account.activated_at is not None,
        activated_at=account.activated_at,
        leader=await leader_view(session, account)
        if account.activated_at is not None
        else None,
        acceptances=[
            AcceptanceRecord(
                kind=AcceptanceKind(record.kind),
                version=record.version,
                accepted_at=record.accepted_at,
            )
            for record in accepted
        ],
        created_at=account.created_at,
    )


async def _update_working_days(
    session: AsyncSession, account_id: UUID, updates: list[WorkingDay]
) -> None:
    days = await _working_days(session, account_id)
    updated_weekdays: set[Weekday] = set()
    for day in updates:
        start = time.fromisoformat(day.start)
        end = time.fromisoformat(day.end)
        # spec:impl working-hours-booking-rules#allow-one-interval-day-start
        # spec:impl working-hours-booking-rules#block-save-show
        # spec:impl working-hours-booking-rules#allow-more-one-working-interval
        if (
            day.weekday in updated_weekdays
            or start.minute % 15 != 0
            or end.minute % 15 != 0
            or (day.working and start >= end)
        ):
            raise AppError(
                400, ErrorCode.WORKING_HOURS_INVALID, {"weekday": day.weekday.value}
            )
        updated_weekdays.add(day.weekday)
        row = days.get(day.weekday)
        if (day.working, start, end) == _default_working_day(day.weekday):
            if row is not None:
                await session.delete(row)
        elif row is None:
            session.add(
                WorkingDayRecord(
                    account_id=account_id,
                    weekday=day.weekday.value,
                    working=day.working,
                    start_time=start,
                    end_time=end,
                )
            )
        else:
            row.working = day.working
            row.start_time = start
            row.end_time = end


def _update_leader(
    account: Account, profile: LeaderRecord, body: LeaderProfileUpdate
) -> None:
    if "specializations" in body:
        # spec:impl account-profile#offer-about-field-specialization
        profile.specializations = [item.value for item in body["specializations"]]
    profile.specialization_other = body.get(
        "specialization_other", profile.specialization_other
    )
    # spec:impl account-profile#limit-about-text-1000-characters-show
    profile.about = body.get("about", profile.about)
    profile.contact_email = body.get("contact_email", profile.contact_email)
    profile.links = body.get("links", profile.links)
    if "session_duration_minutes" in body:
        duration = body["session_duration_minutes"]
        profile.session_duration_minutes = (
            duration if duration != DEFAULT_SESSION_DURATION else None
        )
    if "session_format" in body:
        session_format = body["session_format"]
        profile.session_format = (
            session_format.value if session_format != DEFAULT_SESSION_FORMAT else None
        )
    profile.default_meeting_link = body.get(
        "default_meeting_link", profile.default_meeting_link
    )
    if "default_rate" in body:
        rate = body["default_rate"]
        # spec:impl default-rate-currency#let-leader-save-profile-work
        profile.default_rate = Decimal(rate) if rate is not None else None
    if "default_currency" in body:
        currency = body["default_currency"]
        profile.default_currency = (
            currency.value if currency != DEFAULT_CURRENCY else None
        )

    channel = body.get(
        "main_channel",
        ContactChannel(profile.main_channel)
        if profile.main_channel is not None
        else None,
    )
    contact = leader_contact(
        account, profile, channel.value if channel is not None else None
    )
    profile.main_channel = (
        channel.value if channel is not None and contact and contact.strip() else None
    )


async def update_account(
    session: AsyncSession, account: Account, body: AccountUpdateFields
) -> None:
    leader = body.get("leader")
    if leader is not None and account.activated_at is None:
        raise AppError(403, ErrorCode.ACTIVATION_REQUIRED)
    login = (
        await require_available_login(session, body["login"], account.account_id)
        if "login" in body
        else account.login
    )
    profile = (
        await leader_record(session, account.account_id)
        if account.activated_at is not None
        else None
    )
    if leader is not None and "working_hours" in leader:
        await _update_working_days(session, account.account_id, leader["working_hours"])

    # spec:impl account-profile#keep-one-record-personal-data
    # spec:impl account-profile#prefill-first-last-name-registration
    account.first_name = body.get("first_name", account.first_name)
    account.last_name = body.get("last_name", account.last_name)
    account.phone = body.get("phone", account.phone)
    account.telegram = body.get("telegram", account.telegram)
    account.whatsapp = body.get("whatsapp", account.whatsapp)
    # spec:impl booking-link-login#change-login-name-other-account
    # spec:impl booking-link-login#limit-how-often-login-changed
    account.login = login
    if "language" in body:
        # spec:impl interface-language#keep-language-account-change-effect
        account.language = body["language"].value
    account.time_zone = body.get("time_zone", account.time_zone)
    if profile is not None:
        _update_leader(account, profile, leader or {})
    try:
        await session.flush()
    except IntegrityError as exc:
        if getattr(exc.orig, "sqlstate", None) == "23505":
            raise AppError(409, ErrorCode.LOGIN_TAKEN) from None
        raise
