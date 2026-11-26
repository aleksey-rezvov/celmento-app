from datetime import datetime
from uuid import UUID

from sqlalchemy import Nullable, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ClientCardStatus,
    Currency,
    ErrorCode,
    MeetingPlace,
    MeetingStatus,
    MeetingType,
    PaymentType,
    SessionFormat,
    Specialization,
)
from celmento_api.models.leader import LeaderProfile
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.meetings import AttendedMeeting, SpecialistRef
from celmento_api.schemas.money import Money, format_amount
from celmento_api.schemas.specialists import (
    SpecialistCard,
    SpecialistList,
    SpecialistListItem,
)
from celmento_api.services.accounts import DEFAULT_SESSION_FORMAT
from celmento_api.services.note_access import notes_shared_by_specialist
from celmento_api.services.outcomes import visible_charge_choice
from celmento_api.services.public_pages import main_contact
from celmento_api.services.schedule import (
    attended_meeting_query,
    planned_end_expression,
)
from celmento_api.storage import photo_url


def _linked_specialists(account_id: UUID) -> Select[ClientCard, Account, LeaderProfile]:
    return (
        select(ClientCard, Account, LeaderProfile)
        .select_from(ClientCard)
        .join(Account, Account.account_id == ClientCard.leader_account_id)
        .join(LeaderProfile, LeaderProfile.account_id == Account.account_id)
        .where(
            ClientCard.linked_account_id == account_id,
            Account.activated_at.is_not(None),
        )
    )


async def linked_specialist(
    session: AsyncSession, account_id: UUID, specialist_id: UUID
) -> tuple[ClientCard, Account, LeaderProfile]:
    result = (
        await session.execute(
            _linked_specialists(account_id).where(
                ClientCard.leader_account_id == specialist_id
            )
        )
    ).one_or_none()
    if result is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    card, leader, profile = result
    return card, leader, profile


def _linked_card_query(account_id: UUID, leader_id: UUID) -> Select[ClientCard]:
    return select(ClientCard).where(
        ClientCard.linked_account_id == account_id,
        ClientCard.leader_account_id == leader_id,
    )


async def require_current_link(
    session: AsyncSession, account_id: UUID, leader_id: UUID
) -> None:
    linked_id = await session.scalar(
        _linked_card_query(account_id, leader_id).with_only_columns(
            ClientCard.client_card_id
        )
    )
    if linked_id is None:
        raise AppError(404, ErrorCode.NOT_FOUND)


