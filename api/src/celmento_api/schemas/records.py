from datetime import date
from decimal import Decimal
from typing import Annotated, ClassVar
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from celmento_api.models.enums import (
    MeetingType,
    PaymentType,
    RecordsOperationKind,
    RecordsPeriodKind,
)
from celmento_api.schemas.account import TextInput
from celmento_api.schemas.balance import BalanceSummary
from celmento_api.schemas.clients import ClientRef
from celmento_api.schemas.money import Money

RecordsHours = Annotated[float, Field(ge=0)]


def _validate_goal_hours(value: str) -> str:
    # spec:impl records-hours-goal#validate-change
    if not Decimal("0.01") <= Decimal(value) <= Decimal("99999.99"):
        raise ValueError("Goal hours must be between 0.01 and 99999.99")
    return value


class RecordsPeriod(BaseModel):
    kind: RecordsPeriodKind
    from_: date | None = Field(alias="from")
    to: date | None


class RecordsSummary(BaseModel):
    period: RecordsPeriod
    has_outcomes: bool
    income: list[Money]
    receipts: list[Money]
    expenses: list[Money]
    prepaid: list[Money]
    debts: list[Money]
    practice_hours: RecordsHours
    completed_sessions: Annotated[int, Field(ge=0)]
    growth_hours: RecordsHours
    supervision_hours: RecordsHours
    personal_therapy_hours: RecordsHours
    training_hours: RecordsHours


class RecordsOperation(BaseModel):
    id: UUID
    kind: RecordsOperationKind
    amount: Money
    date: date
    meeting_id: UUID | None
    client: ClientRef | None
    meeting_type: MeetingType | None
    with_whom: str | None = Field(repr=False)


class RecordsOperationList(BaseModel):
    items: list[RecordsOperation]


class RecordsHoursBreakdown(BaseModel):
    paid: RecordsHours | None
    pro_bono: RecordsHours | None
    individual: RecordsHours


class RecordsHoursMeeting(BaseModel):
    id: UUID
    date: date
    meeting_type: MeetingType
    client: ClientRef | None
    with_whom: str | None = Field(repr=False)
    hours: RecordsHours
    payment_type: PaymentType | None


class RecordsHoursLog(BaseModel):
    total_hours: RecordsHours
    period_hours: RecordsHours
    breakdown: RecordsHoursBreakdown
    items: list[RecordsHoursMeeting]


class RecordsHoursGoal(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    hours: Annotated[
        str,
        Field(pattern=r"^[0-9]{1,5}(\.[0-9]{1,2})?$"),
        AfterValidator(_validate_goal_hours),
    ]
    label: Annotated[
        TextInput,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
    ] = Field(repr=False)


class RecordsHoursGoalResult(BaseModel):
    goal: RecordsHoursGoal | None


class RecordsBalanceItem(BaseModel):
    client: ClientRef
    balance: BalanceSummary


class RecordsBalanceList(BaseModel):
    items: list[RecordsBalanceItem]
