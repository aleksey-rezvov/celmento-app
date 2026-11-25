from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.models.account import Account
from celmento_api.schemas.account import PlanKind, PlanStatus
from celmento_api.services.account_access import account_date
from celmento_api.services.limit import (
    FREE_PLAN_LIMIT,
    active_card_count,
    subscription_until,
)


async def plan_status(session: AsyncSession, account: Account) -> PlanStatus:
    until = await subscription_until(session, account.account_id, account_date(account))
    return PlanStatus(
        kind=PlanKind.SUBSCRIPTION if until is not None else PlanKind.FREE,
        active_clients=await active_card_count(session, account.account_id),
        client_limit=None if until is not None else FREE_PLAN_LIMIT,
        subscription_until=until,
    )
