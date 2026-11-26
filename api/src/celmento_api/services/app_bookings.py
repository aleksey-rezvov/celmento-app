from datetime import UTC, datetime
from hashlib import sha256
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError, invalid_request_value
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ErrorCode,
    MeetingSource,
    NoticeKey,
    NoticeTab,
)
from celmento_api.models.meeting import Meeting, MeetingCreateReceipt
from celmento_api.schemas.meetings import AttendedMeeting
from celmento_api.schemas.specialists import AppBookingCreate
from celmento_api.services.accounts import leader_record
from celmento_api.services.attended import (
    attended_view,
    lock_linked_card,
    require_current_link,
)
from celmento_api.services.bookings import (
    BookingUnavailable,
    booking_place,
    create_self_booked_meeting,
    lock_booking_accounts,
)
from celmento_api.services.idempotency import request_fingerprint
from celmento_api.services.notices import raise_notice
from celmento_api.services.public_pages import main_contact
from celmento_api.services.schedule import attended_meeting_query
from celmento_api.services.slots import ensure_slot_bookable


def _digest(body: AppBookingCreate, attendee_id: UUID, meeting: Meeting) -> str:
    fingerprint = request_fingerprint(body, attendee_id)
    # A new public id invalidates the receipt even if the original card is later reassigned back.
    return sha256(
        f"createAppBooking:{fingerprint}:{meeting.public_id}".encode()
    ).hexdigest()


def _archive_digest(
    body: AppBookingCreate, attendee_id: UUID, card_id: UUID, archived_at: datetime
) -> str:
    fingerprint = request_fingerprint(body, attendee_id)
    payload = (
        f"createAppBooking:archived:{fingerprint}:{card_id}:{archived_at.isoformat()}"
    )
    return sha256(payload.encode()).hexdigest()


async def _previous_booking(
    session: AsyncSession,
    card: ClientCard,
    attendee_id: UUID,
    receipt: MeetingCreateReceipt,
    body: AppBookingCreate,
) -> Meeting:
    previous = await session.scalar(
        attended_meeting_query(attendee_id).where(
            Meeting.meeting_id == receipt.meeting_id,
            Meeting.leader_account_id == card.leader_account_id,
            Meeting.client_card_id == card.client_card_id,
            Meeting.source == MeetingSource.SELF_BOOKED.value,
            Meeting.guest_language.is_(None),
        )
    )
    if previous is None or receipt.request_digest != _digest(
        body, attendee_id, previous
    ):
        raise AppError(409, ErrorCode.CONFLICT)
    return previous


async def create_app_booking(
    session: AsyncSession,
    attendee: Account,
    body: AppBookingCreate,
    key: UUID | None,
    origin: str,
) -> AttendedMeeting | BookingUnavailable:
    attendee_id = attendee.account_id
    # spec:impl client-app-booking#offer-booking-app-leader-card
    await require_current_link(session, attendee_id, body.specialist_id)
    leader = await lock_booking_accounts(session, body.specialist_id, attendee_id)
    if leader.activated_at is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    card = await lock_linked_card(session, attendee_id, leader.account_id)
    profile = await leader_record(session, leader.account_id)
    scoped_key = None
    receipt = None
    if key is not None:
        scoped_key = uuid5(
            NAMESPACE_URL, f"celmento:createAppBooking:{attendee_id}:{key}"
        )
        receipt = await session.scalar(
            select(MeetingCreateReceipt).where(
                MeetingCreateReceipt.leader_account_id == leader.account_id,
                MeetingCreateReceipt.idempotency_key == scoped_key,
            )
        )
        if receipt is not None and receipt.meeting_id is not None:
            prior = await _previous_booking(session, card, attendee_id, receipt, body)
            return attended_view(prior, leader, profile, origin)
    archived_at = card.archived_at
    if archived_at is not None:
        refusal = BookingUnavailable(main_contact(leader, profile))
        digest = _archive_digest(body, attendee_id, card.client_card_id, archived_at)
        if receipt is not None:
            if receipt.request_digest != digest:
                raise AppError(409, ErrorCode.CONFLICT)
            return refusal
        if scoped_key is not None:
            session.add(
                MeetingCreateReceipt(
                    leader_account_id=leader.account_id,
                    idempotency_key=scoped_key,
                    request_digest=digest,
                    meeting_id=None,
                )
            )
        # spec:impl client-archive-restore#show-leader-archived-client-tried-bar
        await raise_notice(
            session,
            leader.account_id,
            NoticeTab.PEOPLE,
            NoticeKey.ARCHIVED_CLIENT_TRIED,
            {"name": card.name},
        )
        return refusal
    if receipt is not None:
        raise AppError(409, ErrorCode.CONFLICT)

    if body.starts_at is None:
        raise invalid_request_value("body", "starts_at")
    place = booking_place(profile, body.place, body.expected_session_format)
    # spec:impl client-app-booking#re-check-book-slot-free-show
    starts_at = await ensure_slot_bookable(
        session, leader, profile, body.starts_at, datetime.now(UTC)
    )
    # spec:impl client-app-booking#create-scheduled-individual-client
    # spec:impl client-app-booking#apply-free-plan-client-limit-since
    # spec:impl client-app-booking#create-second-client-card-change
    meeting = await create_self_booked_meeting(
        session, card, profile, starts_at, place, body.comment
    )
    if scoped_key is not None:
        session.add(
            MeetingCreateReceipt(
                leader_account_id=leader.account_id,
                idempotency_key=scoped_key,
                request_digest=_digest(body, attendee_id, meeting),
                meeting_id=meeting.meeting_id,
            )
        )
    # spec:impl client-app-booking#send-email-booking-made-app
    return attended_view(meeting, leader, profile, origin)
