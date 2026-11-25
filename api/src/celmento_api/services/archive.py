from collections.abc import Sequence
from datetime import UTC, datetime
from hashlib import sha256
from json import dumps
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.emails import PreparedEmail
from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ClientCardStatus,
    Currency,
    ErrorCode,
    MeetingStatus,
)
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.meetings import ClientArchivePreview
from celmento_api.schemas.meetings import Meeting as MeetingView
from celmento_api.schemas.money import Money, format_amount
from celmento_api.services.account_access import lock_account
from celmento_api.services.balance import current_amount
from celmento_api.services.clients import active_client_for_update, owned_client
from celmento_api.services.limit import ensure_card_can_become_active
from celmento_api.services.meeting_views import meeting_view
from celmento_api.services.meetings import cancel_or_delete_meeting
from celmento_api.services.schedule import awaiting_outcome


async def _scheduled_meetings(
    session: AsyncSession, card: ClientCard, *, lock: bool = False
) -> Sequence[Meeting]:
    statement = (
        select(Meeting)
        .where(
            Meeting.leader_account_id == card.leader_account_id,
            Meeting.client_card_id == card.client_card_id,
            Meeting.status == MeetingStatus.SCHEDULED.value,
        )
        .order_by(Meeting.starts_at, Meeting.meeting_id)
    )
    if lock:
        statement = statement.with_for_update().execution_options(
            populate_existing=True
        )
    return (await session.scalars(statement)).all()


def _preview_token(card: ClientCard, meetings: Sequence[Meeting]) -> str:
    planned = [
        (
            str(meeting.meeting_id),
            meeting.starts_at.astimezone(UTC).isoformat(),
            meeting.duration_minutes,
        )
        for meeting in meetings
    ]
    payload = dumps((str(card.client_card_id), planned), separators=(",", ":"))
    return sha256(payload.encode()).hexdigest()


async def client_archive_preview(
    session: AsyncSession, leader: Account, client_id: UUID, origin: str
) -> ClientArchivePreview:
    card = await owned_client(session, leader.account_id, client_id, lock=True)
    now = datetime.now(UTC)
    linked_zone = None
    if card.linked_account_id is not None:
        linked_zone = await session.scalar(
            select(Account.time_zone).where(
                Account.account_id == card.linked_account_id
            )
        )
    planned: list[Meeting] = []
    meetings_to_delete: list[MeetingView] = []
    meetings_awaiting_outcome: list[MeetingView] = []
    for meeting in await _scheduled_meetings(session, card):
        summary = meeting_view(meeting, card, linked_zone, leader, origin, now)
        if summary.awaiting_outcome:
            meetings_awaiting_outcome.append(summary)
        else:
            planned.append(meeting)
            meetings_to_delete.append(summary)
    return ClientArchivePreview(
        preview_token=_preview_token(card, planned),
        meetings_to_delete=meetings_to_delete,
        meetings_awaiting_outcome=meetings_awaiting_outcome,
        balance=Money(
            amount=format_amount(await current_amount(session, card)),
            currency=Currency(card.currency),
        ),
    )


async def archive_client_card(
    session: AsyncSession, leader: Account, client_id: UUID, preview_token: str
) -> tuple[ClientCard, list[PreparedEmail]]:
    leader = await lock_account(session, leader.account_id, no_key_update=True)
    card = await active_client_for_update(session, leader.account_id, client_id)
    scheduled = await _scheduled_meetings(session, card, lock=True)
    now = datetime.now(UTC)
    if any(awaiting_outcome(meeting, now) for meeting in scheduled):
        raise AppError(409, ErrorCode.OUTCOMES_PENDING)
    if preview_token != _preview_token(card, scheduled):
        raise AppError(409, ErrorCode.CONFLICT)

    emails: list[PreparedEmail] = []
    for meeting in scheduled:
        # spec:impl client-archive-restore#notify-deleted-scheduled-meeting
        # spec:impl client-meeting-notifications#notify-client-scheduled-meeting-deleted
        email = await cancel_or_delete_meeting(session, leader, meeting, card, None)
        if email is not None:
            emails.append(email)
    # spec:impl client-archive-restore#delete-listed-scheduled-meetings-move
    # spec:impl client-archive-restore#keep-card-link-card-archived
    card.status = ClientCardStatus.ARCHIVED.value
    card.archived_at = now
    return card, emails


async def restore_client_card(
    session: AsyncSession, leader: Account, client_id: UUID
) -> ClientCard:
    leader = await lock_account(session, leader.account_id, no_key_update=True)
    card = await owned_client(session, leader.account_id, client_id, lock=True)
    if card.status != ClientCardStatus.ARCHIVED.value:
        raise AppError(409, ErrorCode.CLIENT_NOT_ARCHIVED)
    await ensure_card_can_become_active(session, leader)
    # spec:impl client-archive-restore#limit-how-many-times-client
    card.status = ClientCardStatus.ACTIVE.value
    card.archived_at = None
    return card
