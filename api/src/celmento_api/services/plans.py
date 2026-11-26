from collections.abc import Mapping
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import (
    Contour,
    Currency,
    ErrorCode,
    PriceLevel,
    SubscriptionRequestSource,
    SubscriptionTerm,
)
from celmento_api.models.plan import StatsEvent, StatsEventKind
from celmento_api.models.plan import SubscriptionRequest as SubscriptionRequestRecord
from celmento_api.schemas.account import PlanKind, PlanStatus
from celmento_api.schemas.money import Money
from celmento_api.schemas.plans import (
    PlanPrice,
    PlanPrices,
    PlansOverview,
    SubscriptionRequest,
    SubscriptionRequestCreate,
)
from celmento_api.services.account_access import lock_account
from celmento_api.services.limit import client_limit_reached
from celmento_api.services.plan_status import plan_status


def _base_prices(currency: Currency, monthly: str, yearly: str) -> PlanPrices:
    return PlanPrices(
        level=PriceLevel.BASE,
        items=[
            PlanPrice(
                term=SubscriptionTerm.MONTH,
                price=Money(amount=monthly, currency=currency),
            ),
            PlanPrice(
                term=SubscriptionTerm.YEAR,
                price=Money(amount=yearly, currency=currency),
            ),
        ],
    )


BASE_PRICES: Final[Mapping[Contour, PlanPrices]] = {
    Contour.RU: _base_prices(Currency.RUB, "790", "6300"),
    Contour.WORLD: _base_prices(Currency.EUR, "8.90", "71"),
}


def _request_view(row: SubscriptionRequestRecord) -> SubscriptionRequest:
    return SubscriptionRequest(
        term=SubscriptionTerm(row.term),
        level=PriceLevel(row.level),
        currency=Currency(row.currency),
        source=SubscriptionRequestSource(row.source),
        created_at=row.created_at,
    )


async def stored_subscription_request(
    session: AsyncSession, account_id: UUID
) -> SubscriptionRequestRecord | None:
    return await session.scalar(
        select(SubscriptionRequestRecord).where(
            SubscriptionRequestRecord.account_id == account_id
        )
    )


async def plans_for(session: AsyncSession, leader: Account) -> PlansOverview:
    request = await stored_subscription_request(session, leader.account_id)
    # spec:impl subscription-plans-request#price-subscription-base-level-790-month
    # spec:impl subscription-plans-request#choose-price-currency-account-contour
    # spec:impl subscription-plans-request#show-prices-dollars-currency-other
    # spec:impl subscription-plans-request#tie-subscription-currency-device-country
    prices = BASE_PRICES[current_contour()]
    plan = await plan_status(session, leader)
    session.add(
        StatsEvent(account_id=leader.account_id, kind=StatsEventKind.PLANS_OPENED.value)
    )
    return PlansOverview(
        prices=prices,
        plan=plan,
        request=_request_view(request) if request is not None else None,
    )


async def create_request(
    session: AsyncSession, leader: Account, body: SubscriptionRequestCreate
) -> SubscriptionRequest:
    prices = BASE_PRICES[current_contour()]
    price = next(item.price for item in prices.items if item.term == body.term)
    # spec:impl subscription-plans-request#store-request-account-contour-account
    # spec:impl subscription-plans-request#take-payment-show-payment-form
    # spec:impl subscription-plans-request#extend-request-subscription-account
    request = await session.scalar(
        insert(SubscriptionRequestRecord)
        .values(
            account_id=leader.account_id,
            term=body.term.value,
            level=prices.level.value,
            currency=price.currency.value,
            source=body.source.value,
        )
        .on_conflict_do_nothing(index_elements=[SubscriptionRequestRecord.account_id])
        .returning(SubscriptionRequestRecord)
    )
    # spec:impl subscription-plans-request#replace-want-request-sent-showing
    if request is None:
        previous = await stored_subscription_request(session, leader.account_id)
        if previous is None:
            raise AppError(500, ErrorCode.INTERNAL_ERROR)
        raise AppError(
            409,
            ErrorCode.SUBSCRIPTION_REQUEST_EXISTS,
            {"request": _request_view(previous).model_dump(mode="json")},
        )
    return _request_view(request)


async def confirm_limit(session: AsyncSession, leader: Account) -> PlanStatus:
    locked = await lock_account(session, leader.account_id, no_key_update=True)
    plan = await plan_status(session, locked)
    if plan.kind == PlanKind.FREE and client_limit_reached(plan.active_clients):
        session.add(
            StatsEvent(
                account_id=locked.account_id, kind=StatsEventKind.LIMIT_HIT.value
            )
        )
    return plan
