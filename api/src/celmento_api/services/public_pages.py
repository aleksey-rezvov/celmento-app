from hmac import digest
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.config import get_settings
from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import (
    ContactChannel,
    Currency,
    ErrorCode,
    MeetingPlace,
    MeetingSource,
    MeetingType,
    SessionFormat,
    Specialization,
)
from celmento_api.models.leader import LeaderProfile
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.money import Money, format_amount
from celmento_api.schemas.public import (
    MainContact,
    MeetingInvitePage,
    PublicSpecialistPage,
)
from celmento_api.services.accounts import (
    DEFAULT_CURRENCY,
    DEFAULT_SESSION_DURATION,
    DEFAULT_SESSION_FORMAT,
    leader_contact,
    leader_record,
)
from celmento_api.storage import photo_url


async def public_leader(session: AsyncSession, login: str) -> Account:
    # spec:impl public-booking-page#show-page-only-login-account
    # spec:impl public-booking-page#resolve-login-only-accounts-contour
    # spec:impl public-booking-page#look-up-login-other-contour
    # spec:impl booking-link-login#make-booking-link-work-moment
    # spec:impl booking-link-login#serve-booking-page-login-non-leader
    leader = await session.scalar(
        select(Account).where(
            Account.login == login.lower(), Account.activated_at.is_not(None)
        )
    )
    if leader is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return leader


def booking_context(leader: Account) -> str:
    secret = get_settings().session_secret.get_secret_value().encode()
    scope = f"celmento:booking-context\n{leader.account_id}\n{leader.login}".encode()
    return digest(secret, scope, "sha256").hex()


def main_contact(leader: Account, profile: LeaderProfile) -> MainContact | None:
    channel = profile.main_channel
    contact = leader_contact(leader, profile, channel)
    if channel is None or contact is None or not contact.strip():
        return None
    return MainContact(channel=ContactChannel(channel), value=contact.strip())


async def specialist_page(
    session: AsyncSession, leader: Account, origin: str
) -> PublicSpecialistPage:
    profile = await leader_record(session, leader.account_id)
    # spec:impl default-rate-currency#supply-profile-rate-currency-price
    price = (
        Money(
            amount=format_amount(profile.default_rate),
            currency=Currency(profile.default_currency or DEFAULT_CURRENCY),
        )
        if profile.default_rate is not None
        else None
    )
    # spec:impl public-booking-page#reveal-leader-meetings-clients-other
    return PublicSpecialistPage(
        login=leader.login,
        booking_context=booking_context(leader),
        first_name=leader.first_name,
        last_name=leader.last_name,
        photo_url=photo_url(leader.photo_key, origin),
        specializations=[Specialization(value) for value in profile.specializations],
        specialization_other=profile.specialization_other,
        about=profile.about,
        price=price,
        session_duration_minutes=profile.session_duration_minutes
        or DEFAULT_SESSION_DURATION,
        session_format=SessionFormat(profile.session_format or DEFAULT_SESSION_FORMAT),
        main_contact=main_contact(leader, profile),
    )


async def invited_meeting(
    session: AsyncSession, login: str, meeting_id: UUID
) -> tuple[Account, Meeting] | None:
    # spec:impl meeting-invite-page#show-page-only-individual-client
    row = (
        await session.execute(
            select(Account, Meeting)
            .join(Meeting, Meeting.leader_account_id == Account.account_id)
            .where(
                Account.login == login.lower(),
                Account.activated_at.is_not(None),
                Meeting.public_id == meeting_id,
                Meeting.type == MeetingType.CLIENT_SESSION.value,
            )
        )
    ).one_or_none()
    if row is None:
        return None
    leader, meeting = row
    return leader, meeting


async def invite_page(
    session: AsyncSession, leader: Account, meeting: Meeting, origin: str
) -> MeetingInvitePage:
    profile = await leader_record(session, leader.account_id)
    # spec:impl meeting-invite-page#show-page-client-name-card
    return MeetingInvitePage(
        specialist_first_name=leader.first_name,
        specialist_last_name=leader.last_name,
        photo_url=photo_url(leader.photo_key, origin),
        specializations=[Specialization(value) for value in profile.specializations],
        specialization_other=profile.specialization_other,
        starts_at=meeting.starts_at,
        duration_minutes=meeting.duration_minutes,
        place=MeetingPlace(meeting.place),
        meeting_link=meeting.meeting_link,
        # spec:impl meeting-invite-page#show-in-person-meeting-address
        address=meeting.address
        if meeting.place == MeetingPlace.IN_PERSON.value
        else None,
    )


async def guest_booking(
    session: AsyncSession, booking_id: UUID
) -> tuple[Account, Meeting] | None:
    row = (
        await session.execute(
            select(Account, Meeting)
            .join(Meeting, Meeting.leader_account_id == Account.account_id)
            .where(
                Meeting.public_id == booking_id,
                Meeting.type == MeetingType.CLIENT_SESSION.value,
                Meeting.source == MeetingSource.SELF_BOOKED.value,
                Meeting.guest_language.is_not(None),
            )
        )
    ).one_or_none()
    if row is None:
        return None
    leader, meeting = row
    return leader, meeting
