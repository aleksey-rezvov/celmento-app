from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import yaml
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import bearer
from test_notes_api import FOLDERS, NOTES, folders_from, notes_from, post_note

from celmento_api.models.account import Account
from celmento_api.models.enums import FolderColor, Language
from celmento_api.models.leader import LeaderProfile
from celmento_api.models.preseeded import PreseededNoteSet
from celmento_api.schemas.notes import PreseededNotesAsset
from celmento_api.seed import seed

__all__: list[str] = ["account_stand"]


def _asset(language: Language) -> PreseededNotesAsset:
    filename = f"preseeded-notes.{language.value}.yaml"
    path = (
        Path(__file__).resolve().parents[1]
        / "src"
        / "celmento_api"
        / "content"
        / filename
    )
    value: object = yaml.safe_load(path.read_text(encoding="utf-8"))
    return PreseededNotesAsset.model_validate(value)


# spec:test client-leading-activation#create-preseeded-notes-moment-activation
# spec:test preseeded-notes#create-preseeded-set-moment-activation
# spec:test preseeded-notes#create-set-account-interface-language
# spec:test preseeded-notes#create-exactly-composition-note-how
# spec:test preseeded-notes#create-folders-order-practice
# spec:test preseeded-notes#take-folder-name-title-text
# spec:test preseeded-notes#create-notes-folders-leader-private
# spec:test preseeded-notes#create-set-account-without-activation
@pytest.mark.parametrize("language", list(Language))
async def test_activation_copies_exact_localized_templates_as_private_notes(
    account_stand: AccountStand, language: Language
) -> None:
    account = await account_stand.add_account("template_activation")
    outsider = await account_stand.add_account("no_templates")
    client, headers = account_stand.client, bearer(account)
    changed = await client.patch(
        ACCOUNT, headers=headers, json={"language": language.value}
    )
    assert changed.status_code == 200, changed.text
    assert notes_from(await client.get(NOTES, headers=headers)).total == 0
    assert folders_from(await client.get(FOLDERS, headers=headers)).items == []
    assert (await account_stand.activate(account)).activated

    expected = _asset(language)
    folders = folders_from(await client.get(FOLDERS, headers=headers)).items
    assert len(folders) == 3
    assert [item.name for item in folders] == [item.name for item in expected.folders]
    assert [item.color for item in folders] == [
        FolderColor.BLUE,
        FolderColor.GREEN,
        FolderColor.PEACH,
    ]
    root = notes_from(await client.get(NOTES, headers=headers))
    assert root.total == 7 and len(root.items) == 1
    created = list(root.items)
    for folder in folders:
        response = notes_from(
            await client.get(
                NOTES, headers=headers, params={"folder_id": str(folder.id)}
            )
        )
        assert response.total == 7
        created.extend(response.items)
    assert len(created) == 7
    folder_ids = {
        item.key: saved.id
        for item, saved in zip(expected.folders, folders, strict=True)
    }
    assert {note.title: (note.text, note.folder_id) for note in created} == {
        note.title: (
            note.text,
            folder_ids[note.folder] if note.folder is not None else None,
        )
        for note in expected.notes
    }
    assert all(
        note.can_edit
        and not note.shared_with_me
        and not note.tags
        and note.author.id == account.account.id
        for note in created
    )
    books = next(note for note in created if note.text.count("- [x] ") == 2)
    checklist = [line[:5] for line in books.text.splitlines() if line.startswith("- [")]
    assert checklist == ["- [x]"] * 2 + ["- [ ]"] * 5
    assert notes_from(await client.get(NOTES, headers=bearer(outsider))).total == 0
    assert folders_from(await client.get(FOLDERS, headers=bearer(outsider))).items == []
    async with account_stand.session() as session:
        profile = await session.get(LeaderProfile, account.account.id)
        assert profile is not None and profile.preseeded_notes_version == 1


# spec:test preseeded-notes#create-set-second-time-account
async def test_seed_upgrades_legacy_once_and_preserves_administrator_templates(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    legacy = await stand.add_account("pre_upgrade_specialist")
    newcomer = await stand.add_account("post_override_specialist")
    inactive = await stand.add_account("non_leader_never_seeded")
    original = await post_note(
        stand, legacy, {"title": "My existing note", "text": "Keep me"}
    )
    override: dict[str, object] = {
        "folders": [{"key": "custom", "name": "Admin folder", "color": "pink"}],
        "notes": [
            {"folder": "custom", "title": "Admin note", "text": "Version 2 contents"}
        ],
    }
    async with stand.session() as session:
        account = await session.get(Account, legacy.account.id)
        assert account is not None
        account.activated_at = datetime.now(UTC) - timedelta(days=14)
        session.add(
            LeaderProfile(account_id=account.account_id, contact_email=account.email)
        )
        english = await session.get(PreseededNoteSet, Language.EN.value)
        russian = await session.get(PreseededNoteSet, Language.RU.value)
        assert english is not None and russian is not None
        english.content, english.version = override, 2
        russian.content = {"folders": [], "notes": []}
        override_timestamp = english.updated_at
        stale_timestamp = russian.updated_at
        await session.commit()
    async with stand.session() as session:
        await seed(session)
    async with stand.session() as session:
        english = await session.get(PreseededNoteSet, Language.EN.value)
        russian = await session.get(PreseededNoteSet, Language.RU.value)
        assert english is not None and russian is not None
        assert english.version == 2 and english.content == override
        assert english.updated_at == override_timestamp
        expected = _asset(Language.RU)
        assert russian.version == 2
        assert russian.content == expected.model_dump(mode="json", exclude={"language"})
        assert russian.updated_at > stale_timestamp
        repaired_timestamp = russian.updated_at
        legacy_profile = await session.get(LeaderProfile, legacy.account.id)
        assert (
            legacy_profile is not None and legacy_profile.preseeded_notes_version == 1
        )

    client, headers = stand.client, bearer(legacy)
    copied = notes_from(await client.get(NOTES, headers=headers))
    assert copied.total == 8
    assert len(copied.items) == 2
    assert {item.title for item in copied.items} == {original.title, "How to use notes"}
    introductory = next(item for item in copied.items if item.id != original.id)
    assert len(folders_from(await client.get(FOLDERS, headers=headers)).items) == 3
    assert (
        await client.delete(f"{NOTES}/{introductory.id}", headers=headers)
    ).status_code == 204
    assert (
        await client.patch(ACCOUNT, headers=headers, json={"language": "ru"})
    ).status_code == 200

    await stand.activate(newcomer)
    new_headers = bearer(newcomer)
    template_folders = folders_from(
        await client.get(FOLDERS, headers=new_headers)
    ).items
    assert [item.name for item in template_folders] == ["Admin folder"]
    new_notes = notes_from(
        await client.get(
            NOTES,
            headers=new_headers,
            params={"folder_id": str(template_folders[0].id)},
        )
    )
    assert new_notes.total == 1 and [item.title for item in new_notes.items] == [
        "Admin note"
    ]
    async with stand.session() as session:
        await seed(session)
    async with stand.session() as session:
        russian = await session.get(PreseededNoteSet, Language.RU.value)
        english = await session.get(PreseededNoteSet, Language.EN.value)
        assert russian is not None and russian.updated_at == repaired_timestamp
        assert english is not None and english.updated_at == override_timestamp
        profile = await session.get(LeaderProfile, newcomer.account.id)
        assert profile is not None and profile.preseeded_notes_version == 2
    retained = notes_from(await client.get(NOTES, headers=headers))
    assert retained.total == 7 and retained.items == [original]
    assert notes_from(await client.get(NOTES, headers=bearer(inactive))).total == 0
