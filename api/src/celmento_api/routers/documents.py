from typing import Annotated

from fastapi import APIRouter, Query

from celmento_api.auth import Database
from celmento_api.errors import error_responses
from celmento_api.models.enums import Language, LegalDocumentKind
from celmento_api.schemas.documents import LegalDocument
from celmento_api.services.legal import read_document

router: APIRouter = APIRouter(prefix="/documents", tags=["documents"])


@router.get(
    "/{kind}",
    operation_id="getLegalDocument",
    summary="Get the current version of a legal document",
    response_model=LegalDocument,
    responses=error_responses(404, 422, 500),
)
async def get_document(
    kind: LegalDocumentKind,
    language: Language,
    session: Database,
    version: Annotated[
        str | None, Query(min_length=1, max_length=128, pattern=r"^[^\x00]*$")
    ] = None,
) -> LegalDocument:
    return await read_document(session, kind, language, version)
