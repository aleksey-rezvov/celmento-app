from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import ErrorCode, MeetingType, Weekday
from celmento_api.models.leader import LeaderProfile
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.public import BookingSlotList, Slot
from celmento_api.services.accounts import (
    DEFAULT_SESSION_DURATION,
    WorkingHours,
    effective_working_hours,
    leader_record,
)
from celmento_api.services.schedule import planned_end_expression

BOOKING_LEAD: timedelta = timedelta(hours=3)
BOOKING_HORIZON: timedelta = timedelta(weeks=4)
SLOT_STEP: timedelta = timedelta(minutes=30)
TICK: timedelta = timedelta(microseconds=1)
WEEKDAYS: tuple[Weekday, ...] = tuple(Weekday)


def _inside_hours(
    start: datetime,
    duration: timedelta,
    zone: ZoneInfo,
    opening: datetime,
    closing: datetime,
) -> bool:
    last = start + duration - TICK
    first_local, last_local = start.astimezone(zone), last.astimezone(zone)
    if not opening <= last_local.replace(tzinfo=None) < closing:
        return False
    offset = first_local.utcoffset()
    if offset == last_local.utcoffset():
        return True

    # A clock change can cross the working window even when both ends are inside.
    before, after = start, last
    while after - before > TICK:
        middle = before + (after - before) / 2
        if middle.astimezone(zone).utcoffset() == offset:
            before = middle
        else:
            after = middle
    return all(
        opening <= point.astimezone(zone).replace(tzinfo=None) < closing
        for point in (before, after)
    )


def _day_starts(
    day: date, hours: WorkingHours, zone: ZoneInfo, duration: timedelta
) -> set[datetime]:
    working, start_time, end_time = hours
    if not working:
        return set()
    opening = datetime.combine(day, start_time)
    closing = datetime.combine(day, end_time)
    wall = opening
    starts: set[datetime] = set()
    # spec:impl public-booking-page#start-slots-30-minutes-start
    while wall < closing:
        for fold in (0, 1):
            instant = wall.replace(tzinfo=zone, fold=fold).astimezone(UTC)
            if (
                instant in starts
                or instant.astimezone(zone).replace(tzinfo=None) != wall
            ):
                continue
            if _inside_hours(instant, duration, zone, opening, closing):
                starts.add(instant)
        wall += SLOT_STEP
    return starts


async def _busy_intervals(
    session: AsyncSession, account_id: UUID, lower: datetime, upper: datetime
) -> list[tuple[datetime, datetime]]:
    end = planned_end_expression()
    intervals = select(Meeting.starts_at, end).where(
        Meeting.starts_at < upper, end > lower
    )
    own = intervals.where(Meeting.leader_account_id == account_id)
    attended = intervals.join(
        ClientCard,
        (ClientCard.client_card_id == Meeting.client_card_id)
        & (ClientCard.leader_account_id == Meeting.leader_account_id),
    ).where(
        ClientCard.linked_account_id == account_id,
        Meeting.type == MeetingType.CLIENT_SESSION.value,
    )
    rows = await session.execute(own.union_all(attended))
    return [(starts_at, ends_at) for starts_at, ends_at in rows]


def _overlaps(
    start: datetime, end: datetime, busy: Sequence[tuple[datetime, datetime]]
) -> bool:
    return any(
        occupied_start < end and occupied_end > start
        for occupied_start, occupied_end in busy
    )


async def free_slots(
    session: AsyncSession,
    leader: Account,
    day_from: date,
    day_to: date,
    viewer_zone: str,
    now: datetime,
) -> BookingSlotList:
    # spec:impl public-booking-page#compute-slots-leader-current-working
    profile = await leader_record(session, leader.account_id)
    hours = await effective_working_hours(session, leader.account_id)
    duration_minutes = profile.session_duration_minutes or DEFAULT_SESSION_DURATION
    duration = timedelta(minutes=duration_minutes)
    zone = ZoneInfo(leader.time_zone)
    earliest, latest = now + BOOKING_LEAD, now + BOOKING_HORIZON
    first_day, last_day = (
        earliest.astimezone(zone).date(),
        latest.astimezone(zone).date(),
    )
    candidates: set[datetime] = set()
    for offset in range((last_day - first_day).days + 1):
        day = first_day + timedelta(days=offset)
        candidates.update(
            _day_starts(day, hours[WEEKDAYS[day.weekday()]], zone, duration)
        )
    busy = await _busy_intervals(
        session, leader.account_id, earliest, latest + duration
    )
    viewer = ZoneInfo(viewer_zone)
    items: list[Slot] = []
    next_free_date: date | None = None
    has_available_slots = False
    # spec:impl public-booking-page#offer-slot-only-rule-holds
    for starts_at in sorted(candidates):
        if not earliest <= starts_at <= latest or _overlaps(
            starts_at, starts_at + duration, busy
        ):
            continue
        has_available_slots = True
        day = starts_at.astimezone(viewer).date()
        if day < day_from:
            continue
        next_free_date = day if next_free_date is None else min(day, next_free_date)
        if day <= day_to:
            items.append(Slot(starts_at=starts_at, duration_minutes=duration_minutes))
    return BookingSlotList(
        items=items,
        next_free_date=next_free_date,
        has_available_slots=has_available_slots,
    )


async def ensure_slot_bookable(
    session: AsyncSession,
    leader: Account,
    profile: LeaderProfile,
    requested: datetime,
    now: datetime,
) -> datetime:
    try:
        starts_at = requested.astimezone(UTC)
    except OverflowError:
        raise AppError(409, ErrorCode.SLOT_INVALID) from None
    if not now + BOOKING_LEAD <= starts_at <= now + BOOKING_HORIZON:
        raise AppError(409, ErrorCode.SLOT_INVALID)
    duration = timedelta(
        minutes=profile.session_duration_minutes or DEFAULT_SESSION_DURATION
    )
    zone = ZoneInfo(leader.time_zone)
    day = starts_at.astimezone(zone).date()
    hours = await effective_working_hours(session, leader.account_id)
    if starts_at not in _day_starts(
        day, hours[WEEKDAYS[day.weekday()]], zone, duration
    ):
        raise AppError(409, ErrorCode.SLOT_INVALID)
    # spec:impl guest-booking-flow#re-check-book-slot-free-taken
    if await _busy_intervals(
        session, leader.account_id, starts_at, starts_at + duration
    ):
        raise AppError(409, ErrorCode.SLOT_TAKEN)
    return starts_at
