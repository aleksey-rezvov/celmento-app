from asyncio import gather, timeout
from collections.abc import Mapping
from uuid import uuid7

from httpx import Response
from test_account import AccountStand, account_stand
from test_clients_api import bearer, problem

from celmento_api.models.enums import ErrorCode, FolderColor
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.notes import Folder, FolderList, Note, NoteList

__all__: list[str] = ["account_stand"]

NOTES: str = "/api/v1/notes"
FOLDERS: str = "/api/v1/folders"


def note_from(response: Response, status: int = 200) -> Note:
    assert response.status_code == status, response.text
    return Note.model_validate_json(response.content)


def notes_from(response: Response) -> NoteList:
    assert response.status_code == 200, response.text
    return NoteList.model_validate_json(response.content)


def folder_from(response: Response, status: int = 200) -> Folder:
    assert response.status_code == status, response.text
    return Folder.model_validate_json(response.content)


def folders_from(response: Response) -> FolderList:
    assert response.status_code == 200, response.text
    return FolderList.model_validate_json(response.content)


async def post_note(
    stand: AccountStand, author: SignInSession, fields: Mapping[str, object]
) -> Note:
    return note_from(
        await stand.client.post(NOTES, headers=bearer(author), json=dict(fields)), 201
    )


# spec:test note-editor#record-author-creation-date-modified
# spec:test note-editor#limit-title-200-characters
# spec:test note-editor#stop-accepting-text-after-20-000-characters
# spec:test note-editor#keep-new-note-private-author
# spec:test note-sharing-tags#show-note-anyone-author-until
# spec:test notes-grid-folders#keep-folders-personal-account-created
# spec:test notes-grid-folders#sort-grid-modified-date-newest
# spec:test notes-grid-folders#show-root-grid-account-notes
# spec:test notes-grid-folders#order-folder-tiles-creation-date
# spec:test notes-grid-folders#open-search-field-magnifier-notes
async def test_private_notes_and_folders_cover_root_search_move_and_delete(
    account_stand: AccountStand,
) -> None:
    author = await account_stand.add_account("note_writer")
    outsider = await account_stand.add_account("note_outsider")
    client = account_stand.client
    headers, other = bearer(author), bearer(outsider)
    problem(await client.get(NOTES), 401, ErrorCode.UNAUTHORIZED)
    assert notes_from(await client.get(NOTES, headers=headers)).total == 0
    for invalid in ("", " " * 3, "f" * 51):
        assert (
            await client.post(
                FOLDERS, headers=headers, json={"name": invalid, "color": "pink"}
            )
        ).status_code == 422
    assert (
        await client.post(
            FOLDERS, headers=headers, json={"name": "Folder", "color": "unavailable"}
        )
    ).status_code == 422
    first = folder_from(
        await client.post(
            FOLDERS, headers=headers, json={"name": "First", "color": "pink"}
        ),
        201,
    )
    second = folder_from(
        await client.post(
            FOLDERS, headers=headers, json={"name": "f" * 50, "color": "green"}
        ),
        201,
    )
    assert first.id.version == second.id.version == 7
    assert folders_from(await client.get(FOLDERS, headers=headers)).items == [
        first,
        second,
    ]
    assert folders_from(await client.get(FOLDERS, headers=other)).items == []
    folder_path = f"{FOLDERS}/{first.id}"
    for response in (
        await client.patch(folder_path, headers=other, json={"name": "Stolen"}),
        await client.delete(folder_path, headers=other),
        await client.get(NOTES, headers=other, params={"folder_id": str(first.id)}),
        await client.post(NOTES, headers=other, json={"folder_id": str(first.id)}),
    ):
        problem(response, 404, ErrorCode.NOT_FOUND)
    renamed = folder_from(
        await client.patch(
            folder_path, headers=headers, json={"name": "Renamed", "color": "peach"}
        )
    )
    assert renamed.id == first.id and renamed.created_at == first.created_at
    assert renamed.name == "Renamed" and renamed.color == FolderColor.PEACH

    empty = await post_note(account_stand, author, {})
    assert empty.id.version == 7 and empty.author.id == author.account.id
    assert empty.title == empty.text == "" and empty.folder_id is None
    assert empty.tags == [] and empty.can_edit and not empty.shared_with_me
    assert empty.updated_at == empty.created_at
    assert (
        await client.delete(f"{NOTES}/{empty.id}", headers=headers)
    ).status_code == 204
    filed = await post_note(
        account_stand,
        author,
        {
            "title": "Hidden in folder",
            "text": "A ReCorD with _%",
            "folder_id": str(first.id),
        },
    )
    root = await post_note(
        account_stand, author, {"title": "t" * 200, "text": "x" * 20000}
    )
    path = f"{NOTES}/{root.id}"
    for invalid_body in ({"title": "t" * 201}, {"text": "x" * 20001}, {"text": None}):
        assert (
            await client.patch(path, headers=headers, json=invalid_body)
        ).status_code == 422
        assert (
            await client.post(NOTES, headers=headers, json=invalid_body)
        ).status_code == 422
    grid = notes_from(await client.get(NOTES, headers=headers))
    assert grid.total == 2 and [note.id for note in grid.items] == [root.id]
    folder = notes_from(
        await client.get(NOTES, headers=headers, params={"folder_id": str(first.id)})
    )
    assert folder.total == 2 and folder.items == [filed]
    search = notes_from(
        await client.get(
            NOTES, headers=headers, params={"q": "record with _%", "filter": "shared"}
        )
    )
    assert search.items == [filed]
    assert not notes_from(
        await client.get(NOTES, headers=headers, params={"q": "x%"})
    ).items
    assert not notes_from(
        await client.get(
            NOTES, headers=headers, params={"q": "record", "folder_id": str(second.id)}
        )
    ).items
    assert (
        notes_from(await client.get(NOTES, headers=other, params={"q": "record"})).total
        == 0
    )
    for response in (
        await client.get(path, headers=other),
        await client.patch(path, headers=other, json={"title": "Trespass"}),
        await client.delete(path, headers=other),
    ):
        problem(response, 404, ErrorCode.NOT_FOUND)

    moved = note_from(
        await client.patch(
            path, headers=headers, json={"title": "Moved", "folder_id": str(first.id)}
        )
    )
    assert moved.created_at == root.created_at and moved.updated_at > root.updated_at
    assert moved.text == root.text and moved.folder_id == first.id
    all_in_folder = notes_from(
        await client.get(NOTES, headers=headers, params={"folder_id": str(first.id)})
    )
    assert [note.id for note in all_in_folder.items] == [root.id, filed.id]
    assert (await client.delete(folder_path, headers=headers)).status_code == 204
    after = notes_from(await client.get(NOTES, headers=headers))
    assert after.total == 2 and [note.id for note in after.items] == [root.id, filed.id]
    assert all(note.folder_id is None for note in after.items)
    assert folders_from(await client.get(FOLDERS, headers=headers)).items == [second]


