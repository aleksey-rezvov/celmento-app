from asyncio import gather, timeout
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import pytest
from sqlalchemy import select
from test_account import ACCOUNT, AccountStand, account_stand
from test_admin_api import ADMIN, JOURNAL, RESERVED, admin_access, admin_result
from test_clients_api import bearer, problem
from test_meeting_notifications import mail_outbox
from test_notes_api import FOLDERS, NOTES, folders_from, note_from, notes_from
from test_public_bookings import (
    BOOKING_NOW,
    BOOKINGS,
    booking_form,
    booking_from,
    freeze_booking_time,
)
from test_specialists_api import validation_problem

from celmento_api.models.enums import (
    AdminAction,
    ErrorCode,
    LegalDocumentKind,
    LoginAvailabilityStatus,
)
from celmento_api.models.legal import Acceptance, LegalDocumentVersion
from celmento_api.schemas.account import Account as AccountView
from celmento_api.schemas.admin import (
    AdminJournalList,
    AdminLegalDocumentVersion,
    AdminPreseededNotesSet,
    AdminReservedLoginWordList,
)
from celmento_api.schemas.auth import LoginAvailability
from celmento_api.schemas.documents import LegalDocument
from celmento_api.seed import seed

__all__: list[str] = ["account_stand", "mail_outbox"]


