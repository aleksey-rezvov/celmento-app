from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.account import ReservedLoginWord
from celmento_api.models.admin import AdminKey
from celmento_api.models.enums import (
    AdminAction,
    AdminJournalObjectType,
    ErrorCode,
    Language,
    LegalDocumentKind,
)
from celmento_api.models.legal import LegalDocumentVersion
from celmento_api.models.preseeded import PreseededNoteSet
from celmento_api.schemas.admin import (
    AdminLegalDocumentVersion,
    AdminLegalDocumentVersionCreate,
    AdminPreseededNotesSet,
    AdminPreseededNotesSetReplace,
    AdminReservedLoginWordList,
)
from celmento_api.seed import DOCUMENTS
from celmento_api.services.journal import append_journal
from celmento_api.services.legal import find_current_version, lock_document
from celmento_api.services.logins import lock_login


def _asset_title(kind: LegalDocumentKind, language: Language) -> str:
    path = DOCUMENTS / f"{kind.value.replace('_', '-')}.{language.value}.md"
    with path.open(encoding="utf-8") as content:
        return content.readline().rstrip("\n").removeprefix("# ")


async def publish_document(
    session: AsyncSession,
    key: AdminKey,
    document: LegalDocumentKind,
    body: AdminLegalDocumentVersionCreate,
) -> AdminLegalDocumentVersion:
    await lock_document(session, document)
    previous = await find_current_version(session, document)
    number = 1
    if (
        previous is not None
        and previous.version.isascii()
        and previous.version.isdecimal()
    ):
        number = int(previous.version) + 1
    # spec:impl admin-content-and-access#accept-new-version-document-contour
    # spec:impl admin-content-and-access#make-new-version-one-legal-documents
    # spec:impl admin-content-and-access#keep-earlier-version-number-texts
    row = LegalDocumentVersion(
        document=document.value,
        version=str(number),
        title_ru=previous.title_ru
        if previous is not None
        else _asset_title(document, Language.RU),
        title_en=previous.title_en
        if previous is not None
        else _asset_title(document, Language.EN),
        text_ru=body.text_ru,
        text_en=body.text_en,
        uploaded_at=func.clock_timestamp(),
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    result = AdminLegalDocumentVersion(
        contour=current_contour(),
        document=document,
        version=row.version,
        uploaded_at=row.uploaded_at,
    )
    append_journal(
        session,
        key,
        AdminAction.UPLOAD_LEGAL_DOCUMENT_VERSION,
        AdminJournalObjectType.LEGAL_DOCUMENT,
        object_id=document.value,
        before={"version": previous.version} if previous is not None else None,
        after={"version": result.version},
    )
    return result


async def _preseeded_row(
    session: AsyncSession, language: Language, *, lock: bool = False
) -> PreseededNoteSet:
    row = await session.get(
        PreseededNoteSet, language.value, with_for_update=lock, populate_existing=lock
    )
    if row is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return row


def _preseeded_view(row: PreseededNoteSet) -> AdminPreseededNotesSet:
    return AdminPreseededNotesSet.model_validate(
        {**row.content, "language": row.preseeded_note_set_id, "version": row.version}
    )


async def preseeded_notes(
    session: AsyncSession, language: Language
) -> AdminPreseededNotesSet:
    # spec:impl admin-content-and-access#show-preseeded-notes-set-request
    return _preseeded_view(await _preseeded_row(session, language))


async def replace_preseeded_notes(
    session: AsyncSession,
    key: AdminKey,
    language: Language,
    expected_version: int,
    body: AdminPreseededNotesSetReplace,
) -> AdminPreseededNotesSet:
    row = await _preseeded_row(session, language, lock=True)
    if row.version != expected_version:
        raise AppError(409, ErrorCode.CONFLICT)
    before = _preseeded_view(row).model_dump(mode="json")
    # spec:impl admin-content-and-access#keep-set-language-folders-notes
    # spec:impl admin-content-and-access#apply-changed-set-only-accounts
    # spec:impl admin-content-and-access#change-copies-preseeded-notes-created
    row.content = body.model_dump(mode="json")
    row.version += 1
    row.updated_at = datetime.now(UTC)
    await session.flush()
    result = _preseeded_view(row)
    append_journal(
        session,
        key,
        AdminAction.REPLACE_PRESEEDED_NOTES,
        AdminJournalObjectType.PRESEEDED_NOTES,
        object_id=language.value,
        params={"expected_version": expected_version},
        before=before,
        after=result.model_dump(mode="json"),
    )
    return result


async def reserved_login_words(session: AsyncSession) -> AdminReservedLoginWordList:
    words = await session.scalars(
        select(ReservedLoginWord.reserved_login_word_id).order_by(
            ReservedLoginWord.reserved_login_word_id
        )
    )
    # spec:impl admin-content-and-access#show-reserved-login-words-list
    return AdminReservedLoginWordList(items=list(words))


async def add_reserved_login_word(
    session: AsyncSession, key: AdminKey, word: str
) -> AdminReservedLoginWordList:
    await lock_login(session, word)
    # spec:impl admin-content-and-access#add-word-reserved-login-words
    # spec:impl admin-content-and-access#change-free-existing-login-reserved
    # spec:impl booking-link-login#change-free-existing-login-administrator
    saved = await session.scalar(
        insert(ReservedLoginWord)
        .values(reserved_login_word_id=word, source="admin")
        .on_conflict_do_nothing(
            index_elements=[ReservedLoginWord.reserved_login_word_id]
        )
        .returning(ReservedLoginWord.reserved_login_word_id)
    )
    if saved is None:
        raise AppError(409, ErrorCode.CONFLICT)
    append_journal(
        session,
        key,
        AdminAction.ADD_RESERVED_LOGIN_WORD,
        AdminJournalObjectType.RESERVED_LOGIN_WORD,
        object_id=word,
        params={"word": word},
        after={"word": word},
    )
    return await reserved_login_words(session)
