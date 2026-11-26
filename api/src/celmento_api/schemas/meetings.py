from datetime import date, datetime
from typing import Annotated, Required, TypedDict
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    Field,
    RootModel,
    StrictBool,
    StrictInt,
    with_config,
)
from pydantic_core import PydanticCustomError

from celmento_api.models.enums import (
    Currency,
    MeetingOutcomeStatus,
    MeetingPlace,
    MeetingSource,
    MeetingStatus,
    MeetingType,
    PaymentType,
    Specialization,
)
from celmento_api.schemas.account import Email, HttpLink, TextInput, Uri
from celmento_api.schemas.clients import ClientCard, ClientRef
from celmento_api.schemas.money import Money, Rate

MAX_DURATION_MINUTES = 2_147_483_647
DurationMinutes = Annotated[int, Field(strict=True, ge=1, le=MAX_DURATION_MINUTES)]
OwnDurationInput = Annotated[
    StrictInt, Field(json_schema_extra={"minimum": 1, "maximum": MAX_DURATION_MINUTES})
]
MonthName = Annotated[str, Field(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")]


def require_timestamp(value: object) -> str | datetime:
    if not isinstance(value, (str, datetime)):
        raise PydanticCustomError(
            "datetime_type", "Expected a date and time with an offset"
        )
    return value


MeetingInstant = Annotated[AwareDatetime, BeforeValidator(require_timestamp)]


@with_config(extra="forbid")
class MeetingOutcomeFields(TypedDict, total=False):
    status: Required[MeetingOutcomeStatus]
    actual_duration_minutes: DurationMinutes
    price: Rate
    payment_type: PaymentType
    charged: StrictBool


class MeetingOutcomeInput(RootModel[MeetingOutcomeFields]):
    pass


class MeetingOptions(TypedDict, total=False):
    client_id: UUID
    with_whom: TextInput | None
    topic: TextInput | None
    my_duration_minutes: OwnDurationInput
    meeting_link: HttpLink | None
    address: TextInput | None
    price: Rate
    currency: Currency
    payment_type: PaymentType
    comment: TextInput | None
    allow_overlap: StrictBool


@with_config(extra="forbid")
class MeetingCreateFields(MeetingOptions, total=False):
    type: Required[MeetingType]
    starts_at: Required[MeetingInstant]
    duration_minutes: Required[DurationMinutes]
    place: Required[MeetingPlace]
    outcome: MeetingOutcomeInput


class MeetingCreate(RootModel[MeetingCreateFields]):
    pass


@with_config(extra="forbid")
class MeetingUpdateFields(MeetingOptions, total=False):
    type: MeetingType
    starts_at: MeetingInstant
    duration_minutes: DurationMinutes
    place: MeetingPlace


class MeetingUpdate(RootModel[MeetingUpdateFields]):
    pass


class Meeting(BaseModel):
    id: UUID
    type: MeetingType
    client: ClientRef | None
    with_whom: str | None = Field(repr=False)
    topic: str | None = Field(repr=False)
    starts_at: AwareDatetime
    duration_minutes: DurationMinutes
    my_duration_minutes: DurationMinutes | None
    actual_duration_minutes: DurationMinutes | None
    place: MeetingPlace
    meeting_link: Uri | None = Field(repr=False)
    address: str | None = Field(repr=False)
    price: Money | None
    payment_type: PaymentType | None
    status: MeetingStatus
    charged: bool | None
    comment: str | None = Field(repr=False)
    source: MeetingSource
    client_comment: str | None = Field(repr=False)
    invite_url: Uri | None
    awaiting_outcome: bool
    created_at: AwareDatetime


class MeetingDetail(Meeting):
    client_card: ClientCard | None
    balance_charge: Money | None


class SpecialistRef(BaseModel):
    id: UUID
    first_name: str
    last_name: str
    photo_url: Uri | None
    specializations: list[Specialization]
    specialization_other: str | None
    time_zone: str
    phone: str | None
    telegram: str | None
    whatsapp: str | None
    contact_email: Email | None


class AttendedMeeting(BaseModel):
    id: UUID
    specialist: SpecialistRef
    starts_at: AwareDatetime
    duration_minutes: DurationMinutes
    place: MeetingPlace
    meeting_link: Uri | None
    address: str | None = Field(repr=False)
    price: Money
    payment_type: PaymentType
    status: MeetingStatus
    charged: bool | None


class MeetingList(BaseModel):
    items: list[Meeting]
    attended: list[AttendedMeeting]
    pending_outcomes_count: Annotated[int, Field(ge=0)]
    next_outcome_in_seconds: Annotated[int, Field(ge=1)] | None
    attended_total: Annotated[int, Field(ge=0)]
    specialists_count: Annotated[int, Field(ge=0)]


class MeetingPendingOutcomeList(BaseModel):
    items: list[Meeting]
    count: Annotated[int, Field(ge=0)]


class MeetingCalendarMonth(BaseModel):
    month: MonthName
    days: list[date]


class MeetingDefaults(BaseModel):
    starts_at: AwareDatetime
    duration_minutes: DurationMinutes
    meeting_link: Uri | None
    currency: Currency


class ClientMeetingList(BaseModel):
    upcoming: list[Meeting]
    past: list[Meeting]


ArchivePreviewToken = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class ClientArchiveConfirm(BaseModel, extra="forbid"):
    preview_token: ArchivePreviewToken


class ClientArchivePreview(BaseModel):
    preview_token: ArchivePreviewToken
    meetings_to_delete: list[Meeting]
    meetings_awaiting_outcome: list[Meeting]
    balance: Money
