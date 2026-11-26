from datetime import date
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, RootModel, StringConstraints

from celmento_api.models.enums import (
    ContactChannel,
    Language,
    MeetingPlace,
    SessionFormat,
    Specialization,
)
from celmento_api.schemas.account import (
    Email,
    SessionDuration,
    TextInput,
    TimeZone,
    Uri,
)
from celmento_api.schemas.auth import EmailInput
from celmento_api.schemas.clients import ClientName
from celmento_api.schemas.documents import ConsentAcceptance
from celmento_api.schemas.meetings import DurationMinutes, MeetingInstant
from celmento_api.schemas.money import Money

BookingContext = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class MainContact(BaseModel):
    channel: ContactChannel
    value: str = Field(repr=False)


class PublicSpecialistPage(BaseModel):
    login: str
    booking_context: BookingContext
    first_name: str
    last_name: str
    photo_url: Uri | None
    specializations: list[Specialization]
    specialization_other: str | None
    about: Annotated[str, Field(max_length=1000)]
    price: Money | None
    session_duration_minutes: SessionDuration
    session_format: SessionFormat
    main_contact: MainContact | None


class Slot(BaseModel):
    starts_at: AwareDatetime
    duration_minutes: DurationMinutes


class BookingSlotList(BaseModel):
    items: list[Slot]
    next_free_date: date | None
    has_available_slots: bool


class GuestBookingCreate(BaseModel, extra="forbid"):
    login: str
    booking_context: BookingContext
    starts_at: MeetingInstant
    name: ClientName = Field(repr=False)
    email: EmailInput
    contact: TextInput | None = Field(default=None, repr=False)
    comment: TextInput | None = Field(default=None, repr=False)
    place: MeetingPlace | None = None
    expected_session_format: SessionFormat | None = None
    consents: Annotated[
        list[ConsentAcceptance], Field(json_schema_extra={"minItems": 2})
    ]
    language: Language
    time_zone: TimeZone


class GuestBookingConfirmation(BaseModel):
    id: UUID
    specialist_name: str
    starts_at: AwareDatetime
    place: MeetingPlace
    meeting_link: Uri | None
    email: Email = Field(repr=False)


class BookingCalendarEvent(
    RootModel[
        Annotated[str, Field(json_schema_extra={"contentMediaType": "text/calendar"})]
    ]
):
    pass


class MeetingInvitePage(BaseModel):
    specialist_first_name: str
    specialist_last_name: str
    photo_url: Uri | None
    specializations: list[Specialization]
    specialization_other: str | None
    starts_at: AwareDatetime
    duration_minutes: DurationMinutes
    place: MeetingPlace
    meeting_link: Uri | None
    address: str | None = Field(repr=False)
