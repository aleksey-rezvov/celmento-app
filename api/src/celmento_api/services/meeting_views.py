from datetime import datetime
from math import ceil
from uuid import UUID

from sqlalchemy import DateTime, Nullable, Select, func, select, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import address_url
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ClientCardStatus,
    Currency,
    MeetingPlace,
    MeetingSource,
    MeetingStatus,
    MeetingType,
    PaymentType,
)
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.clients import ClientRef
from celmento_api.schemas.meetings import (
    ClientMeetingList,
    MeetingDetail,
    MeetingList,
    MeetingPendingOutcomeList,
)
from celmento_api.schemas.meetings import (
    Meeting as MeetingView,
)
from celmento_api.schemas.money import Money, format_amount
from celmento_api.services.clients import client_view
from celmento_api.services.outcomes import client_charge, visible_charge_choice
from celmento_api.services.schedule import (
    awaiting_outcome,
    pending_condition,
    planned_end_expression,
)
from celmento_api.storage import client_photo_url


def _selection(leader_id: UUID) -> Select[Meeting, ClientCard | None, str | None]:
    return (
        select(Meeting, Nullable(ClientCard), Nullable(Account.time_zone))
        .outerjoin(
            ClientCard,
            (ClientCard.client_card_id == Meeting.client_card_id)
            & (ClientCard.leader_account_id == Meeting.leader_account_id),
        )
        .outerjoin(Account, Account.account_id == ClientCard.linked_account_id)
        .where(Meeting.leader_account_id == leader_id)
    )


def _money(amount: str, currency: str | None) -> Money | None:
    return (
        Money(amount=amount, currency=Currency(currency))
        if currency is not None
        else None
    )


def meeting_view(
    meeting: Meeting,
    card: ClientCard | None,
    linked_zone: str | None,
    leader: Account,
    origin: str,
    now: datetime,
) -> MeetingView:
    client = None
    if card is not None:
        # spec:impl time-zone-handling#take-other-party-zone-only-linked
        client = ClientRef(
            id=card.client_card_id,
            name=card.name,
            photo_url=client_photo_url(card.client_card_id, card.photo_key, origin),
            archived=card.status == ClientCardStatus.ARCHIVED.value,
            linked=card.linked_account_id is not None,
            time_zone=linked_zone,
        )
    return MeetingView(
        id=meeting.meeting_id,
        type=MeetingType(meeting.type),
        client=client,
        with_whom=meeting.with_whom,
        topic=meeting.topic,
        starts_at=meeting.starts_at,
        duration_minutes=meeting.duration_minutes,
        my_duration_minutes=meeting.my_duration_minutes,
        actual_duration_minutes=meeting.actual_duration_minutes,
        place=MeetingPlace(meeting.place),
        meeting_link=meeting.meeting_link,
        address=meeting.address,
        price=_money(format_amount(meeting.price), meeting.currency)
        if meeting.price is not None
        else None,
        payment_type=PaymentType(meeting.payment_type)
        if meeting.payment_type is not None
        else None,
        status=MeetingStatus(meeting.status),
        charged=visible_charge_choice(meeting),
        comment=meeting.comment,
        source=MeetingSource(meeting.source),
        client_comment=meeting.client_comment,
        invite_url=f"{address_url(leader.login)}/meet/{meeting.public_id}"
        if meeting.type == MeetingType.CLIENT_SESSION.value
        else None,
        awaiting_outcome=awaiting_outcome(meeting, now),
        created_at=meeting.created_at,
    )


async def own_meeting_view(
    session: AsyncSession, meeting: Meeting, leader: Account, origin: str, now: datetime
) -> MeetingView:
    stored, card, zone = (
        await session.execute(
            _selection(leader.account_id).where(
                Meeting.meeting_id == meeting.meeting_id
            )
        )
    ).one()
    return meeting_view(stored, card, zone, leader, origin, now)


async def meeting_detail(
    session: AsyncSession, meeting: Meeting, leader: Account, origin: str, now: datetime
) -> MeetingDetail:
    rows = await session.execute(
        _selection(leader.account_id).where(Meeting.meeting_id == meeting.meeting_id)
    )
    stored, card, zone = rows.one()
    summary = meeting_view(stored, card, zone, leader, origin, now)
    charged = client_charge(meeting)
    return MeetingDetail.model_validate(
        {
            **summary.model_dump(),
            "client_card": await client_view(session, card, origin)
            if card is not None
            else None,
            "balance_charge": _money(format_amount(charged), meeting.currency)
            if charged > 0
            else None,
        }
    )


async def list_meetings(
    session: AsyncSession,
    leader: Account,
    lower: datetime,
    upper: datetime,
    origin: str,
    now: datetime,
) -> MeetingList:
    if leader.activated_at is None:
        return MeetingList(
            items=[],
            attended=[],
            pending_outcomes_count=0,
            next_outcome_in_seconds=None,
            attended_total=0,
            specialists_count=0,
        )
    rows = await session.execute(
        _selection(leader.account_id)
        .where(Meeting.starts_at >= lower, Meeting.starts_at < upper)
        .order_by(Meeting.starts_at, Meeting.meeting_id)
    )
    planned_end = planned_end_expression()
    count, next_end = (
        await session.execute(
            select(
                func.count().filter(planned_end <= now),
                Nullable(
                    type_coerce(
                        func.min(planned_end).filter(planned_end > now),
                        DateTime(timezone=True),
                    )
                ),
            ).where(
                Meeting.leader_account_id == leader.account_id,
                Meeting.status == MeetingStatus.SCHEDULED.value,
            )
        )
    ).one()
    return MeetingList(
        items=[
            meeting_view(meeting, card, zone, leader, origin, now)
            for meeting, card, zone in rows
        ],
        attended=[],
        pending_outcomes_count=count,
        next_outcome_in_seconds=ceil((next_end - now).total_seconds())
        if next_end
        else None,
        attended_total=0,
        specialists_count=0,
    )


async def list_pending_outcomes(
    session: AsyncSession, leader: Account, origin: str, now: datetime
) -> MeetingPendingOutcomeList:
    # spec:impl pending-outcomes#list-screen-3-5-meeting-awaiting
    rows = await session.execute(
        _selection(leader.account_id)
        .where(pending_condition(now))
        .order_by(Meeting.starts_at, Meeting.meeting_id)
    )
    items = [
        meeting_view(meeting, card, zone, leader, origin, now)
        for meeting, card, zone in rows
    ]
    return MeetingPendingOutcomeList(items=items, count=len(items))


async def list_client_meetings(
    session: AsyncSession,
    leader: Account,
    card: ClientCard,
    origin: str,
    now: datetime,
    limit: int | None,
) -> ClientMeetingList:
    statement = _selection(leader.account_id).where(
        Meeting.client_card_id == card.client_card_id
    )
    upcoming = (Meeting.status == MeetingStatus.SCHEDULED.value) & (
        planned_end_expression() > now
    )
    future_rows = await session.execute(
        statement.where(upcoming)
        .order_by(Meeting.starts_at, Meeting.meeting_id)
        .limit(limit)
    )
    past_rows = await session.execute(
        statement.where(~upcoming)
        .order_by(Meeting.starts_at.desc(), Meeting.meeting_id.desc())
        .limit(limit)
    )
    return ClientMeetingList(
        upcoming=[
            meeting_view(meeting, record, zone, leader, origin, now)
            for meeting, record, zone in future_rows
        ],
        past=[
            meeting_view(meeting, record, zone, leader, origin, now)
            for meeting, record, zone in past_rows
        ],
    )
