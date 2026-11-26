from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour, public_api_base_url, web_url
from celmento_api.emails import EmailTemplate, PreparedEmail
from celmento_api.errors import AppError, invalid_request_value
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ClientCardStatus,
    ClientSource,
    ErrorCode,
    Language,
    MeetingPlace,
    MeetingSource,
    MeetingStatus,
    MeetingType,
    NoticeKey,
    NoticeTab,
    PaymentType,
    SessionFormat,
)
from celmento_api.models.leader import LeaderProfile
from celmento_api.models.meeting import GuestBookingReceipt, Meeting
from celmento_api.schemas.auth import OriginPage, RegistrationOrigin
from celmento_api.schemas.public import (
    GuestBookingConfirmation,
    GuestBookingCreate,
    MainContact,
)
from celmento_api.services.accounts import (
    DEFAULT_CURRENCY,
    DEFAULT_SESSION_DURATION,
    DEFAULT_SESSION_FORMAT,
    leader_record,
)
from celmento_api.services.email_dates import local_email_date
from celmento_api.services.idempotency import request_fingerprint
from celmento_api.services.legal import (
    REGISTRATION_CONSENTS,
    record_acceptances,
    require_consents,
)
from celmento_api.services.limit import ensure_card_can_become_active
from celmento_api.services.links import auto_link_card, lock_self_given_email
from celmento_api.services.notices import raise_notice
from celmento_api.services.public_pages import (
    booking_context,
    main_contact,
    public_leader,
)
from celmento_api.services.sign_in_codes import normalize_email
from celmento_api.services.slots import ensure_slot_bookable

PLACE_LABELS: dict[Language, dict[MeetingPlace, str]] = {
    Language.RU: {MeetingPlace.ONLINE: "Онлайн", MeetingPlace.IN_PERSON: "Очно"},
    Language.EN: {MeetingPlace.ONLINE: "Online", MeetingPlace.IN_PERSON: "In person"},
}


@dataclass(frozen=True, slots=True)
class GuestBooked:
    booking: GuestBookingConfirmation
    email: PreparedEmail | None


@dataclass(frozen=True, slots=True)
class BookingUnavailable:
    contact: MainContact | None

    def error(self) -> AppError:
        return AppError(
            409,
            ErrorCode.BOOKING_UNAVAILABLE,
            {
                "main_contact": self.contact.model_dump(mode="json")
                if self.contact is not None
                else None,
            },
        )


def booking_place(
    profile: LeaderProfile,
    requested: MeetingPlace | None,
    expected_format: SessionFormat | None,
) -> MeetingPlace:
    session_format = SessionFormat(profile.session_format or DEFAULT_SESSION_FORMAT)
    if expected_format is not None and expected_format != session_format:
        raise AppError(409, ErrorCode.CONFLICT)
    if session_format != SessionFormat.BOTH:
        return MeetingPlace(session_format.value)
    if requested is None:
        raise invalid_request_value("body", "place")
    return requested


async def _matched_card(
    session: AsyncSession, leader_id: UUID, email: str, *, lock: bool = False
) -> ClientCard | None:
    # spec:impl guest-booking-flow#match-entered-email-case-insensitively
    statement = (
        select(ClientCard)
        .where(
            ClientCard.leader_account_id == leader_id,
            ClientCard.self_given_email == email,
        )
        .order_by(ClientCard.created_at, ClientCard.client_card_id)
        .limit(1)
        .execution_options(populate_existing=True)
    )
    if lock:
        statement = statement.with_for_update()
    return await session.scalar(statement)


