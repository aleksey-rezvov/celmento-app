from asyncio import gather, timeout
from email.message import EmailMessage
from uuid import UUID, uuid7

import pytest
from httpx import Response
from test_account import AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, problem
from test_meeting_notifications import mail_outbox, notices_for
from test_notes_api import (
    FOLDERS,
    NOTES,
    folders_from,
    note_from,
    notes_from,
    post_note,
)

from celmento_api.models.enums import (
    ClientCardStatus,
    ErrorCode,
    NoteTagTargetKind,
    NoticeKey,
)
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.meetings import ClientArchivePreview
from celmento_api.schemas.notes import ClientNoteList, Note, NoteTaggableList

__all__: list[str] = ["account_stand", "mail_outbox"]


async def _link(
    stand: AccountStand, leader: SignInSession, card_id: UUID, target: SignInSession
) -> None:
    response = await stand.client.put(
        f"{CLIENTS}/{card_id}/link",
        headers=bearer(leader),
        json={"login": target.account.login},
    )
    assert card_from(response).linked


async def _tag(
    stand: AccountStand, leader: SignInSession, note_id: UUID, card_id: UUID
) -> Note:
    return note_from(
        await stand.client.post(
            f"{NOTES}/{note_id}/tags",
            headers=bearer(leader),
            json={"target_id": str(card_id)},
        ),
        201,
    )


async def _archive(stand: AccountStand, leader: SignInSession, card_id: UUID) -> None:
    path = f"{CLIENTS}/{card_id}"
    headers = bearer(leader)
    response = await stand.client.get(f"{path}/archive-preview", headers=headers)
    assert response.status_code == 200, response.text
    preview = ClientArchivePreview.model_validate_json(response.content)
    archived = card_from(
        await stand.client.post(
            f"{path}/archive",
            headers=headers,
            json={"preview_token": preview.preview_token},
        )
    )
    assert archived.status == ClientCardStatus.ARCHIVED


def _taggable(response: Response) -> NoteTaggableList:
    assert response.status_code == 200, response.text
    return NoteTaggableList.model_validate_json(response.content)


def _client_notes(response: Response) -> ClientNoteList:
    assert response.status_code == 200, response.text
    return ClientNoteList.model_validate_json(response.content)


