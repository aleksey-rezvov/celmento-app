from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import address_url, current_contour
from celmento_api.models.account import Account
from celmento_api.models.enums import (
    AcceptanceKind,
    Currency,
    Language,
    SessionFormat,
    Weekday,
)
from celmento_api.models.legal import Acceptance
from celmento_api.schemas.account import Account as AccountView
from celmento_api.schemas.account import LeaderProfile, PlanKind, PlanStatus, WorkingDay
from celmento_api.schemas.documents import AcceptanceRecord

FREE_CLIENT_LIMIT: int = 3
DEFAULT_SESSION_MINUTES: int = 60


def initial_leader_profile(account: Account) -> LeaderProfile:
    return LeaderProfile(
        specializations=[],
        specialization_other=None,
        about="",
        contact_email=account.email,
        links=[],
        main_channel=None,
        booking_url=address_url(account.login),
        working_hours=[
            WorkingDay(
                weekday=day,
                working=day not in {Weekday.SAT, Weekday.SUN},
                start="10:00",
                end="18:00",
            )
            for day in Weekday
        ],
        session_duration_minutes=DEFAULT_SESSION_MINUTES,
        session_format=SessionFormat.ONLINE,
        default_meeting_link=None,
        default_rate=None,
        default_currency=Currency.RUB,
        plan=PlanStatus(
            kind=PlanKind.FREE,
            active_clients=0,
            client_limit=FREE_CLIENT_LIMIT,
            subscription_until=None,
        ),
    )


async def account_view(session: AsyncSession, account: Account) -> AccountView:
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
        photo_url=None,
        phone=account.phone,
        telegram=account.telegram,
        whatsapp=account.whatsapp,
        login=account.login,
        address_url=address_url(account.login),
        language=Language(account.language),
        time_zone=account.time_zone,
        activated=account.activated_at is not None,
        activated_at=account.activated_at,
        leader=initial_leader_profile(account)
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
