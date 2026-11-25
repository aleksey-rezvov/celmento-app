from datetime import date
from enum import StrEnum
from typing import Annotated, ClassVar, TypedDict
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import UploadFile
from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    RootModel,
    StringConstraints,
    TypeAdapter,
    with_config,
)

from celmento_api.models.enums import (
    ContactChannel,
    Contour,
    Currency,
    Language,
    SessionFormat,
    Specialization,
    Weekday,
)
from celmento_api.schemas.documents import AcceptanceRecord
from celmento_api.schemas.money import DecimalAmount, Rate

Email = Annotated[str, Field(json_schema_extra={"format": "email"})]
Uri = Annotated[str, Field(json_schema_extra={"format": "uri"})]
TextInput = Annotated[str, StringConstraints(pattern=r"^[^\x00]*$")]
Name = Annotated[
    TextInput, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
About = Annotated[TextInput, Field(max_length=1000)]
TimeOfDay = Annotated[str, Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]

SESSION_DURATIONS: tuple[int, ...] = (15, 30, 45, 60, 75, 90)
http_url: TypeAdapter[HttpUrl] = TypeAdapter(HttpUrl)


def validate_time_zone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ValueError("Expected an IANA time zone") from exc
    return value


def validate_http_link(value: str) -> str:
    http_url.validate_python(value)
    return value


def validate_duration(value: int) -> int:
    if value not in SESSION_DURATIONS:
        raise ValueError("Unsupported session duration")
    return value


def validate_unique_specializations(
    value: list[Specialization],
) -> list[Specialization]:
    if len(set(value)) != len(value):
        raise ValueError("Each specialization can be selected once")
    return value


TimeZone = Annotated[str, AfterValidator(validate_time_zone)]
HttpLink = Annotated[Uri, AfterValidator(validate_http_link)]
SessionDuration = Annotated[
    int,
    Field(strict=True, json_schema_extra={"enum": list(SESSION_DURATIONS)}),
    AfterValidator(validate_duration),
]


class PlanKind(StrEnum):
    FREE = "free"
    SUBSCRIPTION = "subscription"


class PlanStatus(BaseModel):
    kind: PlanKind
    active_clients: Annotated[int, Field(ge=0)]
    client_limit: int | None
    subscription_until: date | None


class WorkingDay(BaseModel):
    weekday: Weekday
    working: Annotated[bool, Field(strict=True)]
    start: TimeOfDay
    end: TimeOfDay


@with_config(extra="forbid")
class LeaderProfileUpdate(TypedDict, total=False):
    specializations: Annotated[
        list[Specialization],
        AfterValidator(validate_unique_specializations),
        Field(json_schema_extra={"uniqueItems": True}),
    ]
    specialization_other: TextInput | None
    about: About
    contact_email: EmailStr | None
    links: Annotated[list[HttpLink], Field(max_length=5)]
    main_channel: ContactChannel | None
    working_hours: Annotated[list[WorkingDay], Field(min_length=7, max_length=7)]
    session_duration_minutes: SessionDuration
    session_format: SessionFormat
    default_meeting_link: HttpLink | None
    default_rate: Rate | None
    default_currency: Currency


@with_config(extra="forbid")
class AccountUpdateFields(TypedDict, total=False):
    first_name: Name
    last_name: Name
    phone: TextInput | None
    telegram: TextInput | None
    whatsapp: TextInput | None
    login: str
    language: Language
    time_zone: TimeZone
    leader: LeaderProfileUpdate


class AccountUpdate(RootModel[AccountUpdateFields]):
    pass


class ProfilePhotoUpload(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    file: UploadFile


class LeaderProfile(BaseModel):
    specializations: list[Specialization]
    specialization_other: str | None
    about: About
    contact_email: Email | None = Field(repr=False)
    links: Annotated[list[Uri], Field(max_length=5)]
    main_channel: ContactChannel | None
    booking_url: Uri
    working_hours: Annotated[list[WorkingDay], Field(min_length=7, max_length=7)]
    session_duration_minutes: SessionDuration
    session_format: SessionFormat
    default_meeting_link: Uri | None
    default_rate: DecimalAmount | None
    default_currency: Currency
    plan: PlanStatus


class Account(BaseModel):
    id: UUID
    contour: Contour
    email: Email = Field(repr=False)
    first_name: Annotated[str, Field(min_length=1, repr=False)]
    last_name: Annotated[str, Field(min_length=1, repr=False)]
    photo_url: Uri | None
    phone: str | None
    telegram: str | None
    whatsapp: str | None
    login: Annotated[
        str, Field(min_length=5, max_length=32, pattern=r"^[a-z][a-z0-9_]*$")
    ]
    address_url: Uri
    language: Language
    time_zone: str
    activated: bool
    activated_at: AwareDatetime | None
    leader: LeaderProfile | None
    acceptances: list[AcceptanceRecord]
    created_at: AwareDatetime
