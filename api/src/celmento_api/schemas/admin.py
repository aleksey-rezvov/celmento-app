from datetime import date
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field, model_validator

from celmento_api.models.enums import (
    AdminAction,
    AdminFeedbackScreen,
    AdminJournalObjectType,
    Contour,
    Language,
    LegalDocumentKind,
)
from celmento_api.schemas.account import Email, PlanStatus, TextInput
from celmento_api.schemas.notes import AdminPreseededNotesSetReplace


class AdminPeriod(BaseModel):
    from_: date | None = Field(default=None, alias="from")
    to: date | None = None

    @model_validator(mode="after")
    def validate_order(self) -> Self:
        if self.from_ is not None and self.to is not None and self.from_ > self.to:
            raise ValueError("End date is before start date")
        return self


class AdminAccountLookup(BaseModel):
    id: UUID
    email: Email = Field(repr=False)
    created_at: AwareDatetime
    activated: bool
    plan: PlanStatus


class AdminSubscriptionGrant(BaseModel, extra="forbid"):
    until: date


class AdminGrantedSubscription(BaseModel):
    account_id: UUID
    until: date
    granted_by: str
    granted_at: AwareDatetime
    source: Literal["admin"]


class AdminFeedbackItem(BaseModel):
    id: UUID
    text: str = Field(repr=False)
    activated: bool
    screen: AdminFeedbackScreen
    created_at: AwareDatetime
    processed: bool
    email: Email | None = Field(
        default=None, repr=False, exclude_if=lambda email: email is None
    )


class AdminFeedbackList(BaseModel):
    items: list[AdminFeedbackItem]


def _unique_ids(ids: list[UUID]) -> list[UUID]:
    if len(set(ids)) != len(ids):
        raise ValueError("Feedback ids must be unique")
    return ids


class AdminFeedbackMarkProcessed(BaseModel, extra="forbid"):
    ids: Annotated[
        list[UUID],
        Field(min_length=1, json_schema_extra={"uniqueItems": True}),
        AfterValidator(_unique_ids),
    ]


Count = Annotated[int, Field(ge=0)]
AdminShare = Annotated[float, Field(ge=0, le=1)] | None


class AdminTotalAndNew(BaseModel):
    total: Count
    new: Count


class AdminMeetingStatistics(BaseModel):
    count: Count
    with_outcome: Count
    not_taken_place_share: AdminShare


class AdminBookingStatistics(BaseModel):
    count: Count
    guests_signed_in_share: AdminShare


class AdminNoteStatistics(BaseModel):
    count: Count
    tags: Count


class AdminPlanLimitStatistics(BaseModel):
    leaders_hit_limit: Count
    plans_screen_openings: Count


class AdminLanguageUsage(BaseModel):
    language: Language
    accounts: Count


class AdminSubscriptionRequestStatistics(BaseModel):
    total: Count
    month: Count
    year: Count


class AdminStatistics(BaseModel):
    from_: date | None = Field(alias="from")
    to: date | None
    accounts: AdminTotalAndNew
    activations: AdminTotalAndNew
    meetings: AdminMeetingStatistics
    bookings: AdminBookingStatistics
    notes: AdminNoteStatistics
    plan_limit: AdminPlanLimitStatistics
    languages: list[AdminLanguageUsage]
    subscription_requests: AdminSubscriptionRequestStatistics


class AdminPreseededNotesSet(AdminPreseededNotesSetReplace):
    language: Language
    version: Annotated[int, Field(ge=1)]


def _nonblank_document(value: str) -> str:
    if not value.strip():
        raise ValueError("Document text must not be blank")
    return value


DocumentText = Annotated[
    TextInput, Field(min_length=1), AfterValidator(_nonblank_document)
]


class AdminLegalDocumentVersionCreate(BaseModel, extra="forbid"):
    text_ru: DocumentText = Field(repr=False)
    text_en: DocumentText = Field(repr=False)


class AdminLegalDocumentVersion(BaseModel):
    contour: Contour
    document: LegalDocumentKind
    version: str
    uploaded_at: AwareDatetime


class AdminReservedLoginWordCreate(BaseModel, extra="forbid"):
    word: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")]


class AdminReservedLoginWordList(BaseModel):
    items: Annotated[list[str], Field(json_schema_extra={"uniqueItems": True})]


class AdminJournalEntry(BaseModel):
    id: UUID
    at: AwareDatetime
    action: AdminAction
    object_type: AdminJournalObjectType
    object_id: str | None
    params: dict[str, object] = Field(repr=False)
    before: dict[str, object] | None = Field(repr=False)
    after: dict[str, object] | None = Field(repr=False)


class AdminJournalList(BaseModel):
    items: list[AdminJournalEntry]
