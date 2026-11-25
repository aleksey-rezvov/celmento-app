from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.models.account import Account
from celmento_api.schemas.account import PlanKind, PlanStatus

FREE_CLIENT_LIMIT: int = 3


async def plan_status(_session: AsyncSession, _account: Account) -> PlanStatus:
    return PlanStatus(
        kind=PlanKind.FREE,
        active_clients=0,
        client_limit=FREE_CLIENT_LIMIT,
        subscription_until=None,
    )
