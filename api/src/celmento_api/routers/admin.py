from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Query

from celmento_api.admin_auth import Administrator
from celmento_api.auth import Database
from celmento_api.errors import AppError, error_responses
from celmento_api.models.enums import (
    AdminAction,
    AdminJournalObjectType,
    ErrorCode,
    Language,
    LegalDocumentKind,
)
from celmento_api.schemas.account import Email
from celmento_api.schemas.admin import (
    AdminAccountLookup,
    AdminFeedbackList,
    AdminFeedbackMarkProcessed,
    AdminGrantedSubscription,
    AdminJournalList,
    AdminLegalDocumentVersion,
    AdminLegalDocumentVersionCreate,
    AdminPreseededNotesSet,
    AdminPreseededNotesSetReplace,
    AdminReservedLoginWordCreate,
    AdminReservedLoginWordList,
    AdminStatistics,
    AdminSubscriptionGrant,
)
from celmento_api.services.admin_accounts import grant_subscription, lookup_account
from celmento_api.services.admin_content import (
    add_reserved_login_word,
    preseeded_notes,
    publish_document,
    replace_preseeded_notes,
    reserved_login_words,
)
from celmento_api.services.admin_feedback import feedback_for, mark_processed
from celmento_api.services.admin_period import Period
from celmento_api.services.journal import append_journal, read_journal
from celmento_api.services.statistics import statistics

router: APIRouter = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/accounts/lookup",
    operation_id="lookupAccount",
    summary="Look up an account by email",
    response_model=AdminAccountLookup,
    responses=error_responses(401, 404, 422, 500),
)
async def get_account(
    email: Annotated[Email, Query()], key: Administrator, session: Database
) -> AdminAccountLookup:
    result = await lookup_account(session, email)
    append_journal(
        session,
        key,
        AdminAction.LOOKUP_ACCOUNT,
        AdminJournalObjectType.ACCOUNT,
        object_id=str(result.id) if result is not None else None,
        params={"found": result is not None},
    )
    await session.commit()
    if result is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return result


@router.put(
    "/accounts/{account_id}/subscription",
    operation_id="grantSubscription",
    summary="Grant a subscription to an account until a date",
    response_model=AdminGrantedSubscription,
    responses=error_responses(401, 404, 422, 500),
)
async def put_subscription(
    account_id: UUID,
    body: Annotated[AdminSubscriptionGrant, Body()],
    key: Administrator,
    session: Database,
) -> AdminGrantedSubscription:
    result = await grant_subscription(session, key, account_id, body.until)
    await session.commit()
    return result


@router.get(
    "/feedback",
    operation_id="listFeedback",
    summary="List the feedback messages of a period",
    response_model=AdminFeedbackList,
    response_model_exclude_none=True,
    responses=error_responses(401, 422, 500),
)
async def get_feedback(
    key: Administrator,
    session: Database,
    period: Period,
    new_only: Annotated[bool, Query()] = False,
    include_email: Annotated[bool, Query()] = False,
) -> AdminFeedbackList:
    result = await feedback_for(
        session, period, new_only=new_only, include_email=include_email
    )
    append_journal(
        session,
        key,
        AdminAction.LIST_FEEDBACK,
        AdminJournalObjectType.FEEDBACK,
        params={
            **period.model_dump(mode="json", by_alias=True),
            "new_only": new_only,
            "include_email": include_email,
        },
    )
    await session.commit()
    return result


@router.post(
    "/feedback/mark-processed",
    operation_id="markFeedbackProcessed",
    summary="Mark feedback messages as processed",
    response_model=AdminFeedbackList,
    response_model_exclude_none=True,
    responses=error_responses(401, 404, 422, 500),
)
async def post_processed(
    body: Annotated[AdminFeedbackMarkProcessed, Body()],
    key: Administrator,
    session: Database,
) -> AdminFeedbackList:
    result = await mark_processed(session, key, body)
    await session.commit()
    return result