async def lock_booking_accounts(
    session: AsyncSession, leader_id: UUID, attendee_id: UUID | None
) -> Account:
    account_ids = {leader_id}
    if attendee_id is not None:
        account_ids.add(attendee_id)
    # Reciprocal bookings lock the same rows in the same order.
    locked = await session.scalars(
        select(Account)
        .where(Account.account_id.in_(account_ids))
        .order_by(Account.account_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    leader = next(
        (account for account in locked if account.account_id == leader_id), None
    )
    if leader is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return leader


async def _effective_attendee(
    session: AsyncSession, leader_id: UUID, email: str, card: ClientCard | None
) -> UUID | None:
    if card is not None:
        if card.status == ClientCardStatus.ARCHIVED.value:
            return None
        if card.linked_account_id is not None:
            return card.linked_account_id
        if card.auto_link_blocked:
            return None
    account_id = await session.scalar(
        select(Account.account_id).where(
            Account.email == email, Account.account_id != leader_id
        )
    )
    if account_id is None:
        return None
    duplicate = await session.scalar(
        select(ClientCard.client_card_id).where(
            ClientCard.leader_account_id == leader_id,
            ClientCard.linked_account_id == account_id,
        )
    )
    return account_id if duplicate is None else None


async def _locked_booking_participants(
    session: AsyncSession, leader_id: UUID, email: str
) -> tuple[Account, ClientCard | None, UUID | None]:
    while True:
        preliminary = await _matched_card(session, leader_id, email)
        attendee_id = await _effective_attendee(session, leader_id, email, preliminary)
        async with session.begin_nested() as locks:
            leader = await lock_booking_accounts(session, leader_id, attendee_id)
            await lock_self_given_email(session, email)
            card = await _matched_card(session, leader_id, email, lock=True)
            confirmed = await _effective_attendee(session, leader_id, email, card)
            if confirmed == attendee_id:
                return leader, card, confirmed
            # Release the provisional locks before taking a different account pair.
            await locks.rollback()


def _new_guest_card(
    leader: Account, profile: LeaderProfile, body: GuestBookingCreate, email: str
) -> ClientCard:
    rate = profile.default_rate
    # spec:impl guest-booking-flow#create-client-card-email-matches
    # spec:impl guest-booking-flow#copy-entered-email-contacts-title-new
    # spec:impl guest-booking-flow#give-card-created-booking-payment
    return ClientCard(
        leader_account_id=leader.account_id,
        name=body.name,
        # spec:impl client-card-profile-link#store-self-given-email-card-separate
        self_given_email=email,
        other_contact=body.contact,
        rate=rate,
        currency=profile.default_currency or DEFAULT_CURRENCY.value,
        payment_type=PaymentType.PAID.value
        if rate is not None and rate > 0
        else PaymentType.PRO_BONO.value,
        source=ClientSource.BOOKED_VIA_LINK.value,
        is_new=True,
    )


async def create_self_booked_meeting(
    session: AsyncSession,
    card: ClientCard,
    profile: LeaderProfile,
    starts_at: datetime,
    place: MeetingPlace,
    comment: str | None,
    *,
    guest_language: Language | None = None,
    guest_time_zone: str | None = None,
) -> Meeting:
    price = card.rate if card.rate is not None else Decimal(0)
    payment = PaymentType(card.payment_type)
    if payment == PaymentType.PAID and price == 0:
        payment = PaymentType.PRO_BONO
    now = datetime.now(UTC)
    # spec:impl guest-booking-flow#create-scheduled-individual-client
    meeting = Meeting(
        leader_account_id=card.leader_account_id,
        client_card_id=card.client_card_id,
        type=MeetingType.CLIENT_SESSION.value,
        source=MeetingSource.SELF_BOOKED.value,
        status=MeetingStatus.SCHEDULED.value,
        starts_at=starts_at,
        duration_minutes=profile.session_duration_minutes or DEFAULT_SESSION_DURATION,
        place=place.value,
        meeting_link=profile.default_meeting_link
        if place == MeetingPlace.ONLINE
        else None,
        price=price,
        currency=card.currency,
        currency_version=card.currency_version,
        payment_type=payment.value,
        client_comment=comment,
        guest_language=guest_language.value if guest_language is not None else None,
        # spec:impl time-zone-handling#record-guest-device-zone-guest
        guest_time_zone=guest_time_zone,
        created_at=now,
        updated_at=now,
    )
    session.add(meeting)
    await session.flush()
    return meeting


def _confirmation(
    leader: Account, meeting: Meeting, recipient: str
) -> GuestBookingConfirmation:
    return GuestBookingConfirmation(
        id=meeting.public_id,
        specialist_name=f"{leader.first_name} {leader.last_name}",
        starts_at=meeting.starts_at,
        place=MeetingPlace(meeting.place),
        meeting_link=meeting.meeting_link,
        email=recipient,
    )


def _confirmation_email(
    leader: Account,
    profile: LeaderProfile,
    booking: GuestBookingConfirmation,
    language: Language,
    time_zone: str,
) -> PreparedEmail:
    when = local_email_date(booking.starts_at, time_zone, language)
    contact = main_contact(leader, profile)
    origin = RegistrationOrigin(
        page=OriginPage.PUBLIC_BOOKING, login=leader.login, meeting_id=None
    )
    params = urlencode({"email": booking.email, "origin": origin.model_dump_json()})
    # spec:impl guest-booking-flow#send-confirmation-email-entered-email
    # spec:impl guest-booking-flow#open-sign-in-leader-contour-domain
    return PreparedEmail(
        recipient=booking.email,
        template=EmailTemplate.BOOKING_CONFIRMATION,
        language=language,
        params={
            "specialist_name": " ".join(booking.specialist_name.split()),
            "date": when.date,
            "time": when.time,
            "city": when.city,
            "timezone": when.offset,
            "format": PLACE_LABELS[language][booking.place],
            "meeting_link": booking.meeting_link or "",
            "specialist_contact": contact.value if contact is not None else "",
            "open_app_url": f"{web_url(current_contour())}/login?{params}",
            "calendar_url": f"{public_api_base_url()}/public/bookings/{booking.id}/calendar.ics",
        },
    )


async def _previous_booking(
    session: AsyncSession, leader: Account, key: UUID, digest: str
) -> Meeting | None:
    receipt = await session.scalar(
        select(GuestBookingReceipt).where(
            GuestBookingReceipt.leader_account_id == leader.account_id,
            GuestBookingReceipt.idempotency_key == key,
        )
    )
    if receipt is None:
        return None
    if receipt.request_digest != digest or receipt.meeting_id is None:
        raise AppError(409, ErrorCode.CONFLICT)
    meeting = await session.scalar(
        select(Meeting).where(
            Meeting.meeting_id == receipt.meeting_id,
            Meeting.public_id == receipt.public_id,
            Meeting.leader_account_id == leader.account_id,
            Meeting.type == MeetingType.CLIENT_SESSION.value,
            Meeting.source == MeetingSource.SELF_BOOKED.value,
        )
    )
    if meeting is None:
        raise AppError(409, ErrorCode.CONFLICT)
    return meeting


async def create_guest_booking(
    session: AsyncSession, body: GuestBookingCreate, key: UUID | None
) -> GuestBooked | BookingUnavailable:
    try:
        email = normalize_email(body.email)
    except AppError:
        raise invalid_request_value("body", "email") from None
    record = await public_leader(session, body.login)
    if body.booking_context != booking_context(record):
        raise AppError(409, ErrorCode.CONFLICT)
    leader, card, attendee_id = await _locked_booking_participants(
        session, record.account_id, email
    )
    if leader.login != body.login.lower() or leader.activated_at is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    if body.booking_context != booking_context(leader):
        raise AppError(409, ErrorCode.CONFLICT)
    # spec:impl guest-booking-flow#refuse-booking-self-booking-entered
    if email == leader.email:
        raise AppError(409, ErrorCode.SELF_BOOKING)

    digest = None
    if key is not None:
        payload = body.model_copy(update={"email": email, "login": leader.login})
        digest = request_fingerprint(payload)
        existing = await _previous_booking(session, leader, key, digest)
        if existing is not None:
            return GuestBooked(_confirmation(leader, existing, email), None)

    await require_consents(session, body.consents, REGISTRATION_CONSENTS)
    profile = await leader_record(session, leader.account_id)
    place = booking_place(profile, body.place, body.expected_session_format)
    now = datetime.now(UTC)
    starts_at = await ensure_slot_bookable(
        session, leader, profile, body.starts_at, now
    )
    if card is not None and card.status == ClientCardStatus.ARCHIVED.value:
        await raise_notice(
            session,
            leader.account_id,
            NoticeTab.PEOPLE,
            NoticeKey.ARCHIVED_CLIENT_TRIED,
            {"name": card.name},
        )
        return BookingUnavailable(main_contact(leader, profile))
    if card is None:
        try:
            await ensure_card_can_become_active(session, leader)
        except AppError as exc:
            if exc.code != ErrorCode.CLIENT_LIMIT_REACHED:
                raise
            # spec:impl free-plan-client-limit#show-leader-bar-limit-new-client-guest
            await raise_notice(
                session,
                leader.account_id,
                NoticeTab.PEOPLE,
                NoticeKey.LIMIT_NEW_CLIENT,
                {"name": body.name},
            )
            return BookingUnavailable(main_contact(leader, profile))
        card = _new_guest_card(leader, profile, body, email)
        session.add(card)
        await session.flush()

    # spec:impl guest-booking-flow#attach-booking-active-card-self-given
    # Keep delivery preferences when meetings are cancelled, without editing card content.
    card.guest_language = body.language.value
    card.guest_time_zone = body.time_zone
    # spec:impl guest-booking-flow#set-auto-link-card-booking
    # spec:impl client-card-profile-link#make-auto-link-booking
    if attendee_id is not None:
        await auto_link_card(session, card)
    meeting = await create_self_booked_meeting(
        session,
        card,
        profile,
        starts_at,
        place,
        body.comment,
        guest_language=body.language,
        guest_time_zone=body.time_zone,
    )
    # spec:impl legal-documents#store-guest-booking-date-time
    record_acceptances(
        session, body.consents, meeting_id=meeting.meeting_id, accepted_at=now
    )
    if key is not None and digest is not None:
        session.add(
            GuestBookingReceipt(
                leader_account_id=leader.account_id,
                meeting_id=meeting.meeting_id,
                public_id=meeting.public_id,
                idempotency_key=key,
                request_digest=digest,
            )
        )
    booking = _confirmation(leader, meeting, email)
    # spec:impl guest-booking-flow#verify-entered-email-before-booking
    # spec:impl guest-booking-flow#create-account-guest-ask-age
    return GuestBooked(
        booking,
        _confirmation_email(leader, profile, booking, body.language, body.time_zone),
    )
