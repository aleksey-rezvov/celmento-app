from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Body, File, Query, Request, Response

from celmento_api.auth import Database, LeaderAccount
from celmento_api.errors import AppError, error_responses
from celmento_api.models.client_request_receipt import ClientWriteOperation
from celmento_api.models.enums import ClientCardStatus, ErrorCode
from celmento_api.schemas.account import TextInput
from celmento_api.schemas.clients import (
    ClientCard,
    ClientCreate,
    ClientLinkByLogin,
    ClientList,
    ClientPhotoUpload,
    ClientUpdate,
    IdempotencyKey,
)
from celmento_api.schemas.meetings import (
    ClientArchiveConfirm,
    ClientArchivePreview,
    ClientMeetingList,
)
from celmento_api.services.account_access import lock_account
from celmento_api.services.archive import (
    archive_client_card,
    client_archive_preview,
    restore_client_card,
)
from celmento_api.services.client_requests import (
    client_write_request,
    previous_client,
    remember_client_write,
)
from celmento_api.services.clients import (
    active_client_for_update,
    client_view,
    create_client_card,
    list_client_cards,
    owned_client,
    update_client_card,
)
from celmento_api.services.links import link_by_login, unlink
from celmento_api.services.meeting_views import list_client_meetings
from celmento_api.storage import (
    PHOTO_CONTENT_TYPES,
    client_photo_directory,
    client_photo_version,
    discard_photo,
    media_origin,
    read_client_photo,
    staged_photo,
)

router: APIRouter = APIRouter(prefix="/clients", tags=["clients"])


@router.get(
    "",
    operation_id="listClients",
    summary="List the specialist's client cards",
    response_model=ClientList,
    responses=error_responses(401, 403, 422, 500),
)
async def list_clients(
    request: Request,
    leader: LeaderAccount,
    session: Database,
    status: ClientCardStatus | None = None,
    q: Annotated[TextInput | None, Query(min_length=1)] = None,
) -> ClientList:
    return await list_client_cards(session, leader, media_origin(request), status, q)


@router.post(
    "",
    operation_id="createClient",
    summary="Create a client card",
    status_code=201,
    response_model=ClientCard,
    responses=error_responses(400, 401, 403, 409, 422, 500),
)
async def create_client(
    request: Request,
    body: Annotated[ClientCreate, Body()],
    leader: LeaderAccount,
    session: Database,
    idempotency_key: IdempotencyKey = None,
) -> ClientCard:
    receipt = client_write_request(
        ClientWriteOperation.CREATE_CLIENT, idempotency_key, body
    )
    existing_id = await previous_client(session, leader.account_id, receipt)
    if existing_id is not None:
        existing = await owned_client(
            session, leader.account_id, existing_id, lock=True
        )
        return await client_view(session, existing, media_origin(request))
    card = await create_client_card(session, leader, body.root)
    remember_client_write(session, leader.account_id, card.client_card_id, receipt)
    result = await client_view(session, card, media_origin(request))
    await session.commit()
    return result


