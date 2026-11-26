from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Body, Query, Request, Response

from celmento_api.auth import Database
from celmento_api.errors import AppError, error_responses, invalid_request_value
from celmento_api.models.account import Account
from celmento_api.models.enums import ErrorCode, Language
from celmento_api.models.meeting import Meeting
from celmento_api.routers.calendar_response import (
    CALENDAR_RESPONSES,
    CalendarResponse,
    calendar_response,
)
from celmento_api.schemas.account import TimeZone
from celmento_api.schemas.auth import SignInCodeRequest, SignInCodeRequestResult
from celmento_api.schemas.clients import IdempotencyKey
from celmento_api.schemas.public import (
    BookingCalendarEvent,
    BookingSlotList,
    GuestBookingConfirmation,
    GuestBookingCreate,
    MeetingInvitePage,
    PublicSpecialistPage,
)
from celmento_api.services.bookings import BookingUnavailable, create_guest_booking
from celmento_api.services.public_pages import (
    guest_booking,
    invite_page,
    invited_meeting,
    public_leader,
    specialist_page,
)
from celmento_api.services.sign_in_codes import request_sign_in_code
from celmento_api.services.slots import free_slots
from celmento_api.storage import media_origin

router: APIRouter = APIRouter(prefix="/public", tags=["public"])


async def _require_invite(
    session: Database, login: str, meeting_id: UUID
) -> tuple[Account, Meeting]:
    result = await invited_meeting(session, login, meeting_id)
    if result is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return result


@router.get(
    "/specialists/{login}",
    operation_id="getPublicSpecialistPage",
    summary="Show a specialist's public booking page",
    response_model=PublicSpecialistPage,
    responses=error_responses(404, 422, 500),
)
async def get_specialist_page(
    request: Request, response: Response, login: str, session: Database
) -> PublicSpecialistPage:
    leader = await public_leader(session, login)
    response.headers["Cache-Control"] = "no-store"
    return await specialist_page(session, leader, media_origin(request))


@router.get(
    "/specialists/{login}/slots",
    operation_id="listPublicSpecialistSlots",
    summary="List the free booking slots of a specialist for a date range",
    response_model=BookingSlotList,
    responses=error_responses(404, 422, 500),
)
async def get_slots(
    response: Response,
    login: str,
    from_: Annotated[date, Query(alias="from")],
    to: Annotated[date, Query()],
    time_zone: Annotated[TimeZone, Query()],
    session: Database,
) -> BookingSlotList:
    if from_ > to:
        raise invalid_request_value("query", "to")
    leader = await public_leader(session, login)
    response.headers["Cache-Control"] = "no-store"
    return await free_slots(session, leader, from_, to, time_zone, datetime.now(UTC))


@router.post(
    "/bookings",
    operation_id="createGuestBooking",
    summary="Book a session as a guest from the public page",
    status_code=201,
    response_model=GuestBookingConfirmation,
    responses=error_responses(400, 404, 409, 422, 500),
)
async def post_guest_booking(
    body: Annotated[GuestBookingCreate, Body()],
    background_tasks: BackgroundTasks,
    session: Database,
    idempotency_key: IdempotencyKey = None,
) -> GuestBookingConfirmation:
    booked = await create_guest_booking(session, body, idempotency_key)
    await session.commit()
    # spec:impl guest-booking-flow#create-meeting-card-set-link
    if isinstance(booked, BookingUnavailable):
        raise booked.error()
    # spec:impl transactional-email#hand-email-delivery-immediately-after
    if booked.email is not None:
        background_tasks.add_task(booked.email.send)
    return booked.booking


@router.get(
    "/bookings/{booking_id}/calendar.ics",
    operation_id="getGuestBookingCalendar",
    summary="Download the device calendar event of a guest booking",
    response_class=CalendarResponse,
    response_model=BookingCalendarEvent,
    responses=CALENDAR_RESPONSES,
)
async def get_booking_calendar(booking_id: UUID, session: Database) -> CalendarResponse:
    booking = await guest_booking(session, booking_id)
    if booking is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    leader, meeting = booking
    if meeting.guest_language is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return calendar_response(meeting, leader, Language(meeting.guest_language))


@router.get(
    "/specialists/{login}/meet/{meeting_id}",
    operation_id="getMeetingInvitePage",
    summary="Show the meeting invite page",
    response_model=MeetingInvitePage,
    responses=error_responses(404, 422, 500),
)
async def get_invite_page(
    request: Request,
    response: Response,
    login: str,
    meeting_id: UUID,
    session: Database,
) -> MeetingInvitePage:
    # spec:impl meeting-invite-page#write-anything-database-page-opened
    leader, meeting = await _require_invite(session, login, meeting_id)
    response.headers["Cache-Control"] = "no-store"
    return await invite_page(session, leader, meeting, media_origin(request))


@router.get(
    "/specialists/{login}/meet/{meeting_id}/calendar.ics",
    operation_id="getMeetingInviteCalendar",
    summary="Download the device calendar event of an invited meeting",
    response_class=CalendarResponse,
    response_model=BookingCalendarEvent,
    responses=CALENDAR_RESPONSES,
)
async def get_invite_calendar(
    login: str,
    meeting_id: UUID,
    language: Annotated[Language, Query()],
    session: Database,
) -> CalendarResponse:
    leader, meeting = await _require_invite(session, login, meeting_id)
    return calendar_response(meeting, leader, language)


@router.post(
    "/specialists/{login}/meet/{meeting_id}/join",
    operation_id="joinMeetingInvite",
    summary="Start sign-in or registration from the meeting invite page",
    response_model=SignInCodeRequestResult,
    responses=error_responses(400, 404, 422, 429, 500),
)
async def post_invite_join(
    login: str,
    meeting_id: UUID,
    body: Annotated[SignInCodeRequest, Body()],
    session: Database,
) -> SignInCodeRequestResult:
    await _require_invite(session, login, meeting_id)
    return await request_sign_in_code(session, body)
