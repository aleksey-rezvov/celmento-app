from collections.abc import Mapping
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.enums import ErrorCode, NoticeKey, NoticeTab
from celmento_api.models.notice import Notice
from celmento_api.schemas.notices import Notice as NoticeView
from celmento_api.schemas.notices import NoticeList


async def raise_notice(
    session: AsyncSession,
    account_id: UUID,
    tab: NoticeTab,
    key: NoticeKey,
    params: Mapping[str, str],
) -> Notice:
    # spec:impl in-app-notice-bar#store-bars-account-undismissed-bar
    notice = Notice(
        account_id=account_id, tab=tab.value, key=key.value, params=dict(params)
    )
    session.add(notice)
    await session.flush()
    return notice


async def list_notices(session: AsyncSession, account_id: UUID) -> NoticeList:
    # spec:impl in-app-notice-bar#stack-several-bars-tab-newest
    # spec:impl in-app-notice-bar#show-bar-account-other-one
    notices = await session.scalars(
        select(Notice)
        .where(Notice.account_id == account_id, Notice.dismissed_at.is_(None))
        .order_by(Notice.created_at.desc(), Notice.notice_id.desc())
    )
    return NoticeList(
        items=[
            NoticeView(
                id=notice.notice_id,
                tab=NoticeTab(notice.tab),
                key=NoticeKey(notice.key),
                params=notice.params,
                created_at=notice.created_at,
            )
            for notice in notices
        ]
    )


async def dismiss_notice(
    session: AsyncSession, account_id: UUID, notice_id: UUID
) -> None:
    # spec:impl in-app-notice-bar#keep-bar-until-account-dismisses
    dismissed = await session.scalar(
        update(Notice)
        .where(
            Notice.account_id == account_id,
            Notice.notice_id == notice_id,
            Notice.dismissed_at.is_(None),
        )
        .values(dismissed_at=func.now())
        .returning(Notice.notice_id)
    )
    if dismissed is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
