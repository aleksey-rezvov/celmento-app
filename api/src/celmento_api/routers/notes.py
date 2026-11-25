from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Body, Query, Request, Response

from celmento_api.auth import Database, LeaderAccount, SignedInAccount
from celmento_api.errors import error_responses
from celmento_api.models.enums import NoteFilter
from celmento_api.models.note import Folder as FolderRecord
from celmento_api.schemas.clients import IdempotencyKey
from celmento_api.schemas.notes import (
    Folder,
    FolderCreate,
    FolderList,
    FolderUpdate,
    Note,
    NoteChecklistTicks,
    NoteCreate,
    NoteList,
    NoteReplyCreate,
    NoteSearch,
    NoteTagCreate,
    NoteTaggableList,
    NoteUpdate,
)
from celmento_api.services import notes
from celmento_api.services.account_access import lock_account
from celmento_api.services.folders import folder_view, folders_for, owned_folder
from celmento_api.services.note_access import note_view, notes_for, readable_note
from celmento_api.storage import media_origin

router: APIRouter = APIRouter(prefix="/notes", tags=["notes"])
folders_router: APIRouter = APIRouter(prefix="/folders", tags=["notes"])


@router.get(
    "",
    operation_id="listNotes",
    summary="List the account's notes for the Notes tab",
    response_model=NoteList,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def get_notes(
    request: Request,
    account: SignedInAccount,
    session: Database,
    ownership: Annotated[NoteFilter, Query(alias="filter")] = NoteFilter.ALL,
    folder_id: UUID | None = None,
    q: Annotated[NoteSearch | None, Query()] = None,
    client_id: UUID | None = None,
) -> NoteList:
    return await notes_for(
        session, account, media_origin(request), ownership, folder_id, q, client_id
    )


@router.post(
    "",
    operation_id="createNote",
    summary="Create a note",
    status_code=201,
    response_model=Note,
    responses=error_responses(401, 404, 409, 422, 500),
)
async def post_note(
    request: Request,
    body: Annotated[NoteCreate, Body()],
    account: SignedInAccount,
    session: Database,
    idempotency_key: IdempotencyKey = None,
) -> Note:
    note = await notes.create_note(session, account, body, idempotency_key)
    result = await note_view(session, account, note, media_origin(request))
    await session.commit()
    return result


@router.get(
    "/taggable",
    operation_id="listTaggablePeople",
    summary="List the people the leader can tag in a note",
    response_model=NoteTaggableList,
    responses=error_responses(401, 403, 500),
)
async def list_taggable(
    request: Request, leader: LeaderAccount, session: Database
) -> NoteTaggableList:
    return await notes.taggable_people(session, leader, media_origin(request))


@router.get(
    "/{note_id}",
    operation_id="getNote",
    summary="Get a note",
    response_model=Note,
    responses=error_responses(401, 404, 422, 500),
)
async def get_note(
    request: Request, note_id: UUID, account: SignedInAccount, session: Database
) -> Note:
    note = await readable_note(session, account.account_id, note_id)
    return await note_view(session, account, note, media_origin(request))


@router.patch(
    "/{note_id}",
    operation_id="updateNote",
    summary="Autosave a note or move it to a folder",
    response_model=Note,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def patch_note(
    request: Request,
    note_id: UUID,
    body: Annotated[NoteUpdate, Body()],
    account: SignedInAccount,
    session: Database,
) -> Note:
    note = await notes.update_note(session, account, note_id, body.root)
    result = await note_view(session, account, note, media_origin(request))
    await session.commit()
    return result


@router.delete(
    "/{note_id}",
    operation_id="deleteNote",
    summary="Delete a note",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def delete_note(
    note_id: UUID, account: SignedInAccount, session: Database
) -> Response:
    await notes.delete_note(session, account, note_id)
    await session.commit()
    return Response(status_code=204)


@router.put(
    "/{note_id}/checklist-ticks",
    operation_id="setNoteChecklistTicks",
    summary="Tick and untick checklist items of a received note",
    response_model=Note,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def put_checklist_ticks(
    request: Request,
    note_id: UUID,
    body: Annotated[NoteChecklistTicks, Body()],
    account: SignedInAccount,
    session: Database,
) -> Note:
    note = await notes.set_checklist_ticks(session, account, note_id, body)
    result = await note_view(session, account, note, media_origin(request))
    await session.commit()
    return result


@router.post(
    "/{note_id}/replies",
    operation_id="replyToNote",
    summary="Reply to a note shared with the account",
    status_code=201,
    response_model=Note,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def post_reply(
    request: Request,
    note_id: UUID,
    body: Annotated[NoteReplyCreate, Body()],
    account: SignedInAccount,
    session: Database,
    idempotency_key: IdempotencyKey = None,
) -> Note:
    reply = await notes.reply_to_note(session, account, note_id, body, idempotency_key)
    result = await note_view(session, account, reply, media_origin(request))
    await session.commit()
    return result


@router.post(
    "/{note_id}/tags",
    operation_id="addNoteTag",
    summary="Tag a client in a note and share it",
    status_code=201,
    response_model=Note,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def post_tag(
    request: Request,
    note_id: UUID,
    body: Annotated[NoteTagCreate, Body()],
    leader: LeaderAccount,
    session: Database,
) -> Note:
    note = await notes.tag_note(session, leader, note_id, body.target_id)
    result = await note_view(session, leader, note, media_origin(request))
    await session.commit()
    return result


@router.delete(
    "/{note_id}/tags/{tag_id}",
    operation_id="removeNoteTag",
    summary="Remove a tag and the person's access",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def delete_tag(
    note_id: UUID, tag_id: UUID, account: SignedInAccount, session: Database
) -> Response:
    await notes.remove_tag(session, account, note_id, tag_id)
    await session.commit()
    return Response(status_code=204)


@folders_router.get(
    "",
    operation_id="listFolders",
    summary="List the account's folders",
    response_model=FolderList,
    responses=error_responses(401, 500),
)
async def list_folders(account: SignedInAccount, session: Database) -> FolderList:
    return await folders_for(session, account.account_id)


@folders_router.post(
    "",
    operation_id="createFolder",
    summary="Create a folder",
    status_code=201,
    response_model=Folder,
    responses=error_responses(401, 422, 500),
)
async def post_folder(
    body: Annotated[FolderCreate, Body()], account: SignedInAccount, session: Database
) -> Folder:
    await lock_account(session, account.account_id, no_key_update=True)
    folder = FolderRecord(
        owner_account_id=account.account_id, name=body.name, color=body.color.value
    )
    session.add(folder)
    await session.flush()
    result = folder_view(folder)
    await session.commit()
    return result


@folders_router.patch(
    "/{folder_id}",
    operation_id="updateFolder",
    summary="Rename or recolor a folder",
    response_model=Folder,
    responses=error_responses(401, 404, 422, 500),
)
async def patch_folder(
    folder_id: UUID,
    body: Annotated[FolderUpdate, Body()],
    account: SignedInAccount,
    session: Database,
) -> Folder:
    await lock_account(session, account.account_id, no_key_update=True)
    folder = await owned_folder(session, account.account_id, folder_id)
    folder.name = body.root.get("name", folder.name)
    if "color" in body.root:
        folder.color = body.root["color"].value
    await session.commit()
    return folder_view(folder)


@folders_router.delete(
    "/{folder_id}",
    operation_id="deleteFolder",
    summary="Delete a folder, keeping its notes",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(401, 404, 422, 500),
)
async def delete_folder(
    folder_id: UUID, account: SignedInAccount, session: Database
) -> Response:
    await lock_account(session, account.account_id, no_key_update=True)
    folder = await owned_folder(session, account.account_id, folder_id)
    await session.delete(folder)
    await session.commit()
    return Response(status_code=204)
