from datetime import date
from typing import Final
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import ClientCardStatus, ErrorCode
from celmento_api.models.subscription import Subscription
from celmento_api.services.account_access import account_date, lock_account

FREE_PLAN_LIMIT: Final[int] = 3


async def active_card_count(session: AsyncSession, leader_id: UUID) -> int:
    # spec:impl free-plan-client-limit#count-limit-active-client-card
    # spec:impl free-plan-client-limit#count-archived-cards-limit
    count = await session.scalar(
        select(func.count())
        .select_from(ClientCard)
        .where(
            ClientCard.leader_account_id == leader_id,
            ClientCard.status == ClientCardStatus.ACTIVE.value,
        )
    )
    return count or 0


async def subscription_until(
    session: AsyncSession, account_id: UUID, today: date
) -> date | None:
    return await session.scalar(
        select(Subscription.until).where(
            Subscription.account_id == account_id, Subscription.until >= today
        )
    )


async def ensure_card_can_become_active(session: AsyncSession, leader: Account) -> None:
    # Keep the lock through the caller's card write and transaction commit.
    locked = await lock_account(session, leader.account_id, no_key_update=True)
    if locked.activated_at is None:
        raise AppError(403, ErrorCode.ACTIVATION_REQUIRED)
    # spec:impl free-plan-client-limit#lift-limit-entirely-account-active
    if (
        await subscription_until(session, locked.account_id, account_date(locked))
        is not None
    ):
        return
    if await active_card_count(session, locked.account_id) >= FREE_PLAN_LIMIT:
        raise AppError(409, ErrorCode.CLIENT_LIMIT_REACHED)
