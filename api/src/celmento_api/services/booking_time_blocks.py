from datetime import UTC, date, datetime, time
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError, invalid_request_value
from celmento_api.models.enums import ErrorCode
from celmento_api.models.meeting import BookingTimeBlock as BookingTimeBlockRecord
from celmento_api.schemas.meetings import BookingTimeBlock, BookingTimeBlockCreate
from celmento_api.services.account_access import lock_account
from celmento_api.services.schedule import date_bounds


def _boundary(day: date, value: str, zone: ZoneInfo, field: str) -> datetime:
    wall = datetime.combine(day, time.fromisoformat(value))
    try:
        candidates = [
            wall.replace(tzinfo=zone, fold=fold).astimezone(UTC) for fold in (0, 1)
        ]
        real = [
            instant
            for instant in candidates
            if instant.astimezone(zone).replace(tzinfo=None) == wall
        ]
    except OverflowError:
        raise invalid_request_value("body", field) from None
    if not real:
        raise invalid_request_value("body", field)
    return min(real)


def _bounds(body: BookingTimeBlockCreate, zone: ZoneInfo) -> tuple[datetime, datetime]:
    # spec:impl booking-time-blocks#validate-local-interval
    if body.start is None and body.end is None:
        if body.date_ == date.max:
            raise invalid_request_value("body", "date")
        begin, end = date_bounds(body.date_, body.date_, zone, source="body")
        if begin >= end:
            raise invalid_request_value("body", "date")
        return begin, end
    if body.start is None or body.end is None or body.start >= body.end:
        raise invalid_request_value("body", "end")
    return (
        _boundary(body.date_, body.start, zone, "start"),
        _boundary(body.date_, body.end, zone, "end"),
    )


def _view(record: BookingTimeBlockRecord) -> BookingTimeBlock:
    return BookingTimeBlock(
        id=record.booking_time_block_id,
        starts_at=record.starts_at,
        ends_at=record.ends_at,
    )


def booking_blocks_in_range(
    account_id: UUID, lower: datetime, upper: datetime
) -> Select[BookingTimeBlockRecord]:
    # spec:impl booking-time-blocks#owned-blocks
    return select(BookingTimeBlockRecord).where(
        BookingTimeBlockRecord.account_id == account_id,
        BookingTimeBlockRecord.starts_at < upper,
        BookingTimeBlockRecord.ends_at > lower,
    )


async def list_booking_time_blocks(
    session: AsyncSession, account_id: UUID, lower: datetime, upper: datetime
) -> list[BookingTimeBlock]:
    records = await session.scalars(
        booking_blocks_in_range(account_id, lower, upper).order_by(
            BookingTimeBlockRecord.starts_at,
            BookingTimeBlockRecord.ends_at,
        )
    )
    return [_view(record) for record in records]


async def create_booking_time_block(
    session: AsyncSession, account_id: UUID, body: BookingTimeBlockCreate
) -> BookingTimeBlock:
    account = await lock_account(session, account_id, no_key_update=True)
    starts_at, ends_at = _bounds(body, ZoneInfo(account.time_zone))
    existing = await session.scalar(
        select(BookingTimeBlockRecord).where(
            BookingTimeBlockRecord.account_id == account_id,
            BookingTimeBlockRecord.starts_at == starts_at,
            BookingTimeBlockRecord.ends_at == ends_at,
        )
    )
    # spec:impl booking-time-blocks#validate-local-interval
    if existing is not None:
        return _view(existing)
    block = BookingTimeBlockRecord(
        account_id=account_id, starts_at=starts_at, ends_at=ends_at
    )
    # spec:impl booking-time-blocks#only-future-bookings-affected
    session.add(block)
    await session.flush()
    return _view(block)


async def delete_booking_time_block(
    session: AsyncSession, account_id: UUID, block_id: UUID
) -> None:
    await lock_account(session, account_id, no_key_update=True)
    # spec:impl booking-time-blocks#owned-blocks
    deleted = await session.scalar(
        delete(BookingTimeBlockRecord)
        .where(
            BookingTimeBlockRecord.booking_time_block_id == block_id,
            BookingTimeBlockRecord.account_id == account_id,
        )
        .returning(BookingTimeBlockRecord.booking_time_block_id)
    )
    if deleted is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