# spec:test note-sharing-tags#keep-tag-placed-standalone-card
# spec:test note-sharing-tags#open-received-note-read-only-recipient
# spec:test note-sharing-tags#list-screen-7-3-person-not-one
# spec:test note-sharing-tags#allow-tagging-archived-client-new
# spec:test note-sharing-tags#copy-private-client-card-fields
# spec:test note-sharing-tags#reveal-tagged-people-other-tagged
# spec:test note-sharing-tags#show-note-client-other-specialists
# spec:test note-sharing-tags#send-email-contacts-written-client
# spec:test note-sharing-tags#show-first-tag-warning-person-leader
# spec:test note-sharing-tags#offer-remove-access-author-taps-tagged
# spec:test note-editor#let-anyone-author-change-title
# spec:test notes-grid-folders#move-received-note-account-folders
# spec:test client-archive-restore#keep-note-tags-archived-active
async def test_tags_follow_links_revoke_access_and_keep_archived_notes_readable(
    account_stand: AccountStand, mail_outbox: list[EmailMessage]
) -> None:
    stand = account_stand
    leader = await stand.add_account("note_specialist")
    other_leader = await stand.add_account("other_specialist")
    first = await stand.add_account("first_recipient")
    second = await stand.add_account("second_recipient")
    for member in (leader, other_leader, second):
        await stand.activate(member)
    client, headers = stand.client, bearer(leader)
    first_card = await create_card(
        stand, leader, {"name": "First card", "email": "private-reference@example.com"}
    )
    second_card = await create_card(stand, leader, {"name": "Invisible to first"})
    unrelated = await create_card(
        stand, other_leader, {"name": "Another leader's card"}
    )
    await _link(stand, other_leader, unrelated.id, first)
    await _link(stand, leader, second_card.id, second)
    assert (
        await client.patch(
            f"{CLIENTS}/{first_card.id}",
            headers=headers,
            json={"request": "PRIVATE_REQUEST", "info": "PRIVATE_INFORMATION"},
        )
    ).status_code == 200
    folders = folders_from(await client.get(FOLDERS, headers=headers))
    folder_id = folders.items[0].id
    note = await post_note(
        stand,
        leader,
        {"title": "Exercises", "text": "Practice today", "folder_id": str(folder_id)},
    )
    url = f"{NOTES}/{note.id}"
    picker = _taggable(await client.get(f"{NOTES}/taggable", headers=headers)).items
    assert {(row.target_id, row.linked, row.tagged_before) for row in picker} == {
        (first_card.id, False, False),
        (second_card.id, True, False),
    }
    problem(
        await client.get(f"{NOTES}/taggable", headers=bearer(first)),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )
    problem(
        await client.post(
            f"{url}/tags", headers=headers, json={"target_id": str(unrelated.id)}
        ),
        404,
        ErrorCode.NOT_FOUND,
    )
    tagged = await _tag(stand, leader, note.id, first_card.id)
    assert len(tagged.tags) == 1 and not tagged.tags[0].linked
    problem(await client.get(url, headers=bearer(first)), 404, ErrorCode.NOT_FOUND)
    assert [notice.key for notice in await notices_for(stand, first)] == [
        NoticeKey.LINKED
    ]
    assert not mail_outbox

    await _link(stand, leader, first_card.id, first)
    first_before = await notices_for(stand, first)
    second_before = await notices_for(stand, second)
    tagged = await _tag(stand, leader, note.id, second_card.id)
    assert {tag.target_id for tag in tagged.tags} == {first_card.id, second_card.id}
    duplicate = await client.post(
        f"{url}/tags", headers=headers, json={"target_id": str(first_card.id)}
    )
    problem(duplicate, 409, ErrorCode.CONFLICT)
    for recipient in (first, second):
        response = await client.get(url, headers=bearer(recipient))
        published = note_from(response)
        assert published.shared_with_me and not published.can_edit
        assert published.author.id == leader.account.id
        assert (
            published.folder_id is None
            and published.tags == []
            and published.checked_items == []
        )
        for withheld in (
            "Invisible to first",
            "private-reference@example.com",
            "PRIVATE_REQUEST",
            "PRIVATE_INFORMATION",
        ):
            assert withheld not in response.text
        assert (
            str(folder_id) not in response.text
            and str(first_card.id) not in response.text
        )
        mine = notes_from(
            await client.get(
                NOTES, headers=bearer(recipient), params={"filter": "mine"}
            )
        )
        assert all(item.id != note.id for item in mine.items)
        shared = notes_from(
            await client.get(
                NOTES, headers=bearer(recipient), params={"filter": "shared"}
            )
        )
        assert [item.id for item in shared.items] == [note.id]
        search = notes_from(
            await client.get(
                NOTES,
                headers=bearer(recipient),
                params={"filter": "mine", "q": "practice TODAY"},
            )
        )
        assert [item.id for item in search.items] == [note.id]
    for invalid in (
        await client.patch(
            url, headers=bearer(first), json={"folder_id": str(folder_id)}
        ),
        await client.delete(url, headers=bearer(first)),
        await client.post(
            f"{url}/tags",
            headers=bearer(second),
            json={"target_id": str(second_card.id)},
        ),
    ):
        problem(invalid, 403, ErrorCode.NOTE_READ_ONLY)
    problem(
        await client.get(url, headers=bearer(other_leader)), 404, ErrorCode.NOT_FOUND
    )
    assert (
        _client_notes(
            await client.get(
                f"{CLIENTS}/{unrelated.id}/notes", headers=bearer(other_leader)
            )
        ).items
        == []
    )

    await _archive(stand, leader, first_card.id)
    owner = note_from(await client.get(url, headers=headers))
    assert {tag.target_id: tag.archived for tag in owner.tags} == {
        first_card.id: True,
        second_card.id: False,
    }
    assert note_from(await client.get(url, headers=bearer(first))).id == note.id
    assert [
        item.id
        for item in _client_notes(
            await client.get(f"{CLIENTS}/{first_card.id}/notes", headers=headers)
        ).items
    ] == [note.id]
    another = await post_note(stand, leader, {"text": "A new note"})
    problem(
        await client.post(
            f"{NOTES}/{another.id}/tags",
            headers=headers,
            json={"target_id": str(first_card.id)},
        ),
        409,
        ErrorCode.TAG_NOT_ALLOWED,
    )
    picker = _taggable(await client.get(f"{NOTES}/taggable", headers=headers)).items
    assert [(row.target_id, row.tagged_before) for row in picker] == [
        (second_card.id, True)
    ]

    tag_id = next(tag.id for tag in owner.tags if tag.target_id == second_card.id)
    assert (
        await client.delete(f"{url}/tags/{tag_id}", headers=headers)
    ).status_code == 204
    problem(await client.get(url, headers=bearer(second)), 404, ErrorCode.NOT_FOUND)
    assert note_from(await client.get(url, headers=bearer(first))).id == note.id
    assert (
        await client.post(f"{CLIENTS}/{first_card.id}/restore", headers=headers)
    ).status_code == 200
    assert (
        await client.delete(f"{CLIENTS}/{first_card.id}/link", headers=headers)
    ).status_code == 200
    problem(await client.get(url, headers=bearer(first)), 404, ErrorCode.NOT_FOUND)
    picker = _taggable(await client.get(f"{NOTES}/taggable", headers=headers)).items
    assert {row.target_id for row in picker if row.tagged_before} == {
        first_card.id,
        second_card.id,
    }
    assert not mail_outbox
    assert (await notices_for(stand, first)) == [
        notice
        for notice in first_before
        if notice.params.get("specialist_id") == str(other_leader.account.id)
    ]
    assert await notices_for(stand, second) == second_before


