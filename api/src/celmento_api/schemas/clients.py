from typing import Annotated, ClassVar, Required, TypedDict
from uuid import UUID

from fastapi import Header, UploadFile
from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    StringConstraints,
    with_config,
)

from celmento_api.models.enums import (
    ClientCardStatus,
    ClientLinkMethod,
    ClientLinkStatus,
    ClientSource,
    ContactChannel,
    Currency,
    PaymentType,
)
from celmento_api.schemas.account import Email, PlanStatus, TextInput, Uri
from celmento_api.schemas.balance import BalanceSummary
from celmento_api.schemas.money import DecimalAmount, Rate

ClientName = Annotated[
    TextInput, StringConstraints(strip_whitespace=True, min_length=1)
]
IdempotencyKey = Annotated[UUID | None, Header(alias="Idempotency-Key")]


class ClientContacts(TypedDict, total=False):
    phone: TextInput | None
    email: TextInput | None
    telegram: TextInput | None
    whatsapp: TextInput | None


@with_config(extra="forbid")
class ClientCreateFields(ClientContacts, total=False):
    name: Required[ClientName]
    rate: Rate | None
    currency: Currency
    payment_type: PaymentType


class ClientCreate(RootModel[ClientCreateFields]):
    pass


@with_config(extra="forbid")
class ClientUpdateFields(ClientContacts, total=False):
    name: ClientName
    other_contact: TextInput | None
    preferred_channel: ContactChannel | None
    rate: Rate | None
    currency: Currency
    payment_type: PaymentType
    request: TextInput | None
    goals: TextInput | None
    info: TextInput | None
    hypotheses: TextInput | None


class ClientUpdate(RootModel[ClientUpdateFields]):
    pass


class ClientPhotoUpload(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    file: UploadFile


class ClientLinkByLogin(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    login: TextInput = Field(repr=False)


class ClientLink(BaseModel):
    status: ClientLinkStatus
    method: ClientLinkMethod | None
    login: str | None


class ClientCard(BaseModel):
    id: UUID
    name: str = Field(repr=False)
    photo_url: Uri | None
    phone: str | None = Field(repr=False)
    email: str | None = Field(repr=False)
    telegram: str | None = Field(repr=False)
    whatsapp: str | None = Field(repr=False)
    other_contact: str | None = Field(repr=False)
    preferred_channel: ContactChannel | None
    self_given_email: Email | None = Field(repr=False)
    link: ClientLink
    rate: DecimalAmount | None
    currency: Currency
    payment_type: PaymentType
    request: str | None = Field(repr=False)
    goals: str | None = Field(repr=False)
    info: str | None = Field(repr=False)
    hypotheses: str | None = Field(repr=False)
    status: ClientCardStatus
    archived_at: AwareDatetime | None
    linked: bool
    is_new: bool
    source: ClientSource
    completed_sessions: Annotated[int, Field(ge=0)]
    completed_hours: Annotated[float, Field(ge=0)]
    balance: BalanceSummary
    created_at: AwareDatetime


class ClientListItem(BaseModel):
    id: UUID
    name: str = Field(repr=False)
    photo_url: Uri | None
    status: ClientCardStatus
    archived_at: AwareDatetime | None
    linked: bool
    is_new: bool
    completed_sessions: Annotated[int, Field(ge=0)]
    last_meeting_at: AwareDatetime | None
    balance: BalanceSummary


class ClientList(BaseModel):
    items: list[ClientListItem]
    plan: PlanStatus
