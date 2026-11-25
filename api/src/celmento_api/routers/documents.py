from fastapi import APIRouter

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
    responses=error_responses(422, 500),
)
async def get_document(
    kind: LegalDocumentKind, language: Language, session: Database
) -> LegalDocument:
    return await read_document(session, kind, language)