# spec:test note-sharing-tags#let-tagged-person-leader-non-leader
# spec:test note-sharing-tags#show-author-changes-tagged-person
@pytest.mark.parametrize("mark", [" ", "x"])
async def test_independent_checklist_ticks_follow_duplicate_lines_and_reject_stale_versions(
    account_stand: AccountStand, mark: str
) -> None:
    stand = account_stand
    leader = await stand.add_account("checklist_owner")
    tuesday = await stand.add_account("tuesday_recipient")
    monday = await stand.add_account("monday_recipient")
    for member in (leader, tuesday):
        await stand.activate(member)
    for member in (tuesday, monday):
        card = await create_card(stand, leader, {"name": member.account.login})
        await _link(stand, leader, card.id, member)
    client, headers = stand.client, bearer(leader)
    created = await post_note(
        stand, leader, {"text": "Monday\n- [ ] Call\nTuesday\n- [ ] Call"}
    )
    picker = _taggable(await client.get(f"{NOTES}/taggable", headers=headers)).items
    for row in picker:
        await _tag(stand, leader, created.id, row.target_id)
    path = f"{NOTES}/{created.id}"
    ticks = f"{path}/checklist-ticks"
    initial = note_from(await client.get(path, headers=bearer(tuesday)))
    assert initial.checked_items == []
    version = initial.updated_at.isoformat()
    payload = {
        "expected_updated_at": version,
        "expected_checked_items": [],
        "checked_items": [1, 99999],
    }
    problem(
        await client.put(ticks, headers=headers, json=payload), 403, ErrorCode.FORBIDDEN
    )
    for invalid in (
        {"checked_items": [0], "expected_checked_items": []},
        {"expected_updated_at": version, "checked_items": [0]},
        {**payload, "expected_updated_at": 0},
        {**payload, "checked_items": [0, 0]},
        {**payload, "checked_items": [-1]},
        {**payload, "checked_items": [True]},
        {**payload, "expected_checked_items": [0, 0]},
    ):
        assert (
            await client.put(ticks, headers=bearer(tuesday), json=invalid)
        ).status_code == 422
    ticked = note_from(await client.put(ticks, headers=bearer(tuesday), json=payload))
    assert ticked.checked_items == [1] and ticked.updated_at == initial.updated_at
    problem(
        await client.put(
            ticks, headers=bearer(tuesday), json={**payload, "checked_items": [0]}
        ),
        409,
        ErrorCode.CONFLICT,
    )
    replay = note_from(await client.put(ticks, headers=bearer(tuesday), json=payload))
    assert replay.checked_items == [1]
    assert note_from(await client.get(path, headers=bearer(monday))).checked_items == []
    second = note_from(
        await client.put(
            ticks,
            headers=bearer(monday),
            json={**payload, "checked_items": [0]},
        )
    )
    assert second.checked_items == [0]
    assert note_from(await client.get(path, headers=headers)).checked_items == []
    edited = note_from(
        await client.patch(
            path, headers=headers, json={"text": f"Monday\nTuesday\n- [{mark}] Call"}
        )
    )
    assert edited.updated_at > initial.updated_at
    assert note_from(await client.get(path, headers=bearer(tuesday))).checked_items == [
        0
    ]
    assert note_from(await client.get(path, headers=bearer(monday))).checked_items == []
    problem(
        await client.put(
            ticks, headers=bearer(tuesday), json={**payload, "checked_items": []}
        ),
        409,
        ErrorCode.CONFLICT,
    )
    next_edit = note_from(
        await client.patch(
            path,
            headers=headers,
            json={"text": "- [ ] Prepare\r\n\t- [X] Call\r\n- [ ] Send"},
        )
    )
    assert note_from(await client.get(path, headers=bearer(tuesday))).checked_items == [
        1
    ]
    reordered = note_from(
        await client.patch(
            path,
            headers=headers,
            json={"text": "- [ ] Send\n- [ ] Prepare\n\t- [X] Call"},
        )
    )
    assert reordered.updated_at > next_edit.updated_at
    assert note_from(await client.get(path, headers=bearer(tuesday))).checked_items == [
        2
    ]
    cleared = note_from(
        await client.put(
            ticks,
            headers=bearer(tuesday),
            json={
                "expected_updated_at": reordered.updated_at.isoformat(),
                "expected_checked_items": [2],
                "checked_items": [],
            },
        )
    )
    assert cleared.checked_items == [] and cleared.text == reordered.text


