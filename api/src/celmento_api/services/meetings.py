from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.emails import PreparedEmail
from celmento_api.errors import AppError, invalid_request_value
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ClientCardStatus,
    Currency,
    ErrorCode,
    MeetingPlace,
    MeetingSource,
    MeetingStatus,
    MeetingType,
    PaymentType,
)
from celmento_api.models.meeting import Meeting, MeetingCreateReceipt
from celmento_api.schemas.meetings import (
    MeetingCreate,
    MeetingCreateFields,
    MeetingOptions,
    MeetingUpdateFields,
)
from celmento_api.services.account_access import lock_account
from celmento_api.services.clients import owned_client, validate_payment_type
from celmento_api.services.idempotency import request_fingerprint
from celmento_api.services.meeting_notifications import prepare_meeting_notification
from celmento_api.services.meeting_views import own_meeting_view
from celmento_api.services.outcomes import (
    client_charge,
    correct_client_charge,
    correct_service_expense,
    delete_meeting,
    record_outcome,
    service_expense,
)
from celmento_api.services.schedule import find_overlap


async def owned_meeting(
    session: AsyncSession, leader_id: UUID, meeting_id: UUID, *, lock: bool = False
) -> Meeting:
    query = select(Meeting).where(
        Meeting.leader_account_id == leader_id, Meeting.meeting_id == meeting_id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    meeting = await session.scalar(query)
    if meeting is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return meeting


async def meeting_client(
    session: AsyncSession, leader: Account, meeting: Meeting
) -> ClientCard | None:
    if meeting.client_card_id is None:
        return None
    return await owned_client(
        session, leader.account_id, meeting.client_card_id, lock=True
    )


def _normalized_start(start: datetime, duration: int, leader: Account) -> datetime:
    try:
        normalized = start.astimezone(UTC)
        end = normalized + timedelta(minutes=duration)
        zone = ZoneInfo(leader.time_zone)
        normalized.astimezone(zone)
        end.astimezone(zone)
    except OverflowError, ValueError:
        raise invalid_request_value("body", "starts_at") from None
    return normalized


def _pricing(
    options: MeetingOptions,
    meeting: Meeting,
    kind: MeetingType,
    card: ClientCard | None,
) -> tuple[Decimal | None, Currency | None, int | None, PaymentType | None]:
    if kind == MeetingType.MUTUAL_PRACTICE:
        for field in ("price", "currency", "payment_type"):
            if field in options:
                # spec:impl mutual-practice-meeting#link-mutual-practice-meeting-client
                raise invalid_request_value("body", field)
        return None, None, None, None

    price = Decimal(options["price"]) if "price" in options else meeting.price
    if price is None:
        raise invalid_request_value("body", "price")
    if card is not None:
        if (
            meeting.client_card_id == card.client_card_id
            and meeting.currency is not None
            and meeting.currency_version is not None
        ):
            currency, version = Currency(meeting.currency), meeting.currency_version
        else:
            currency, version = Currency(card.currency), card.currency_version
        if "currency" in options and options["currency"] != currency:
            raise invalid_request_value("body", "currency")
        default_payment = (
            PaymentType(meeting.payment_type)
            if meeting.payment_type is not None
            else PaymentType.PAID
        )
        payment_type = options.get("payment_type", default_payment)
        # spec:impl meeting-form#make-paid-unavailable-price-client
        validate_payment_type(price, payment_type)
        return price, currency, version, payment_type

    if "payment_type" in options:
        raise invalid_request_value("body", "payment_type")
    currency = options.get(
        "currency", Currency(meeting.currency) if meeting.currency is not None else None
    )
    if currency is None:
        raise invalid_request_value("body", "currency")
    return price, currency, None, None


async def _apply_form(
    session: AsyncSession,
    leader: Account,
    meeting: Meeting,
    body: MeetingCreateFields | MeetingUpdateFields,
    origin: str,
    now: datetime,
    exclude_id: UUID | None = None,
) -> ClientCard | None:
    kind = body.get("type", MeetingType(meeting.type))
    duration = body.get("duration_minutes", meeting.duration_minutes)
    start = _normalized_start(
        body.get("starts_at", meeting.starts_at), duration, leader
    )
    place = body.get("place", MeetingPlace(meeting.place))
    card_id = body.get("client_id", meeting.client_card_id)
    if meeting.status != MeetingStatus.SCHEDULED.value and (
        kind.value != meeting.type or card_id != meeting.client_card_id
    ):
        raise AppError(409, ErrorCode.MEETING_HAS_OUTCOME)

    card = None
    if kind == MeetingType.CLIENT_SESSION:
        if card_id is None:
            raise invalid_request_value("body", "client_id")
        card = await owned_client(session, leader.account_id, card_id, lock=True)
        if card.status == ClientCardStatus.ARCHIVED.value and (
            meeting.status == MeetingStatus.SCHEDULED.value
            or meeting.starts_at > now
            or start > now
            or ("price" in body and Decimal(body["price"]) != meeting.price)
            or ("currency" in body and body["currency"] != meeting.currency)
            or ("payment_type" in body and body["payment_type"] != meeting.payment_type)
        ):
            raise AppError(409, ErrorCode.MEETING_CLIENT_ARCHIVED)
        if body.get("with_whom") is not None:
            raise invalid_request_value("body", "with_whom")
        if body.get("topic") is not None:
            raise invalid_request_value("body", "topic")
    elif "client_id" in body:
        raise invalid_request_value("body", "client_id")

    own_duration = None
    if kind == MeetingType.MUTUAL_PRACTICE:
        own_duration = body.get("my_duration_minutes", meeting.my_duration_minutes)
        # spec:impl mutual-practice-meeting#require-my-duration-whole-number-minutes
        # spec:impl mutual-practice-meeting#refuse-save-my-duration-greater-total
        if own_duration is None or not 0 < own_duration <= duration:
            raise AppError(400, ErrorCode.MY_DURATION_INVALID)
    elif "my_duration_minutes" in body:
        raise invalid_request_value("body", "my_duration_minutes")

    price, currency, version, payment_type = _pricing(body, meeting, kind, card)
    if place == MeetingPlace.ONLINE and body.get("address") is not None:
        raise invalid_request_value("body", "address")
    if place == MeetingPlace.IN_PERSON and body.get("meeting_link") is not None:
        raise invalid_request_value("body", "meeting_link")

    if not body.get("allow_overlap", False):
        overlap = await find_overlap(
            session, leader.account_id, start, duration, exclude_id
        )
        if overlap is not None:
            existing = await own_meeting_view(session, overlap, leader, origin, now)
            # spec:impl meeting-form#show-overlap-time-name-existing
            raise AppError(
                409,
                ErrorCode.MEETING_OVERLAP,
                {"meeting": existing.model_dump(mode="json")},
            )

    new_card_id = card.client_card_id if card is not None else None
    if exclude_id is not None and meeting.client_card_id != new_card_id:
        meeting.public_id = uuid4()
        meeting.guest_language = None
        meeting.guest_time_zone = None
    meeting.type = kind.value
    meeting.client_card_id = new_card_id
    meeting.with_whom = (
        body.get("with_whom", meeting.with_whom) if card is None else None
    )
    meeting.topic = body.get("topic", meeting.topic) if card is None else None
    # spec:impl time-zone-handling#store-meeting-instant-meeting-set
    meeting.starts_at = start
    meeting.duration_minutes = duration
    if (
        own_duration is not None
        and meeting.status == MeetingStatus.COMPLETED.value
        and own_duration != meeting.my_duration_minutes
    ):
        # An explicit own-duration change updates the completed specialist time.
        meeting.actual_duration_minutes = own_duration
    meeting.my_duration_minutes = own_duration
    meeting.place = place.value
    meeting.meeting_link = (
        body.get("meeting_link", meeting.meeting_link)
        if place == MeetingPlace.ONLINE
        else None
    )
    meeting.address = (
        body.get("address", meeting.address)
        if place == MeetingPlace.IN_PERSON
        else None
    )
    meeting.price = price
    meeting.currency = currency.value if currency is not None else None
    meeting.currency_version = version
    meeting.payment_type = payment_type.value if payment_type is not None else None
    meeting.comment = body.get("comment", meeting.comment)
    meeting.updated_at = now
    return card


async def create_meeting(
    session: AsyncSession,
    leader: Account,
    body: MeetingCreate,
    origin: str,
    idempotency_key: UUID | None,
) -> Meeting:
    # The leader lock governs the check and write, including parallel bookings.
    leader = await lock_account(session, leader.account_id, no_key_update=True)
    fingerprint = request_fingerprint(body) if idempotency_key is not None else None
    if idempotency_key is not None:
        receipt = await session.scalar(
            select(MeetingCreateReceipt).where(
                MeetingCreateReceipt.leader_account_id == leader.account_id,
                MeetingCreateReceipt.idempotency_key == idempotency_key,
            )
        )
        if receipt is not None:
            if receipt.request_digest != fingerprint or receipt.meeting_id is None:
                raise AppError(409, ErrorCode.CONFLICT)
            return await owned_meeting(
                session, leader.account_id, receipt.meeting_id, lock=True
            )

    now = datetime.now(UTC)
    # spec:impl meeting-form#create-meeting-status-scheduled-save
    meeting = Meeting(
        leader_account_id=leader.account_id,
        type=body.root["type"].value,
        starts_at=body.root["starts_at"],
        duration_minutes=body.root["duration_minutes"],
        place=body.root["place"].value,
        status=MeetingStatus.SCHEDULED.value,
        source=MeetingSource.SPECIALIST.value,
    )
    card = await _apply_form(session, leader, meeting, body.root, origin, now)
    session.add(meeting)
    await session.flush()
    if "outcome" in body.root:
        # spec:impl meeting-form#run-completed-not-taken-place-flow
        # spec:impl meeting-outcome-recording#let-backdated-meeting-saved-outcome
        await record_outcome(
            session, leader, meeting, card, body.root["outcome"].root, now
        )
    if idempotency_key is not None and fingerprint is not None:
        session.add(
            MeetingCreateReceipt(
                leader_account_id=leader.account_id,
                meeting_id=meeting.meeting_id,
                idempotency_key=idempotency_key,
                request_digest=fingerprint,
            )
        )
    return meeting


async def update_meeting(
    session: AsyncSession,
    leader: Account,
    meeting_id: UUID,
    body: MeetingUpdateFields,
    origin: str,
) -> tuple[Meeting, PreparedEmail | None]:
    leader = await lock_account(session, leader.account_id, no_key_update=True)
    meeting = await owned_meeting(session, leader.account_id, meeting_id, lock=True)
    previous_charge = client_charge(meeting)
    previous_expense = service_expense(meeting)
    previous_start = meeting.starts_at
    previous_card_id = meeting.client_card_id
    card = await _apply_form(
        session, leader, meeting, body, origin, datetime.now(UTC), meeting.meeting_id
    )
    # spec:impl meeting-outcome-recording#apply-edited-payment-type-client
    await correct_client_charge(session, leader, meeting, card, previous_charge)
    correct_service_expense(session, meeting, previous_expense)
    # spec:impl client-meeting-notifications#notify-meeting-change-other-reschedule
    if (
        meeting.status == MeetingStatus.SCHEDULED.value
        and card is not None
        and previous_card_id == card.client_card_id
        and previous_start != meeting.starts_at
    ):
        # spec:impl client-meeting-notifications#notify-client-after-leader-saves
        return meeting, await prepare_meeting_notification(
            session, leader, card, meeting, previous_starts_at=previous_start
        )
    return meeting, None


async def cancel_or_delete_meeting(
    session: AsyncSession,
    leader: Account,
    meeting: Meeting,
    card: ClientCard | None,
    refund: bool | None,
) -> PreparedEmail | None:
    await delete_meeting(session, leader, meeting, card, refund)
    # spec:impl client-meeting-notifications#notify-client-after-leader-confirms
    if meeting.status == MeetingStatus.SCHEDULED.value and card is not None:
        return await prepare_meeting_notification(session, leader, card, meeting)
    return None
