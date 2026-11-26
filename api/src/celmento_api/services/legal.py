from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import Numeric, case, cast, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.enums import (
    AcceptanceKind,
    ErrorCode,
    Language,
    LegalDocumentKind,
)
from celmento_api.models.legal import Acceptance, LegalDocumentVersion
from celmento_api.schemas.documents import ConsentAcceptance, LegalDocument

REGISTRATION_CONSENTS: frozenset[LegalDocumentKind] = frozenset(
    {
        LegalDocumentKind.TERMS_OF_USE,
        LegalDocumentKind.PERSONAL_DATA_CONSENT,
    }
)
ACTIVATION_CONSENTS: frozenset[LegalDocumentKind] = frozenset(
    {
        LegalDocumentKind.SPECIALIST_OFFER,
        LegalDocumentKind.DATA_PROCESSING_INSTRUCTION,
    }
)


async def lock_document(
    session: AsyncSession, kind: LegalDocumentKind, *, shared: bool = False
) -> None:
    lock = "pg_advisory_xact_lock_shared" if shared else "pg_advisory_xact_lock"
    await session.execute(
        text(f"SELECT {lock}(hashtextextended(:subject, 0))"),
        {"subject": f"legal-document:{kind.value}"},
    )


async def find_current_version(
    session: AsyncSession, kind: LegalDocumentKind
) -> LegalDocumentVersion | None:
    published_number = case(
        (
            LegalDocumentVersion.version.bool_op("~")(r"^[0-9]+$"),
            cast(LegalDocumentVersion.version, Numeric()),
        )
    )
    return await session.scalar(
        select(LegalDocumentVersion)
        .where(LegalDocumentVersion.document == kind.value)
        .order_by(
            published_number.desc().nulls_last(),
            LegalDocumentVersion.uploaded_at.desc(),
            LegalDocumentVersion.legal_document_version_id.desc(),
        )
        .limit(1),
    )


async def current_version(
    session: AsyncSession, kind: LegalDocumentKind
) -> LegalDocumentVersion:
    version = await find_current_version(session, kind)
    if version is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return version


async def read_document(
    session: AsyncSession,
    kind: LegalDocumentKind,
    language: Language,
    version_number: str | None = None,
) -> LegalDocument:
    if version_number is None:
        version = await current_version(session, kind)
    else:
        # spec:impl admin-content-and-access#keep-earlier-version-number-texts
        version = await session.scalar(
            select(LegalDocumentVersion).where(
                LegalDocumentVersion.document == kind.value,
                LegalDocumentVersion.version == version_number,
            )
        )
        if version is None:
            raise AppError(404, ErrorCode.NOT_FOUND)
    # spec:impl legal-documents#share-version-across-languages
    return LegalDocument(
        kind=kind,
        language=language,
        contour=current_contour(),
        version=version.version,
        title=version.title_ru if language == Language.RU else version.title_en,
        text=version.text_ru if language == Language.RU else version.text_en,
        uploaded_at=version.uploaded_at,
    )


async def require_consents(
    session: AsyncSession,
    consents: Sequence[ConsentAcceptance],
    required: frozenset[LegalDocumentKind],
    *,
    timestamp_required: bool = False,
    current_required: bool = False,
) -> None:
    if (
        len(consents) != len(required)
        or frozenset(entry.document for entry in consents) != required
    ):
        # spec:impl legal-documents#require-recorded-account-consent
        raise AppError(400, ErrorCode.CONSENT_REQUIRED)
    if timestamp_required and any(entry.accepted_at is None for entry in consents):
        raise AppError(400, ErrorCode.CONSENT_REQUIRED)
    if current_required:
        for entry in sorted(consents, key=lambda item: item.document.value):
            await lock_document(session, entry.document, shared=True)
            current = await current_version(session, entry.document)
            if entry.version != current.version:
                raise AppError(400, ErrorCode.CONSENT_REQUIRED)
        return
    pairs = {(entry.document.value, entry.version) for entry in consents}
    records = await session.execute(
        select(LegalDocumentVersion.document, LegalDocumentVersion.version).where(
            tuple_(LegalDocumentVersion.document, LegalDocumentVersion.version).in_(
                pairs
            ),
        ),
    )
    if pairs != {(document, version) for document, version in records}:
        raise AppError(400, ErrorCode.CONSENT_REQUIRED)


def record_acceptances(
    session: AsyncSession,
    items: Sequence[ConsentAcceptance],
    *,
    account_id: UUID | None = None,
    meeting_id: UUID | None = None,
    guest_client_card_id: UUID | None = None,
    keep_client_time: bool = False,
    accepted_at: datetime | None = None,
) -> None:
    acceptance_time = accepted_at if accepted_at is not None else datetime.now(UTC)
    for item in items:
        session.add(
            Acceptance(
                account_id=account_id,
                meeting_id=meeting_id,
                guest_booking_id=meeting_id,
                guest_client_card_id=guest_client_card_id,
                kind=AcceptanceKind(item.document.value),
                version=item.version,
                accepted_at=item.accepted_at
                if keep_client_time and item.accepted_at is not None
                else acceptance_time,
            ),
        )