@router.get(
    "/journal",
    operation_id="listJournal",
    summary="List the journal of administrator actions for a period",
    response_model=AdminJournalList,
    responses=error_responses(401, 422, 500),
)
async def get_journal(
    key: Administrator, session: Database, period: Period
) -> AdminJournalList:
    result = await read_journal(session, period)
    append_journal(
        session,
        key,
        AdminAction.LIST_JOURNAL,
        AdminJournalObjectType.JOURNAL,
        params=period.model_dump(mode="json", by_alias=True),
    )
    await session.commit()
    return result


@router.post(
    "/legal-documents/{document}/versions",
    operation_id="uploadLegalDocumentVersion",
    summary="Upload a new version of a legal document",
    status_code=201,
    response_model=AdminLegalDocumentVersion,
    responses=error_responses(401, 422, 500),
)
async def post_legal_version(
    document: LegalDocumentKind,
    body: Annotated[AdminLegalDocumentVersionCreate, Body()],
    key: Administrator,
    session: Database,
) -> AdminLegalDocumentVersion:
    result = await publish_document(session, key, document, body)
    await session.commit()
    return result


@router.get(
    "/preseeded-notes/{language}",
    operation_id="getPreseededNotes",
    summary="Get the preseeded notes set of a language",
    response_model=AdminPreseededNotesSet,
    responses=error_responses(401, 422, 500),
)
async def get_seeded_notes(
    language: Language, key: Administrator, session: Database
) -> AdminPreseededNotesSet:
    result = await preseeded_notes(session, language)
    append_journal(
        session,
        key,
        AdminAction.GET_PRESEEDED_NOTES,
        AdminJournalObjectType.PRESEEDED_NOTES,
        object_id=language.value,
    )
    await session.commit()
    return result


@router.put(
    "/preseeded-notes/{language}",
    operation_id="replacePreseededNotes",
    summary="Replace the preseeded notes set of a language",
    response_model=AdminPreseededNotesSet,
    responses=error_responses(401, 409, 422, 500),
)
async def put_seeded_notes(
    language: Language,
    expected_version: Annotated[int, Query(ge=1)],
    body: Annotated[AdminPreseededNotesSetReplace, Body()],
    key: Administrator,
    session: Database,
) -> AdminPreseededNotesSet:
    result = await replace_preseeded_notes(
        session, key, language, expected_version, body
    )
    await session.commit()
    return result


@router.get(
    "/reserved-login-words",
    operation_id="listReservedLoginWords",
    summary="List the reserved login words",
    response_model=AdminReservedLoginWordList,
    responses=error_responses(401, 500),
)
async def list_reserved(
    key: Administrator, session: Database
) -> AdminReservedLoginWordList:
    result = await reserved_login_words(session)
    append_journal(
        session,
        key,
        AdminAction.LIST_RESERVED_LOGIN_WORDS,
        AdminJournalObjectType.RESERVED_LOGIN_WORD,
    )
    await session.commit()
    return result


@router.post(
    "/reserved-login-words",
    operation_id="addReservedLoginWord",
    summary="Add a reserved login word",
    status_code=201,
    response_model=AdminReservedLoginWordList,
    responses=error_responses(401, 409, 422, 500),
)
async def post_reserved(
    body: Annotated[AdminReservedLoginWordCreate, Body()],
    key: Administrator,
    session: Database,
) -> AdminReservedLoginWordList:
    result = await add_reserved_login_word(session, key, body.word)
    await session.commit()
    return result


@router.get(
    "/statistics",
    operation_id="getStatistics",
    summary="Get the anonymized product statistics of a period",
    response_model=AdminStatistics,
    responses=error_responses(401, 422, 500),
)
async def get_statistics(
    key: Administrator, session: Database, period: Period
) -> AdminStatistics:
    result = await statistics(session, period)
    append_journal(
        session,
        key,
        AdminAction.GET_STATISTICS,
        AdminJournalObjectType.STATISTICS,
        params=period.model_dump(mode="json", by_alias=True),
    )
    await session.commit()
    return result
