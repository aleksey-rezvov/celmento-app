from datetime import date
from typing import Annotated

from fastapi import APIRouter, Body, Depends, Query, Request, Response

from celmento_api.auth import Database, LeaderAccount
from celmento_api.errors import error_responses, invalid_request_value
from celmento_api.models.enums import (
    RecordsHoursExportFormat,
    RecordsHoursLogType,
    RecordsOperationFilter,
    RecordsPeriodKind,
)
from celmento_api.schemas.records import (
    RecordsBalanceList,
    RecordsHoursGoal,
    RecordsHoursGoalResult,
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
from celmento_api.services.records_export import hours_export_csv
from celmento_api.services.records_goals import (
    read_hours_goal,
    remove_hours_goal,
    save_hours_goal,
)
from celmento_api.storage import media_origin

router: APIRouter = APIRouter(prefix="/records", tags=["records"])


class HoursExportResponse(Response):
    media_type: str | None = "text/csv"


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


# spec:impl records-hours-export#leader-only
@router.get(
    "/hours/export",
    operation_id="exportRecordsHours",
    summary="Export one hours log as a certification spreadsheet",
    response_class=HoursExportResponse,
    response_model=None,
    responses={
        200: {
            "content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}},
            "headers": {
                "Content-Disposition": {"schema": {"type": "string"}},
                "Cache-Control": {"schema": {"type": "string"}},
            },
        },
        **error_responses(401, 403, 422, 500),
    },
)
async def export_hours(
    leader: LeaderAccount,
    session: Database,
    selection: PeriodSelection,
    log: Annotated[RecordsHoursLogType, Query(alias="type")],
    export_format: Annotated[RecordsHoursExportFormat, Query(alias="format")],
) -> HoursExportResponse:
    if (
        export_format == RecordsHoursExportFormat.ICF
        and log != RecordsHoursLogType.PRACTICE
    ):
        raise invalid_request_value("query", "format")

    period, _ = selection
    content = await hours_export_csv(session, leader, period, log, export_format)
    period_name = f"{period.from_}_{period.to}" if period.from_ and period.to else "all"
    # spec:impl records-hours-export#file-name
    return HoursExportResponse(
        content,
        headers={
            "Content-Disposition": f'attachment; filename="celmento_{log.value}_{period_name}.csv"',
            "Cache-Control": "private, no-store",
        },
    )


# spec:impl records-hours-goal#leader-goal-per-log
@router.get(
    "/hours/goal",
    operation_id="getRecordsHoursGoal",
    summary="Read the specialist's hours goal for one log",
    response_model=RecordsHoursGoalResult,
    responses=error_responses(401, 403, 422, 500),
)
async def get_hours_goal(
    leader: LeaderAccount,
    session: Database,
    log: Annotated[RecordsHoursLogType, Query(alias="type")],
) -> RecordsHoursGoalResult:
    goal = await read_hours_goal(session, leader.account_id, log)
    return RecordsHoursGoalResult(goal=goal)


# spec:impl records-hours-goal#validate-change
@router.put(
    "/hours/goal",
    operation_id="putRecordsHoursGoal",
    summary="Set or change the specialist's hours goal for one log",
    response_model=RecordsHoursGoalResult,
    responses=error_responses(401, 403, 422, 500),
)
async def put_hours_goal(
    leader: LeaderAccount,
    session: Database,
    log: Annotated[RecordsHoursLogType, Query(alias="type")],
    body: Annotated[RecordsHoursGoal, Body()],
) -> RecordsHoursGoalResult:
    goal = await save_hours_goal(session, leader.account_id, log, body)
    await session.commit()
    return RecordsHoursGoalResult(goal=goal)


@router.delete(
    "/hours/goal",
    operation_id="deleteRecordsHoursGoal",
    summary="Remove the specialist's hours goal for one log",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(401, 403, 422, 500),
)
async def delete_hours_goal(
    leader: LeaderAccount,
    session: Database,
    log: Annotated[RecordsHoursLogType, Query(alias="type")],
) -> Response:
    await remove_hours_goal(session, leader.account_id, log)
    await session.commit()
    return Response(status_code=204)


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
