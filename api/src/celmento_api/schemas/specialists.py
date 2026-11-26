from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field

from celmento_api.models.enums import MeetingPlace, PaymentType, SessionFormat
from celmento_api.schemas.account import TextInput
from celmento_api.schemas.meetings import AttendedMeeting, MeetingInstant, SpecialistRef
from celmento_api.schemas.money import Money
from celmento_api.schemas.notes import Note
from celmento_api.schemas.public import MainContact


class SpecialistListItem(BaseModel):
    specialist: SpecialistRef
    next_booking_at: AwareDatetime | None


class SpecialistList(BaseModel):
    items: list[SpecialistListItem]


class SpecialistCard(BaseModel):
    specialist: SpecialistRef
    about: Annotated[str, Field(max_length=1000)]
    session_format: SessionFormat
    main_contact: MainContact | None
    price_for_me: Money | None
    payment_type: PaymentType
    booking_available: bool
    upcoming_meetings: list[AttendedMeeting]
    past_meetings: list[AttendedMeeting]
    shared_notes: Annotated[list[Note], Field(max_length=3)]


class AppBookingCreate(BaseModel, extra="forbid"):
    specialist_id: UUID
    starts_at: MeetingInstant | None = None
    place: MeetingPlace | None = None
    expected_session_format: SessionFormat | None = None
    comment: TextInput | None = Field(default=None, repr=False)