async def test_note_creation_key_is_scoped_and_survives_deletion(
    account_stand: AccountStand,
) -> None:
    author = await account_stand.add_account("keyed_note_writer")
    other = await account_stand.add_account("other_note_writer")
    client = account_stand.client
    key = str(uuid7())
    headers = {**bearer(author), "Idempotency-Key": key}
    body = {"title": "Confirmed once"}
    async with timeout(10):
        responses = await gather(
            client.post(NOTES, headers=headers, json=body),
            client.post(NOTES, headers=headers, json=body),
        )
    first, replay = (note_from(response, 201) for response in responses)
    assert first == replay
    assert notes_from(await client.get(NOTES, headers=headers)).total == 1
    problem(
        await client.post(NOTES, headers=headers, json={"title": "Different"}),
        409,
        ErrorCode.CONFLICT,
    )
    distinct = note_from(
        await client.post(
            NOTES, headers={**bearer(other), "Idempotency-Key": key}, json=body
        ),
        201,
    )
    assert distinct.id != first.id and distinct.author.id == other.account.id
    assert (
        await client.delete(f"{NOTES}/{first.id}", headers=headers)
    ).status_code == 204
    problem(
        await client.post(NOTES, headers=headers, json=body), 409, ErrorCode.CONFLICT
    )
    assert notes_from(await client.get(NOTES, headers=headers)).total == 0
