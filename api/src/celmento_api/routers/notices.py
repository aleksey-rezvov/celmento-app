from uuid import UUID

from fastapi import APIRouter, Response

from celmento_api.auth import Database, SignedInAccount
from celmento_api.errors import error_responses
from celmento_api.schemas.notices import NoticeList
from celmento_api.services.notices import dismiss_notice, list_notices

router: APIRouter = APIRouter(prefix="/notices", tags=["notices"])


@router.get(
    "",
    operation_id="listNotices",
    summary="List the account's undismissed notices",
    response_model=NoticeList,
    responses=error_responses(401, 500),
)
async def get_notices(account: SignedInAccount, session: Database) -> NoticeList:
    return await list_notices(session, account.account_id)


@router.delete(
    "/{notice_id}",
    operation_id="dismissNotice",
    summary="Dismiss a notice",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(401, 404, 422, 500),
)
async def delete_notice(
    notice_id: UUID, account: SignedInAccount, session: Database
) -> Response:
    await dismiss_notice(session, account.account_id, notice_id)
    await session.commit()
    return Response(status_code=204)