# spec:test note-sharing-tags#keep-reply-unchanged-note-answers
# spec:test client-card-view-edit#show-notes-block-3-latest
async def test_replies_are_keyed_visible_in_client_notes_and_obey_both_archive_guards(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    author = await stand.add_account("reply_author")
    recipient = await stand.add_account("reply_recipient")
    for member in (author, recipient):
        await stand.activate(member)
    card = await create_card(stand, author, {"name": "Client of author"})
    reverse = await create_card(stand, recipient, {"name": "Client of recipient"})
    await _link(stand, author, card.id, recipient)
    await _link(stand, recipient, reverse.id, author)
    sources = [
        await _tag(
            stand,
            author,
            (await post_note(stand, author, {"title": title})).id,
            card.id,
        )
        for title in ("Oldest", "Earlier", "Original")
    ]
    original = sources[-1]
    source_path = f"{NOTES}/{original.id}"
    path = f"{source_path}/replies"
    client, headers, other = stand.client, bearer(author), bearer(recipient)
    key = str(uuid7())
    keyed = {**other, "Idempotency-Key": key}
    note_from(
        await client.post(NOTES, headers=keyed, json={"title": "Separate operation"}),
        201,
    )
    body = {"text": "Reply to “Original”\nCompleted exercises."}
    problem(
        await client.post(path, headers=headers, json=body), 403, ErrorCode.FORBIDDEN
    )
    async with timeout(10):
        responses = await gather(
            client.post(path, headers=keyed, json=body),
            client.post(path, headers=keyed, json=body),
        )
    reply, replay = (note_from(response, 201) for response in responses)
    assert (
        reply == replay
        and reply.author.id == recipient.account.id
        and reply.text == body["text"]
    )
    assert (
        len(reply.tags) == 1 and reply.tags[0].target_kind == NoteTagTargetKind.ACCOUNT
    )
    assert reply.tags[0].target_id == author.account.id
    returned = note_from(await client.get(f"{NOTES}/{reply.id}", headers=headers))
    assert (
        returned.shared_with_me and returned.tags == [] and returned.folder_id is None
    )
    problem(
        await client.post(path, headers=keyed, json={"text": "Different"}),
        409,
        ErrorCode.CONFLICT,
    )
    problem(
        await client.post(f"{NOTES}/{sources[0].id}/replies", headers=keyed, json=body),
        409,
        ErrorCode.CONFLICT,
    )

    card_path = f"{CLIENTS}/{card.id}/notes"
    recent = _client_notes(await client.get(card_path, headers=headers))
    assert [item.id for item in recent.items] == [reply.id, original.id, sources[1].id]
    broader = notes_from(
        await client.get(NOTES, headers=headers, params={"client_id": str(card.id)})
    )
    assert [item.id for item in broader.items] == [
        reply.id,
        *(item.id for item in reversed(sources)),
    ]
    low_limit = _client_notes(
        await client.get(card_path, headers=headers, params={"limit": 1})
    )
    assert [item.id for item in low_limit.items] == [reply.id]
    assert (
        await client.get(card_path, headers=headers, params={"limit": 21})
    ).status_code == 422

    await _archive(stand, author, card.id)
    problem(
        await client.post(path, headers=other, json=body),
        409,
        ErrorCode.TAG_NOT_ALLOWED,
    )
    assert (
        note_from(await client.post(path, headers=keyed, json=body), 201).id == reply.id
    )
    assert [
        item.id
        for item in _client_notes(await client.get(card_path, headers=headers)).items
    ] == [item.id for item in recent.items]
    assert (
        await client.post(f"{CLIENTS}/{card.id}/restore", headers=headers)
    ).status_code == 200
    await _archive(stand, recipient, reverse.id)
    problem(
        await client.post(path, headers=other, json=body),
        409,
        ErrorCode.TAG_NOT_ALLOWED,
    )
    assert note_from(await client.get(source_path, headers=other)).id == original.id

    assert (await client.delete(source_path, headers=headers)).status_code == 204
    problem(await client.get(source_path, headers=other), 404, ErrorCode.NOT_FOUND)
    reply_path = f"{NOTES}/{reply.id}"
    assert note_from(await client.get(reply_path, headers=headers)).text == body["text"]
    assert (
        note_from(await client.post(path, headers=keyed, json=body), 201).id == reply.id
    )
    assert (await client.delete(reply_path, headers=other)).status_code == 204
    problem(await client.post(path, headers=keyed, json=body), 409, ErrorCode.CONFLICT)
