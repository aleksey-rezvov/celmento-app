from typing import Annotated

from fastapi import APIRouter, Body, Response

from celmento_api.auth import Database, LeaderAccount
from celmento_api.errors import error_responses
from celmento_api.schemas.account import PlanStatus
from celmento_api.schemas.plans import (
    PlansOverview,
    SubscriptionRequest,
    SubscriptionRequestCreate,
)
from celmento_api.services.plans import confirm_limit, create_request, plans_for

router: APIRouter = APIRouter(tags=["plans"])


@router.get(
    "/plans",
    operation_id="getPlans",
    summary="Get the plans screen data",
    response_model=PlansOverview,
    responses=error_responses(401, 403, 500),
)
async def get_plans(
    response: Response, leader: LeaderAccount, session: Database
) -> PlansOverview:
    result = await plans_for(session, leader)
    await session.commit()
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post(
    "/subscription-requests",
    operation_id="createSubscriptionRequest",
    summary="Send a subscription request from screen 10.2",
    status_code=201,
    response_model=SubscriptionRequest,
    responses=error_responses(401, 403, 409, 422, 500),
)
async def post_request(
    body: Annotated[SubscriptionRequestCreate, Body()],
    leader: LeaderAccount,
    session: Database,
) -> SubscriptionRequest:
    result = await create_request(session, leader, body)
    await session.commit()
    return result


@router.post(
    "/plans/limit-hits",
    operation_id="confirmClientLimit",
    summary="Confirm the current plan when the client limit screen opens",
    response_model=PlanStatus,
    responses=error_responses(401, 403, 500),
)
async def post_limit_hit(leader: LeaderAccount, session: Database) -> PlanStatus:
    plan = await confirm_limit(session, leader)
    await session.commit()
    return plan
