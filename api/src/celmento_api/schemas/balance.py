from datetime import date as LocalDate
from typing import Annotated, ClassVar, TypedDict
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, RootModel, with_config

from celmento_api.models.enums import BalanceOperationKind
from celmento_api.schemas.account import TextInput
from celmento_api.schemas.money import Money, StoredAmount

SessionCount = Annotated[str, Field(pattern=r"^[0-9]+$")]


class BalanceSummary(BaseModel):
    balance: Money
    sessions_left: SessionCount | None
    unpaid_sessions: SessionCount | None


class BalanceOperation(BaseModel):
    id: UUID
    kind: BalanceOperationKind
    amount: Money
    date: LocalDate
    comment: str | None = Field(repr=False)
    meeting_id: UUID | None
    created_by_system: bool
    editable: bool
    created_at: AwareDatetime


class ClientBalance(BaseModel):
    balance: BalanceSummary
    items: list[BalanceOperation]


class ClientPaymentCreate(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    amount: StoredAmount
    date: LocalDate
    comment: TextInput | None = Field(default=None, repr=False)


@with_config(extra="forbid")
class ClientPaymentUpdateFields(TypedDict, total=False):
    amount: StoredAmount
    date: LocalDate
    comment: TextInput | None


class ClientPaymentUpdate(RootModel[ClientPaymentUpdateFields]):
    pass