async def lock_linked_card(
    session: AsyncSession, account_id: UUID, leader_id: UUID
) -> ClientCard:
    card = await session.scalar(
        _linked_card_query(account_id, leader_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if card is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return card


def specialist_ref(
    leader: Account, profile: LeaderProfile, origin: str
) -> SpecialistRef:
    return SpecialistRef(
        id=leader.account_id,
        first_name=leader.first_name,
        last_name=leader.last_name,
        photo_url=photo_url(leader.photo_key, origin),
        specializations=[Specialization(value) for value in profile.specializations],
        specialization_other=profile.specialization_other,
        time_zone=leader.time_zone,
        phone=leader.phone,
        telegram=leader.telegram,
        whatsapp=leader.whatsapp,
        contact_email=profile.contact_email,
    )


def attended_view(
    meeting: Meeting, leader: Account, profile: LeaderProfile, origin: str
) -> AttendedMeeting:
    if (
        meeting.price is None
        or meeting.currency is None
        or meeting.payment_type is None
    ):
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    place = MeetingPlace(meeting.place)
    # spec:impl attended-meetings#show-actual-duration-leader-comment
    return AttendedMeeting(
        id=meeting.meeting_id,
        specialist=specialist_ref(leader, profile, origin),
        starts_at=meeting.starts_at,
        duration_minutes=meeting.duration_minutes,
        place=place,
        meeting_link=meeting.meeting_link,
        # spec:impl attended-meetings#show-in-person-meeting-address
        address=meeting.address if place == MeetingPlace.IN_PERSON else None,
        price=Money(
            amount=format_amount(meeting.price), currency=Currency(meeting.currency)
        ),
        payment_type=PaymentType(meeting.payment_type),
        status=MeetingStatus(meeting.status),
        charged=visible_charge_choice(meeting),
    )


def _attended_rows(account_id: UUID) -> Select[Meeting, Account, LeaderProfile]:
    return (
        attended_meeting_query(account_id)
        .join(Account, Account.account_id == Meeting.leader_account_id)
        .join(LeaderProfile, LeaderProfile.account_id == Account.account_id)
        .add_columns(Account, LeaderProfile)
    )


async def attended_record(
    session: AsyncSession, account_id: UUID, meeting_id: UUID
) -> tuple[Meeting, Account, LeaderProfile]:
    result = (
        await session.execute(
            _attended_rows(account_id).where(Meeting.meeting_id == meeting_id)
        )
    ).one_or_none()
    if result is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    meeting, leader, profile = result
    return meeting, leader, profile


async def attended_meetings(
    session: AsyncSession,
    account_id: UUID,
    lower: datetime,
    upper: datetime,
    origin: str,
) -> list[AttendedMeeting]:
    rows = await session.execute(
        _attended_rows(account_id)
        .where(Meeting.starts_at >= lower, Meeting.starts_at < upper)
        .order_by(Meeting.starts_at, Meeting.meeting_id)
    )
    return [
        attended_view(meeting, leader, profile, origin)
        for meeting, leader, profile in rows
    ]


async def attended_counts(session: AsyncSession, account_id: UUID) -> tuple[int, int]:
    count_meetings = (
        attended_meeting_query(account_id)
        .with_only_columns(func.count(Meeting.meeting_id))
        .scalar_subquery()
    )
    count_specialists = (
        _linked_specialists(account_id)
        .with_only_columns(func.count(ClientCard.client_card_id))
        .scalar_subquery()
    )
    meetings, specialists = (
        await session.execute(select(count_meetings, count_specialists))
    ).one()
    return meetings, specialists


async def specialists_for(
    session: AsyncSession, account_id: UUID, origin: str, now: datetime
) -> SpecialistList:
    nearest = (
        select(func.min(Meeting.starts_at))
        .where(
            Meeting.client_card_id == ClientCard.client_card_id,
            Meeting.leader_account_id == ClientCard.leader_account_id,
            Meeting.type == MeetingType.CLIENT_SESSION.value,
            Meeting.status == MeetingStatus.SCHEDULED.value,
            planned_end_expression() > now,
        )
        .correlate(ClientCard)
        .scalar_subquery()
    )
    rows = await session.execute(
        _linked_specialists(account_id)
        .add_columns(Nullable(nearest))
        .order_by(
            func.lower(Account.first_name),
            func.lower(Account.last_name),
            Account.account_id,
        )
    )
    # spec:impl client-my-specialists#list-section-leader-client-card
    # spec:impl client-my-specialists#list-leader-no-card-linked
    return SpecialistList(
        items=[
            SpecialistListItem(
                specialist=specialist_ref(leader, profile, origin),
                next_booking_at=starts_at,
            )
            for _, leader, profile, starts_at in rows
        ]
    )


async def specialist_card_for(
    session: AsyncSession,
    viewer: Account,
    specialist_id: UUID,
    origin: str,
    now: datetime,
) -> SpecialistCard:
    card, leader, profile = await linked_specialist(
        session, viewer.account_id, specialist_id
    )
    available = card.status == ClientCardStatus.ACTIVE.value
    upcoming = (Meeting.status == MeetingStatus.SCHEDULED.value) & (
        planned_end_expression() > now
    )
    statement = attended_meeting_query(viewer.account_id).where(
        Meeting.client_card_id == card.client_card_id
    )
    if available:
        statement = statement.where(upcoming).order_by(
            Meeting.starts_at, Meeting.meeting_id
        )
    else:
        # spec:impl attended-meetings#keep-past-attended-meetings-leader
        statement = statement.where(~upcoming).order_by(
            Meeting.starts_at.desc(), Meeting.meeting_id.desc()
        )
    meetings = await session.scalars(statement)
    entries = [attended_view(meeting, leader, profile, origin) for meeting in meetings]
    payment_type = PaymentType(card.payment_type)
    price = None
    if payment_type == PaymentType.PAID and card.rate is not None and card.rate > 0:
        price = Money(amount=format_amount(card.rate), currency=Currency(card.currency))
    # spec:impl client-my-specialists#show-list-card-9-6-card
    return SpecialistCard(
        specialist=specialist_ref(leader, profile, origin),
        about=profile.about,
        session_format=SessionFormat(profile.session_format or DEFAULT_SESSION_FORMAT),
        main_contact=main_contact(leader, profile),
        price_for_me=price,
        payment_type=payment_type,
        booking_available=available,
        upcoming_meetings=entries if available else [],
        past_meetings=[] if available else entries,
        shared_notes=await notes_shared_by_specialist(
            session, viewer, specialist_id, origin
        ),
    )
