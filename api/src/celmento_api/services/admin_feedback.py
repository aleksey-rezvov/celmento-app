from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.admin import AdminKey
from celmento_api.models.enums import (
    AdminAction,
    AdminFeedbackScreen,
    AdminJournalObjectType,
    ErrorCode,
)
from celmento_api.models.feedback import FeedbackMessage
from celmento_api.schemas.admin import (
    AdminFeedbackItem,
    AdminFeedbackList,
    AdminFeedbackMarkProcessed,
    AdminPeriod,
)
from celmento_api.services.admin_period import utc_conditions
from celmento_api.services.journal import append_journal


def _feedback_view(row: FeedbackMessage, email: str | None = None) -> AdminFeedbackItem:
    return AdminFeedbackItem(
        id=row.feedback_message_id,
        text=row.text,
        activated=row.activated,
        screen=AdminFeedbackScreen(row.screen),
        created_at=row.created_at,
        processed=row.processed_at is not None,
        email=email,
    )


async def feedback_for(
    session: AsyncSession, period: AdminPeriod, *, new_only: bool, include_email: bool
) -> AdminFeedbackList:
    # spec:impl admin-feedback-stats#show-period-administrator-names-feedback
    statement = (
        select(FeedbackMessage)
        .where(*utc_conditions(FeedbackMessage.created_at, period))
        .order_by(
            FeedbackMessage.created_at.desc(),
            FeedbackMessage.feedback_message_id.desc(),
        )
    )
    # spec:impl admin-feedback-stats#treat-feedback-message-not-marked
    if new_only:
        statement = statement.where(FeedbackMessage.processed_at.is_(None))
    # spec:impl admin-feedback-stats#show-account-email-feedback-author
    if include_email:
        joined = await session.execute(
            statement.join(
                Account, Account.account_id == FeedbackMessage.account_id
            ).add_columns(Account.email)
        )
        return AdminFeedbackList(
            items=[_feedback_view(row, email) for row, email in joined]
        )
    return AdminFeedbackList(
        items=[_feedback_view(row) for row in await session.scalars(statement)]
    )


async def mark_processed(
    session: AsyncSession, key: AdminKey, body: AdminFeedbackMarkProcessed
) -> AdminFeedbackList:
    rows = await session.scalars(
        select(FeedbackMessage)
        .where(FeedbackMessage.feedback_message_id.in_(body.ids))
        .order_by(FeedbackMessage.feedback_message_id)
        .with_for_update()
    )
    by_id = {row.feedback_message_id: row for row in rows}
    unknown_ids = [str(item) for item in body.ids if item not in by_id]
    if unknown_ids:
        raise AppError(404, ErrorCode.NOT_FOUND, {"unknown_ids": unknown_ids})
    now = datetime.now(UTC)
    items: list[AdminFeedbackItem] = []
    for item in body.ids:
        row = by_id[item]
        processed = row.processed_at is not None
        # spec:impl admin-feedback-stats#mark-feedback-messages-administrator
        if row.processed_at is None:
            row.processed_at = now
        append_journal(
            session,
            key,
            AdminAction.MARK_FEEDBACK_PROCESSED,
            AdminJournalObjectType.FEEDBACK,
            object_id=str(item),
            before={"processed": processed},
            after={"processed": True},
        )
        items.append(_feedback_view(row))
    return AdminFeedbackList(items=items)
