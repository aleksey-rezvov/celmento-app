from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import ErrorCode


async def lock_account(
    session: AsyncSession, account_id: UUID, *, no_key_update: bool = False
) -> Account:
    account = await session.scalar(
        select(Account)
        .where(Account.account_id == account_id)
        .with_for_update(key_share=no_key_update)
        .execution_options(populate_existing=True)
    )
    if account is None:
        raise AppError(401, ErrorCode.UNAUTHORIZED)
    return account


def account_date(account: Account) -> date:
    return datetime.now(ZoneInfo(account.time_zone)).date()