@router.get(
    "/{client_id}",
    operation_id="getClient",
    summary="Get a client card",
    response_model=ClientCard,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def get_client(
    request: Request, client_id: UUID, leader: LeaderAccount, session: Database
) -> ClientCard:
    card = await owned_client(session, leader.account_id, client_id, lock=True)
    result = await client_view(session, card, media_origin(request))
    if card.is_new:
        # spec:impl client-list#remove-new-badge-soon-client-first
        card.is_new = False
        await session.commit()
    return result


@router.patch(
    "/{client_id}",
    operation_id="updateClient",
    summary="Edit a client card",
    response_model=ClientCard,
    responses=error_responses(400, 401, 403, 404, 409, 422, 500),
)
async def patch_client(
    request: Request,
    client_id: UUID,
    body: Annotated[ClientUpdate, Body()],
    leader: LeaderAccount,
    session: Database,
) -> ClientCard:
    if "currency" in body.root:
        leader = await lock_account(session, leader.account_id, no_key_update=True)
    card = await active_client_for_update(session, leader.account_id, client_id)
    await update_client_card(session, card, body.root)
    result = await client_view(session, card, media_origin(request))
    await session.commit()
    return result


@router.get(
    "/{client_id}/archive-preview",
    operation_id="getClientArchivePreview",
    summary="Get the data of the archive confirmation screen",
    response_model=ClientArchivePreview,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def get_archive_preview(
    request: Request, client_id: UUID, leader: LeaderAccount, session: Database
) -> ClientArchivePreview:
    return await client_archive_preview(
        session, leader, client_id, media_origin(request)
    )


@router.post(
    "/{client_id}/archive",
    operation_id="archiveClient",
    summary="Move a client card to the archive",
    response_model=ClientCard,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def archive_client(
    request: Request,
    client_id: UUID,
    body: Annotated[ClientArchiveConfirm, Body()],
    background_tasks: BackgroundTasks,
    leader: LeaderAccount,
    session: Database,
) -> ClientCard:
    card, emails = await archive_client_card(
        session, leader, client_id, body.preview_token
    )
    result = await client_view(session, card, media_origin(request))
    await session.commit()
    for email in emails:
        background_tasks.add_task(email.send)
    return result


@router.post(
    "/{client_id}/restore",
    operation_id="restoreClient",
    summary="Restore an archived client card",
    response_model=ClientCard,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def restore_client(
    request: Request, client_id: UUID, leader: LeaderAccount, session: Database
) -> ClientCard:
    card = await restore_client_card(session, leader, client_id)
    result = await client_view(session, card, media_origin(request))
    await session.commit()
    return result


@router.put(
    "/{client_id}/photo",
    operation_id="uploadClientPhoto",
    summary="Set the client card photo",
    response_model=ClientCard,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def upload_client_photo(
    request: Request,
    client_id: UUID,
    body: Annotated[ClientPhotoUpload, File()],
    leader: LeaderAccount,
    session: Database,
) -> ClientCard:
    card = await active_client_for_update(session, leader.account_id, client_id)
    previous_key = card.photo_key
    directory = client_photo_directory()
    async with staged_photo(body.file, directory) as key:
        card.photo_key = key
        result = await client_view(session, card, media_origin(request))
    await session.commit()
    await discard_photo(previous_key, directory)
    return result


@router.delete(
    "/{client_id}/photo",
    operation_id="deleteClientPhoto",
    summary="Remove the client card photo",
    response_model=ClientCard,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def delete_client_photo(
    request: Request, client_id: UUID, leader: LeaderAccount, session: Database
) -> ClientCard:
    card = await active_client_for_update(session, leader.account_id, client_id)
    previous_key = card.photo_key
    card.photo_key = None
    result = await client_view(session, card, media_origin(request))
    await session.commit()
    await discard_photo(previous_key, client_photo_directory())
    return result


@router.get(
    "/{client_id}/photo",
    operation_id="getClientPhoto",
    summary="Get the client card photo",
    response_class=Response,
    response_model=None,
    responses={
        200: {
            "description": "The client card photo",
            "content": {
                content_type: {"schema": {"type": "string", "format": "binary"}}
                for content_type in PHOTO_CONTENT_TYPES.values()
            },
        },
        **error_responses(401, 403, 404, 422, 500),
    },
)
async def get_client_photo(
    client_id: UUID,
    leader: LeaderAccount,
    session: Database,
    version: Annotated[UUID | None, Query()] = None,
) -> Response:
    card = await owned_client(session, leader.account_id, client_id, lock=True)
    key = card.photo_key
    if key is None or (version is not None and version != client_photo_version(key)):
        raise AppError(404, ErrorCode.NOT_FOUND)
    try:
        photo, content_type = await read_client_photo(key)
    except FileNotFoundError:
        raise AppError(404, ErrorCode.NOT_FOUND) from None
    return Response(
        content=photo,
        media_type=content_type,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.put(
    "/{client_id}/link",
    operation_id="linkClientByLogin",
    summary="Link a standalone client card to an account by its login",
    response_model=ClientCard,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def link_client(
    request: Request,
    client_id: UUID,
    body: ClientLinkByLogin,
    leader: LeaderAccount,
    session: Database,
) -> ClientCard:
    card = await active_client_for_update(session, leader.account_id, client_id)
    await link_by_login(session, card, leader, body.login)
    result = await client_view(session, card, media_origin(request))
    await session.commit()
    return result


@router.delete(
    "/{client_id}/link",
    operation_id="unlinkClient",
    summary="Break the link of a client card from the leader's side",
    response_model=ClientCard,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def unlink_client(
    request: Request, client_id: UUID, leader: LeaderAccount, session: Database
) -> ClientCard:
    card = await active_client_for_update(session, leader.account_id, client_id)
    await unlink(session, card, by_client=False)
    result = await client_view(session, card, media_origin(request))
    await session.commit()
    return result


@router.get(
    "/{client_id}/meetings",
    operation_id="listClientCardMeetings",
    summary="List meetings with a client",
    response_model=ClientMeetingList,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def client_meetings(
    request: Request,
    client_id: UUID,
    leader: LeaderAccount,
    session: Database,
    limit: Annotated[int | None, Query(ge=1)] = None,
) -> ClientMeetingList:
    card = await owned_client(session, leader.account_id, client_id)
    return await list_client_meetings(
        session, leader, card, media_origin(request), datetime.now(UTC), limit
    )
