from calendar import monthrange
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import (
    Date,
    DateTime,
    Select,
    and_,
    case,
    cast,
    func,
    or_,
    select,
    text,
    type_coerce,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from celmento_api.errors import invalid_request_value
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import Currency, MeetingStatus, MeetingType, PaymentType
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.meetings import MeetingDefaults
from celmento_api.services.accounts import (
    DEFAULT_CURRENCY,
    DEFAULT_SESSION_DURATION,
    leader_record,
)


def planned_end_expression() -> ColumnElement[datetime]:
    return type_coerce(
        Meeting.starts_at + Meeting.duration_minutes * text("INTERVAL '1 minute'"),
        DateTime(timezone=True),
    )


def planned_end(meeting: Meeting) -> datetime:
    return meeting.starts_at + timedelta(minutes=meeting.duration_minutes)


def awaiting_outcome(meeting: Meeting, now: datetime) -> bool:
    # spec:impl pending-outcomes#treat-meeting-leader-type-mutual
    return (
        meeting.status == MeetingStatus.SCHEDULED.value and planned_end(meeting) <= now
    )


def pending_condition(now: datetime) -> ColumnElement[bool]:
    # spec:impl pending-outcomes#list-meeting-end-time-not-passed
    return and_(
        Meeting.status == MeetingStatus.SCHEDULED.value, planned_end_expression() <= now
    )


def local_day(instant: datetime, time_zone: str) -> date:
    return instant.astimezone(ZoneInfo(time_zone)).date()


def _start_of_day(day: date, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, zone).astimezone(UTC)


def date_bounds(first: date, last: date, zone: ZoneInfo) -> tuple[datetime, datetime]:
    try:
        lower = _start_of_day(first, zone)
        upper = (
            datetime.max.replace(tzinfo=UTC)
            if last == date.max
            else _start_of_day(last + timedelta(days=1), zone)
        )
    except OverflowError:
        raise invalid_request_value("query", "date") from None
    return lower, upper


def attended_meeting_query(account_id: UUID) -> Select[Meeting]:
    # spec:impl attended-meetings#show-attended-meetings-individual-client
    # spec:impl attended-meetings#show-attended-meeting-attached
    return (
        select(Meeting)
        .select_from(Meeting)
        .join(
            ClientCard,
            (ClientCard.client_card_id == Meeting.client_card_id)
            & (ClientCard.leader_account_id == Meeting.leader_account_id),
        )
        .where(
            ClientCard.linked_account_id == account_id,
            Meeting.type == MeetingType.CLIENT_SESSION.value,
            # spec:impl attended-meetings#keep-past-attended-meetings-leader
            or_(
                ClientCard.archived_at.is_(None),
                Meeting.starts_at < ClientCard.archived_at,
            ),
        )
    )


async def find_overlap(
    session: AsyncSession,
    leader_id: UUID,
    starts_at: datetime,
    duration_minutes: int,
    exclude_id: UUID | None = None,
) -> Meeting | None:
    ends_at = starts_at + timedelta(minutes=duration_minutes)
    statement = select(Meeting).where(
        Meeting.leader_account_id == leader_id,
        Meeting.starts_at < ends_at,
        planned_end_expression() > starts_at,
    )
    if exclude_id is not None:
        statement = statement.where(Meeting.meeting_id != exclude_id)
    return await session.scalar(
        statement.order_by(Meeting.starts_at, Meeting.meeting_id).limit(1)
    )


async def calendar_days(
    session: AsyncSession, account: Account, month: str
) -> list[date]:
    try:
        first = date.fromisoformat(f"{month}-01")
    except ValueError:
        raise invalid_request_value("query", "month") from None
    end_day = first.replace(day=monthrange(first.year, first.month)[1])
    lower, upper = date_bounds(first, end_day, ZoneInfo(account.time_zone))
    day = cast(func.timezone(account.time_zone, Meeting.starts_at), Date()).label("day")
    in_month = (Meeting.starts_at >= lower, Meeting.starts_at < upper)
    attended = (
        attended_meeting_query(account.account_id)
        .with_only_columns(day)
        .where(*in_month)
    )
    # spec:impl schedule-date-navigation#mark-dot-day-least-one
    if account.activated_at is None:
        return list(await session.scalars(attended.distinct().order_by(day)))
    own = select(day).where(Meeting.leader_account_id == account.account_id, *in_month)
    return list(await session.scalars(own.union(attended).order_by("day")))


def _next_hour_candidates(day: date, zone: ZoneInfo, now: datetime) -> list[datetime]:
    first_hour = now.astimezone(zone).hour + 1
    try:
        if first_hour == 24:
            return [_start_of_day(day + timedelta(days=1), zone)]
        candidates: set[datetime] = set()
        for hour in range(first_hour, 24):
            wall = datetime.combine(day, time(hour), zone)
            for fold in (0, 1):
                instant = wall.replace(fold=fold).astimezone(UTC)
                if instant.astimezone(zone).replace(tzinfo=None) == wall.replace(
                    tzinfo=None
                ):
                    candidates.add(instant)
        return sorted(candidates) or [_start_of_day(day + timedelta(days=1), zone)]
    except OverflowError:
        raise invalid_request_value("query", "date") from None


async def meeting_defaults(
    session: AsyncSession,
    leader: Account,
    day: date,
    with_whom: str | None,
    now: datetime,
) -> MeetingDefaults:
    profile = await leader_record(session, leader.account_id)
    candidates = _next_hour_candidates(day, ZoneInfo(leader.time_zone), now)
    try:
        look_until = candidates[-1] + timedelta(hours=1)
    except OverflowError:
        raise invalid_request_value("query", "date") from None
    existing = list(
        await session.scalars(
            select(Meeting).where(
                Meeting.leader_account_id == leader.account_id,
                Meeting.starts_at < look_until,
                planned_end_expression() > candidates[0],
            )
        )
    )
    starts_at = next(
        (
            hour
            for hour in candidates
            if not any(
                meeting.starts_at < hour + timedelta(hours=1)
                and planned_end(meeting) > hour
                for meeting in existing
            )
        ),
        candidates[0],
    )
    currency = profile.default_currency or DEFAULT_CURRENCY
    if with_whom:
        previous_currency = await session.scalar(
            select(Meeting.currency)
            .where(
                Meeting.leader_account_id == leader.account_id,
                Meeting.with_whom == with_whom,
                Meeting.currency.is_not(None),
            )
            .order_by(
                Meeting.starts_at.desc(),
                Meeting.created_at.desc(),
                Meeting.meeting_id.desc(),
            )
            .limit(1)
        )
        # spec:impl meeting-form#default-currency-personal-therapy
        if previous_currency is not None:
            currency = previous_currency
    return MeetingDefaults(
        starts_at=starts_at,
        duration_minutes=profile.session_duration_minutes or DEFAULT_SESSION_DURATION,
        meeting_link=profile.default_meeting_link,
        currency=Currency(currency),
    )


async def apply_client_currency_to_future_meetings(
    session: AsyncSession, card: ClientCard, now: datetime
) -> None:
    statement = (
        update(Meeting)
        .where(
            Meeting.leader_account_id == card.leader_account_id,
            Meeting.client_card_id == card.client_card_id,
            Meeting.status == MeetingStatus.SCHEDULED.value,
            Meeting.starts_at > now,
        )
        .values(
            currency=card.currency,
            currency_version=card.currency_version,
            price=card.rate,
            updated_at=now,
        )
    )
    if card.rate == 0:
        statement = statement.values(
            payment_type=case(
                (Meeting.payment_type == PaymentType.PAID.value, card.payment_type),
                else_=Meeting.payment_type,
            )
        )
    # spec:impl client-rate-currency#apply-new-currency-new-rate
    # spec:impl client-rate-currency#keep-past-meetings-balance-history
    await session.execute(statement)
