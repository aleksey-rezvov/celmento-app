from pydantic import AwareDatetime, BaseModel

from celmento_api.models.enums import (
    AcceptanceKind,
    Contour,
    Language,
    LegalDocumentKind,
)


class ConsentAcceptance(BaseModel):
    document: LegalDocumentKind
    version: str
    accepted_at: AwareDatetime | None = None


class AcceptanceRecord(BaseModel):
    kind: AcceptanceKind
    version: str | None
    accepted_at: AwareDatetime


class LegalDocument(BaseModel):
    contour: Contour
    kind: LegalDocumentKind
    version: str
    language: Language
    title: str
    text: str
    uploaded_at: AwareDatetime
