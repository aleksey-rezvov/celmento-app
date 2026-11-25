from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.models.account import Account
from celmento_api.models.enums import NoticeKey, NoticeTab
from celmento_api.services.notices import raise_notice


async def notify_inviter(
    session: AsyncSession, account: Account, inviter_id: UUID | None, opted_in: bool
) -> None:
    # spec:impl meeting-invite-page#notify-leader-notify-specialist
    if not opted_in or inviter_id is None:
        return
    # spec:impl meeting-invite-page#notify-leader-bar-invite-registered
    await raise_notice(
        session,
        inviter_id,
        NoticeTab.PEOPLE,
        NoticeKey.INVITE_REGISTERED,
        {"name": f"{account.first_name} {account.last_name}", "login": account.login},
    )
