from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from celmento_api.auth import Database, LeaderAccount
from celmento_api.errors import error_responses
from celmento_api.models.enums import (
    RecordsHoursLogType,
    RecordsOperationFilter,
    RecordsPeriodKind,
)
from celmento_api.schemas.records import (
    RecordsBalanceList,
    RecordsHoursLog,
    RecordsOperationList,
    RecordsPeriod,
    RecordsSummary,
)
from celmento_api.services.account_access import account_date
from celmento_api.services.records import (
    balances,
    hours_log,
    operations,
    resolve_period,
    summary,
)
from celmento_api.storage import media_origin

router: APIRouter = APIRouter(prefix="/records", tags=["records"])


def records_period(
    leader: LeaderAccount,
    period: Annotated[RecordsPeriodKind, Query()] = RecordsPeriodKind.ALL,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: Annotated[date | None, Query()] = None,
) -> tuple[RecordsPeriod, date]:
    today = account_date(leader)
    return resolve_period(period, from_, to, today), today


PeriodSelection = Annotated[tuple[RecordsPeriod, date], Depends(records_period)]


@router.get(
    "/summary",
    operation_id="getRecordsSummary",
    summary="Summarize hours, income, expenses and client balances for a period",
    response_model=RecordsSummary,
    responses=error_responses(401, 403, 422, 500),
)
async def get_summary(
    leader: LeaderAccount, session: Database, selection: PeriodSelection
) -> RecordsSummary:
    period, today = selection
    return await summary(session, leader, period, today)


@router.get(
    "/operations",
    operation_id="listRecordsOperations",
    summary="List the period's money operations behind the summary figures",
    response_model=RecordsOperationList,
    responses=error_responses(401, 403, 422, 500),
)
async def get_operations(
    request: Request,
    leader: LeaderAccount,
    session: Database,
    selection: PeriodSelection,
    kind: Annotated[RecordsOperationFilter, Query()] = RecordsOperationFilter.ALL,
) -> RecordsOperationList:
    period, _ = selection
    return await operations(session, leader, period, kind, media_origin(request))


@router.get(
    "/hours",
    operation_id="getRecordsHoursLog",
    summary="Get one hours log with its totals, breakdown and the period's meetings",
    response_model=RecordsHoursLog,
    responses=error_responses(401, 403, 422, 500),
)
async def get_hours(
    request: Request,
    leader: LeaderAccount,
    session: Database,
    selection: PeriodSelection,
    log: Annotated[RecordsHoursLogType, Query(alias="type")],
) -> RecordsHoursLog:
    period, _ = selection
    return await hours_log(session, leader, period, log, media_origin(request))


@router.get(
    "/balances",
    operation_id="listRecordsBalances",
    summary="List the clients with a non-zero balance as of today",
    response_model=RecordsBalanceList,
    responses=error_responses(401, 403, 500),
)
async def get_balances(
    request: Request, leader: LeaderAccount, session: Database
) -> RecordsBalanceList:
    return await balances(session, leader, account_date(leader), media_origin(request))
