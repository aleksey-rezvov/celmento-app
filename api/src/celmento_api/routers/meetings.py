from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Body, Query, Request, Response

from celmento_api.auth import Database, LeaderAccount, SignedInAccount
from celmento_api.errors import error_responses, invalid_request_value
from celmento_api.schemas.account import TextInput
from celmento_api.schemas.clients import IdempotencyKey
from celmento_api.schemas.meetings import (
    MeetingCalendarMonth,
    MeetingCreate,
    MeetingDefaults,
    MeetingDetail,
    MeetingList,
    MeetingOutcomeInput,
    MeetingPendingOutcomeList,
    MeetingUpdate,
    MonthName,
)
from celmento_api.services.account_access import lock_account
from celmento_api.services.meeting_views import (
    list_meetings,
    list_pending_outcomes,
    meeting_detail,
)
from celmento_api.services.meetings import (
    create_meeting,
    meeting_client,
    owned_meeting,
    update_meeting,
)
from celmento_api.services.outcomes import delete_meeting, record_outcome
from celmento_api.services.schedule import calendar_days, date_bounds, meeting_defaults
from celmento_api.storage import media_origin

router: APIRouter = APIRouter(prefix="/meetings", tags=["meetings"])


@router.get(
    "",
    operation_id="listMeetings",
    summary="List the meetings of a date range",
    response_model=MeetingList,
    responses=error_responses(401, 422, 500),
)
async def get_meetings(
    request: Request,
    from_: Annotated[date, Query(alias="from")],
    to: Annotated[date, Query()],
    account: SignedInAccount,
    session: Database,
) -> MeetingList:
    if from_ > to:
        raise invalid_request_value("query", "to")
    lower, upper = date_bounds(from_, to, ZoneInfo(account.time_zone))
    return await list_meetings(
        session, account, lower, upper, media_origin(request), datetime.now(UTC)
    )


@router.post(
    "",
    operation_id="createMeeting",
    summary="Create a meeting",
    status_code=201,
    response_model=MeetingDetail,
    responses=error_responses(400, 401, 403, 404, 409, 422, 500),
)
async def post_meeting(
    request: Request,
    body: Annotated[MeetingCreate, Body()],
    leader: LeaderAccount,
    session: Database,
    idempotency_key: IdempotencyKey = None,
) -> MeetingDetail:
    origin = media_origin(request)
    meeting = await create_meeting(session, leader, body, origin, idempotency_key)
    result = await meeting_detail(session, meeting, leader, origin, datetime.now(UTC))
    await session.commit()
    return result


@router.get(
    "/calendar",
    operation_id="getMeetingCalendar",
    summary="List the days with meetings in a month",
    response_model=MeetingCalendarMonth,
    responses=error_responses(401, 422, 500),
)
async def meeting_calendar(
    month: Annotated[MonthName, Query()], account: SignedInAccount, session: Database
) -> MeetingCalendarMonth:
    # spec:impl schedule-date-navigation#show-meetings-details-inside-mini
    return MeetingCalendarMonth(
        month=month, days=await calendar_days(session, account, month)
    )


@router.get(
    "/defaults",
    operation_id="getMeetingDefaults",
    summary="Get prefilled values for a new meeting",
    response_model=MeetingDefaults,
    responses=error_responses(401, 403, 422, 500),
)
async def get_defaults(
    day: Annotated[date, Query(alias="date")],
    leader: LeaderAccount,
    session: Database,
    with_whom: Annotated[TextInput | None, Query()] = None,
) -> MeetingDefaults:
    return await meeting_defaults(session, leader, day, with_whom, datetime.now(UTC))


@router.get(
    "/pending-outcomes",
    operation_id="listPendingOutcomes",
    summary="List meetings awaiting an outcome",
    response_model=MeetingPendingOutcomeList,
    responses=error_responses(401, 403, 500),
)
async def pending_outcomes(
    request: Request, leader: LeaderAccount, session: Database
) -> MeetingPendingOutcomeList:
    return await list_pending_outcomes(
        session, leader, media_origin(request), datetime.now(UTC)
    )


@router.get(
    "/{meeting_id}",
    operation_id="getMeeting",
    summary="Get one meeting with its card details",
    response_model=MeetingDetail,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def get_meeting(
    request: Request, meeting_id: UUID, leader: LeaderAccount, session: Database
) -> MeetingDetail:
    meeting = await owned_meeting(session, leader.account_id, meeting_id, lock=True)
    return await meeting_detail(
        session, meeting, leader, media_origin(request), datetime.now(UTC)
    )


@router.patch(
    "/{meeting_id}",
    operation_id="updateMeeting",
    summary="Edit a meeting",
    response_model=MeetingDetail,
    responses=error_responses(400, 401, 403, 404, 409, 422, 500),
)
async def patch_meeting(
    request: Request,
    meeting_id: UUID,
    body: Annotated[MeetingUpdate, Body()],
    leader: LeaderAccount,
    session: Database,
) -> MeetingDetail:
    origin = media_origin(request)
    meeting = await update_meeting(session, leader, meeting_id, body.root, origin)
    result = await meeting_detail(session, meeting, leader, origin, datetime.now(UTC))
    await session.commit()
    return result


@router.delete(
    "/{meeting_id}",
    operation_id="deleteMeeting",
    summary="Cancel or delete a meeting",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(400, 401, 403, 404, 422, 500),
)
async def remove_meeting(
    meeting_id: UUID,
    leader: LeaderAccount,
    session: Database,
    refund: Annotated[bool | None, Query()] = None,
) -> Response:
    leader = await lock_account(session, leader.account_id, no_key_update=True)
    meeting = await owned_meeting(session, leader.account_id, meeting_id, lock=True)
    card = await meeting_client(session, leader, meeting)
    await delete_meeting(session, leader, meeting, card, refund)
    await session.commit()
    return Response(status_code=204)


@router.put(
    "/{meeting_id}/outcome",
    operation_id="recordMeetingOutcome",
    summary="Record or change a meeting outcome",
    response_model=MeetingDetail,
    responses=error_responses(400, 401, 403, 404, 409, 422, 500),
)
async def put_outcome(
    request: Request,
    meeting_id: UUID,
    body: Annotated[MeetingOutcomeInput, Body()],
    leader: LeaderAccount,
    session: Database,
) -> MeetingDetail:
    leader = await lock_account(session, leader.account_id, no_key_update=True)
    meeting = await owned_meeting(session, leader.account_id, meeting_id, lock=True)
    card = await meeting_client(session, leader, meeting)
    now = datetime.now(UTC)
    await record_outcome(session, leader, meeting, card, body.root, now)
    result = await meeting_detail(session, meeting, leader, media_origin(request), now)
    await session.commit()
    return result
