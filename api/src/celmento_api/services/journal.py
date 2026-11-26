from collections.abc import Mapping

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.models.admin import AdminJournalEntry as JournalRecord
from celmento_api.models.admin import AdminKey
from celmento_api.models.enums import AdminAction, AdminJournalObjectType
from celmento_api.schemas.admin import AdminJournalEntry, AdminJournalList, AdminPeriod
from celmento_api.services.admin_period import utc_conditions


def append_journal(
    session: AsyncSession,
    key: AdminKey,
    action: AdminAction,
    object_type: AdminJournalObjectType,
    *,
    object_id: str | None = None,
    params: Mapping[str, object] | None = None,
    before: dict[str, object] | None = None,
    after: dict[str, object] | None = None,
) -> None:
    # spec:impl admin-ai-assistant#record-action-read-change-alike
    session.add(
        JournalRecord(
            admin_key_id=key.admin_key_id,
            action=action.value,
            object_type=object_type.value,
            object_id=object_id,
            params=dict(params) if params is not None else {},
            before=before,
            after=after,
        )
    )


async def read_journal(session: AsyncSession, period: AdminPeriod) -> AdminJournalList:
    # spec:impl admin-ai-assistant#show-journal-key-contour-administrator
    rows = await session.scalars(
        select(JournalRecord)
        .where(*utc_conditions(JournalRecord.created_at, period))
        .order_by(
            JournalRecord.created_at.desc(), JournalRecord.admin_journal_entry_id.desc()
        )
    )
    return AdminJournalList(
        items=[
            AdminJournalEntry(
                id=row.admin_journal_entry_id,
                at=row.created_at,
                action=AdminAction(row.action),
                object_type=AdminJournalObjectType(row.object_type),
                object_id=row.object_id,
                params=row.params,
                before=row.before,
                after=row.after,
            )
            for row in rows
        ]
    )