# spec:test admin-content-and-access#accept-new-version-document-contour
# spec:test admin-content-and-access#make-new-version-one-legal-documents
# spec:test admin-content-and-access#keep-earlier-version-number-texts
async def test_numbered_legal_versions_stay_current_after_a_later_draft_and_reject_stale_guest_terms(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stand = account_stand
    lead = await stand.add_account("legal_publication_owner")
    await stand.activate(lead)
    client = stand.client
    _, headers = await admin_access(stand)
    kind = LegalDocumentKind.TERMS_OF_USE.value
    public_path = f"/api/v1/documents/{kind}"
    publish = f"{ADMIN}/legal-documents/{kind}/versions"
    en = {"language": "en"}
    ru = {"language": "ru"}
    draft = admin_result(await client.get(public_path, params=en), LegalDocument)
    draft_ru = admin_result(await client.get(public_path, params=ru), LegalDocument)
    freeze_booking_time(monkeypatch)
    start = BOOKING_NOW + timedelta(hours=3)
    stale = await booking_form(stand, lead, start, email="guest-terms@example.com")
    validation_problem(
        await client.post(
            publish,
            headers=headers,
            json={"text_ru": "   ", "text_en": "**Good English**"},
        ),
        "body",
        "value_error",
    )
    first = admin_result(
        await client.post(
            publish,
            headers=headers,
            json={"text_ru": "**Версия один**", "text_en": "**Version one**"},
        ),
        AdminLegalDocumentVersion,
        201,
    )
    assert first.contour == stand.settings.contour and first.version == "1"
    current_ru = admin_result(await client.get(public_path, params=ru), LegalDocument)
    current_en = admin_result(await client.get(public_path, params=en), LegalDocument)
    assert current_ru.version == current_en.version == first.version
    assert current_ru.text == "**Версия один**" and current_en.text == "**Version one**"
    assert current_en.title == draft.title
    async with stand.session() as session:
        session.add(
            LegalDocumentVersion(
                document=kind,
                version="9.0-draft",
                title_ru="Проект",
                title_en="Future draft",
                text_ru="Не опубликовано",
                text_en="Not published",
                uploaded_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
        await session.commit()
    assert (
        admin_result(await client.get(public_path, params=en), LegalDocument)
        == current_en
    )
    second_payload = {"text_ru": "Второй текст", "text_en": "Second text"}
    third_payload = {"text_ru": "Третий текст", "text_en": "Third text"}
    async with timeout(10):
        responses = await gather(
            *(
                client.post(publish, headers=headers, json=body)
                for body in (second_payload, third_payload)
            )
        )
    latest = [
        admin_result(response, AdminLegalDocumentVersion, 201) for response in responses
    ]
    assert {row.version for row in latest} == {"2", "3"}
    winner = (second_payload, third_payload)[
        next(index for index, row in enumerate(latest) if row.version == "3")
    ]
    final_en = admin_result(await client.get(public_path, params=en), LegalDocument)
    assert final_en.version == "3" and final_en.text == winner["text_en"]
    prior_en = admin_result(
        await client.get(public_path, params={**en, "version": draft.version}),
        LegalDocument,
    )
    prior_ru = admin_result(
        await client.get(public_path, params={**ru, "version": draft.version}),
        LegalDocument,
    )
    assert prior_en == draft and prior_ru == draft_ru
    assert prior_en.uploaded_at == prior_ru.uploaded_at < final_en.uploaded_at
    problem(
        await client.get(public_path, params={**en, "version": "missing"}),
        404,
        ErrorCode.NOT_FOUND,
    )
    problem(await client.post(BOOKINGS, json=stale), 400, ErrorCode.CONSENT_REQUIRED)
    assert mail_outbox == []
    form = await booking_form(stand, lead, start, email="guest-terms@example.com")
    booking_from(await client.post(BOOKINGS, json=form))
    assert len(mail_outbox) == 1
    async with stand.session() as session:
        existing = await session.scalar(
            select(LegalDocumentVersion).where(
                LegalDocumentVersion.document == kind,
                LegalDocumentVersion.version == draft.version,
            )
        )
        assert existing is not None and existing.text_en == draft.text
        assert existing.uploaded_at < first.uploaded_at
        guest_acceptances = list(
            await session.scalars(
                select(Acceptance).where(Acceptance.guest_booking_id.is_not(None))
            )
        )
        terms = next(row for row in guest_acceptances if row.kind == kind)
        assert terms.version == "3" and terms.guest_client_card_id is not None
    audit = await client.get(JOURNAL, headers=headers)
    entries = admin_result(audit, AdminJournalList).items
    changes = [
        row
        for row in entries
        if row.action == AdminAction.UPLOAD_LEGAL_DOCUMENT_VERSION
    ]
    assert [(row.before, row.after) for row in changes] == [
        ({"version": "2"}, {"version": "3"}),
        ({"version": "1"}, {"version": "2"}),
        ({"version": draft.version}, {"version": "1"}),
    ]
    assert final_en.text not in audit.text and "guest-terms" not in audit.text


# spec:test admin-content-and-access#show-preseeded-notes-set-request
# spec:test admin-content-and-access#let-administrator-change-add-delete
# spec:test admin-content-and-access#keep-set-language-folders-notes
# spec:test admin-content-and-access#apply-changed-set-only-accounts
# spec:test admin-content-and-access#change-copies-preseeded-notes-created
async def test_preseeded_replacement_checks_version_and_only_changes_future_activations(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    previous = await stand.add_account("existing_template_owner")
    future = await stand.add_account("future_template_owner")
    await stand.activate(previous)
    client = stand.client
    _, admin = await admin_access(stand)
    en_path, ru_path = f"{ADMIN}/preseeded-notes/en", f"{ADMIN}/preseeded-notes/ru"
    current = admin_result(
        await client.get(en_path, headers=admin), AdminPreseededNotesSet
    )
    russian = admin_result(
        await client.get(ru_path, headers=admin), AdminPreseededNotesSet
    )
    assert current.version == russian.version == 1 and current.notes and russian.notes
    old_copy = notes_from(await client.get(NOTES, headers=bearer(previous))).items[0]
    edited = note_from(
        await client.patch(
            f"{NOTES}/{old_copy.id}",
            headers=bearer(previous),
            json={"title": "My private edited note"},
        )
    )
    old_notes = notes_from(await client.get(NOTES, headers=bearer(previous)))
    new_body = {
        "folders": [{"key": "reference", "name": "Reference", "color": "pink"}],
        "notes": [
            {
                "folder": "reference",
                "title": "New default note",
                "text": "Public template",
            },
            {"folder": None, "title": "New root note", "text": "- [ ] Practice"},
        ],
    }
    validation_problem(
        await client.put(
            en_path,
            headers=admin,
            params={"expected_version": "1"},
            json={
                **new_body,
                "notes": [{"folder": "missing", "title": "Invalid", "text": ""}],
            },
        ),
        "body",
        "value_error",
    )
    saved = admin_result(
        await client.put(
            en_path, headers=admin, params={"expected_version": "1"}, json=new_body
        ),
        AdminPreseededNotesSet,
    )
    assert saved.version == 2
    assert saved.model_dump(mode="json", exclude={"language", "version"}) == new_body
    problem(
        await client.put(
            en_path,
            headers=admin,
            params={"expected_version": "1"},
            json={"folders": [], "notes": []},
        ),
        409,
        ErrorCode.CONFLICT,
    )
    async with stand.session() as session:
        await seed(session, draft_documents=True)
    assert (
        admin_result(await client.get(en_path, headers=admin), AdminPreseededNotesSet)
        == saved
    )
    assert (
        admin_result(await client.get(ru_path, headers=admin), AdminPreseededNotesSet)
        == russian
    )
    await stand.activate(future)
    future_headers = bearer(future)
    roots = notes_from(await client.get(NOTES, headers=future_headers)).items
    assert [(row.title, row.text, row.folder_id) for row in roots] == [
        ("New root note", "- [ ] Practice", None),
    ]
    folders = folders_from(await client.get(FOLDERS, headers=future_headers)).items
    assert [folder.name for folder in folders] == ["Reference"]
    folder = folders[0]
    nested = notes_from(
        await client.get(
            NOTES, headers=future_headers, params={"folder_id": str(folder.id)}
        )
    ).items
    assert [(row.title, row.text, row.folder_id) for row in nested] == [
        ("New default note", "Public template", folder.id),
    ]
    assert notes_from(await client.get(NOTES, headers=bearer(previous))) == old_notes
    audit = await client.get(JOURNAL, headers=admin)
    entries = admin_result(audit, AdminJournalList).items
    changes = [
        row for row in entries if row.action == AdminAction.REPLACE_PRESEEDED_NOTES
    ]
    assert len(changes) == 1
    assert changes[0].before == current.model_dump(mode="json") and changes[
        0
    ].after == saved.model_dump(mode="json")
    assert edited.title not in audit.text


# spec:test admin-content-and-access#show-reserved-login-words-list
# spec:test admin-content-and-access#add-word-reserved-login-words
# spec:test admin-content-and-access#refuse-login-only-starts-ends
# spec:test admin-content-and-access#change-free-existing-login-reserved
# spec:test booking-link-login#change-free-existing-login-administrator
async def test_admin_reservation_matches_only_new_whole_logins_and_keeps_existing_owner(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("reserved_owner")
    other = await stand.add_account("reserve_attempt")
    client = stand.client
    _, admin = await admin_access(stand)
    before = admin_result(
        await client.get(RESERVED, headers=admin), AdminReservedLoginWordList
    )
    assert {"meet", "register", "support"} <= set(before.items)
    word = owner.account.login
    result = admin_result(
        await client.post(RESERVED, headers=admin, json={"word": word}),
        AdminReservedLoginWordList,
        201,
    )
    assert result.items == sorted([*before.items, word])
    problem(
        await client.post(RESERVED, headers=admin, json={"word": word}),
        409,
        ErrorCode.CONFLICT,
    )
    own = admin_result(
        await client.patch(
            ACCOUNT, headers=bearer(owner), json={"login": word.upper()}
        ),
        AccountView,
    )
    assert own.login == word and own.id == owner.account.id
    refused = admin_result(
        await client.get(
            f"{ACCOUNT}/login-availability",
            headers=bearer(other),
            params={"login": word.upper()},
        ),
        LoginAvailability,
    )
    assert refused.status == LoginAvailabilityStatus.RESERVED
    problem(
        await client.patch(
            ACCOUNT, headers=bearer(other), json={"login": word.upper()}
        ),
        400,
        ErrorCode.LOGIN_RESERVED,
    )
    longer = f"pre_{word}_post"
    updated = admin_result(
        await client.patch(ACCOUNT, headers=bearer(other), json={"login": longer}),
        AccountView,
    )
    assert updated.login == longer
    audit = admin_result(await client.get(JOURNAL, headers=admin), AdminJournalList)
    changes = [
        row for row in audit.items if row.action == AdminAction.ADD_RESERVED_LOGIN_WORD
    ]
    assert len(changes) == 1 and changes[0].after == {"word": word}
