from datetime import UTC, date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Query, Request, Response

from celmento_api.auth import Database, SignedInAccount
from celmento_api.errors import error_responses, invalid_request_value
from celmento_api.models.enums import ClientCardStatus, Language
from celmento_api.routers.calendar_response import (
    CALENDAR_RESPONSES,
    CalendarResponse,
    calendar_response,
)
from celmento_api.schemas.account import TimeZone
from celmento_api.schemas.clients import IdempotencyKey
from celmento_api.schemas.meetings import AttendedMeeting
from celmento_api.schemas.public import BookingCalendarEvent, BookingSlotList
from celmento_api.schemas.specialists import (
    AppBookingCreate,
    SpecialistCard,
    SpecialistList,
)
from celmento_api.services.app_bookings import create_app_booking
from celmento_api.services.attended import (
    attended_record,
    attended_view,
    linked_specialist,
    lock_linked_card,
    require_current_link,
    specialist_card_for,
    specialists_for,
)
from celmento_api.services.bookings import BookingUnavailable, lock_booking_accounts
from celmento_api.services.links import unlink
from celmento_api.services.public_pages import main_contact
from celmento_api.services.slots import free_slots
from celmento_api.storage import media_origin

router: APIRouter = APIRouter(tags=["specialists"])


@router.get(
    "/specialists",
    operation_id="listSpecialists",
    summary="List the leaders the account attends",
    response_model=SpecialistList,
    responses=error_responses(401, 500),
)
async def get_specialists(
    request: Request, account: SignedInAccount, session: Database
) -> SpecialistList:
    return await specialists_for(
        session, account.account_id, media_origin(request), datetime.now(UTC)
    )


@router.get(
    "/specialists/{specialist_id}",
    operation_id="getSpecialist",
    summary="Show a leader's card for the attendee",
    response_model=SpecialistCard,
    responses=error_responses(401, 404, 422, 500),
)
async def get_specialist(
    request: Request, specialist_id: UUID, account: SignedInAccount, session: Database
) -> SpecialistCard:
    return await specialist_card_for(
        session, account, specialist_id, media_origin(request), datetime.now(UTC)
    )


@router.delete(
    "/specialists/{specialist_id}/link",
    operation_id="unlinkSpecialist",
    summary="Break the link to a leader from the attendee's side",
    status_code=204,
    response_class=Response,
    responses=error_responses(401, 404, 422, 500),
)
async def delete_specialist_link(
    specialist_id: UUID, account: SignedInAccount, session: Database
) -> Response:
    attendee_id = account.account_id
    await require_current_link(session, attendee_id, specialist_id)
    await lock_booking_accounts(session, specialist_id, attendee_id)
    card = await lock_linked_card(session, attendee_id, specialist_id)
    # spec:impl client-card-profile-link#break-link-attendee-taps-unlink
    # spec:impl client-card-profile-link#keep-card-meetings-balance-payments
    # spec:impl attended-meetings#remove-attended-meeting-leader-account
    await unlink(session, card, by_client=True)
    await session.commit()
    return Response(status_code=204)


@router.get(
    "/specialists/{specialist_id}/slots",
    operation_id="listSpecialistSlots",
    summary="List a specialist's free slots for an in-app booking",
    response_model=BookingSlotList,
    responses=error_responses(401, 404, 409, 422, 500),
)
async def get_specialist_slots(
    response: Response,
    specialist_id: UUID,
    from_: Annotated[date, Query(alias="from")],
    to: Annotated[date, Query()],
    account: SignedInAccount,
    session: Database,
    time_zone: Annotated[TimeZone | None, Query()] = None,
) -> BookingSlotList:
    if from_ > to:
        raise invalid_request_value("query", "to")
    card, leader, profile = await linked_specialist(
        session, account.account_id, specialist_id
    )
    if card.status == ClientCardStatus.ARCHIVED.value:
        raise BookingUnavailable(main_contact(leader, profile)).error()
    response.headers["Cache-Control"] = "no-store"
    return await free_slots(
        session, leader, from_, to, time_zone or account.time_zone, datetime.now(UTC)
    )


@router.post(
    "/bookings",
    operation_id="createAppBooking",
    summary="Book a session with a linked leader from the app",
    status_code=201,
    response_model=AttendedMeeting,
    responses=error_responses(401, 404, 409, 422, 500),
)
async def post_booking(
    request: Request,
    body: Annotated[AppBookingCreate, Body()],
    account: SignedInAccount,
    session: Database,
    idempotency_key: IdempotencyKey = None,
) -> AttendedMeeting:
    booking = await create_app_booking(
        session, account, body, idempotency_key, media_origin(request)
    )
    await session.commit()
    # spec:impl client-app-booking#show-screen-9-4-notify-leader
    if isinstance(booking, BookingUnavailable):
        raise booking.error()
    return booking


@router.get(
    "/attended-meetings/{meeting_id}",
    operation_id="getAttendedMeeting",
    summary="Show the details of an attended meeting",
    response_model=AttendedMeeting,
    responses=error_responses(401, 404, 422, 500),
)
async def get_attended_meeting(
    request: Request, meeting_id: UUID, account: SignedInAccount, session: Database
) -> AttendedMeeting:
    meeting, leader, profile = await attended_record(
        session, account.account_id, meeting_id
    )
    return attended_view(meeting, leader, profile, media_origin(request))


@router.get(
    "/attended-meetings/{meeting_id}/calendar.ics",
    operation_id="getAttendedMeetingCalendar",
    summary="Download the device calendar event of an attended meeting",
    response_class=CalendarResponse,
    response_model=BookingCalendarEvent,
    responses=CALENDAR_RESPONSES | error_responses(401),
)
async def get_attended_calendar(
    meeting_id: UUID, account: SignedInAccount, session: Database
) -> CalendarResponse:
    meeting, leader, _ = await attended_record(session, account.account_id, meeting_id)
    return calendar_response(meeting, leader, Language(account.language))
