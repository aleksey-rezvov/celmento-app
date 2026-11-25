from datetime import date
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field

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

Email = Annotated[str, Field(json_schema_extra={"format": "email"})]
Uri = Annotated[str, Field(json_schema_extra={"format": "uri"})]


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
    working: bool
    start: Annotated[str, Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    end: Annotated[str, Field(pattern=r"^([01][0-9]|2[0-3]):[0-5][0-9]$")]


class LeaderProfile(BaseModel):
    specializations: list[Specialization]
    specialization_other: str | None
    about: Annotated[str, Field(max_length=1000)]
    contact_email: Email | None = Field(repr=False)
    links: Annotated[list[Uri], Field(max_length=5)]
    main_channel: ContactChannel | None
    booking_url: Uri
    working_hours: Annotated[list[WorkingDay], Field(min_length=7, max_length=7)]
    session_duration_minutes: Annotated[
        int, Field(json_schema_extra={"enum": [15, 30, 45, 60, 75, 90]})
    ]
    session_format: SessionFormat
    default_meeting_link: Uri | None
    default_rate: str | None
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
