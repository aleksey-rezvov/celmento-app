from fastapi import Response

from celmento_api.errors import error_responses
from celmento_api.models.account import Account
from celmento_api.models.enums import Language
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.public import BookingCalendarEvent
from celmento_api.services.ics import calendar_event


class CalendarResponse(Response):
    media_type: str | None = "text/calendar"


CALENDAR_RESPONSES: dict[int | str, dict[str, object]] = {
    200: {"model": BookingCalendarEvent},
    **error_responses(404, 422, 500),
}


def calendar_response(
    meeting: Meeting, leader: Account, language: Language
) -> CalendarResponse:
    return CalendarResponse(
        calendar_event(meeting, leader, language),
        headers={
            "Content-Disposition": 'attachment; filename="celmento.ics"',
            "Cache-Control": "no-store",
        },
    )
