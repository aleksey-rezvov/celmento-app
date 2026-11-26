from pydantic import AwareDatetime, BaseModel

from celmento_api.models.enums import (
    Currency,
    PriceLevel,
    SubscriptionRequestSource,
    SubscriptionTerm,
)
from celmento_api.schemas.account import PlanStatus
from celmento_api.schemas.money import Money


class PlanPrice(BaseModel):
    term: SubscriptionTerm
    price: Money


class PlanPrices(BaseModel):
    level: PriceLevel
    items: list[PlanPrice]


class SubscriptionRequestCreate(BaseModel, extra="forbid"):
    term: SubscriptionTerm
    source: SubscriptionRequestSource


class SubscriptionRequest(BaseModel):
    term: SubscriptionTerm
    level: PriceLevel
    currency: Currency
    source: SubscriptionRequestSource
    created_at: AwareDatetime


class PlansOverview(BaseModel):
    prices: PlanPrices
    plan: PlanStatus
    request: SubscriptionRequest | None
