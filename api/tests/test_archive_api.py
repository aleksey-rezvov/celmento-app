from asyncio import gather, timeout
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID, uuid7
from zoneinfo import ZoneInfo

import pytest
from httpx import Response
from test_account import PNG, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, list_from, problem
from test_clients_balance import PAST, balance_from
from test_meeting_notifications import mail_outbox, notices_for, set_card_channels
from test_meetings_api import MEETINGS, meeting_from, post_meeting
from test_meetings_ledger import client_form

from celmento_api import emails
from celmento_api.models.enums import (
    ClientCardStatus,
    Currency,
    ErrorCode,
    MeetingStatus,
    NoticeKey,
)
from celmento_api.models.subscription import Subscription
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.meetings import ClientArchivePreview, ClientMeetingList
from celmento_api.schemas.money import Money

__all__: list[str] = ["account_stand", "mail_outbox"]


async def _preview(
    stand: AccountStand, leader: SignInSession, card_id: UUID
) -> ClientArchivePreview:
    response = await stand.client.get(
        f"{CLIENTS}/{card_id}/archive-preview", headers=bearer(leader)
    )
    assert response.status_code == 200, response.text
    return ClientArchivePreview.model_validate_json(response.content)


async def _archive(
    stand: AccountStand,
    leader: SignInSession,
    card_id: UUID,
    preview: ClientArchivePreview,
) -> Response:
    return await stand.client.post(
        f"{CLIENTS}/{card_id}/archive",
        headers=bearer(leader),
        json={"preview_token": preview.preview_token},
    )


# spec:test client-archive-restore#delete-listed-scheduled-meetings-move
# spec:test client-archive-restore#notify-deleted-scheduled-meeting
# spec:test client-archive-restore#keep-card-link-card-archived
# spec:test client-archive-restore#limit-how-many-times-client
# spec:test client-meeting-notifications#notify-client-scheduled-meeting-deleted
async def test_archive_removes_confirmed_meetings_and_retains_client_history(
    account_stand: AccountStand,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    leader = await account_stand.add_account("archive_owner")
    attendee = await account_stand.add_account("archive_attendee")
    await account_stand.activate(leader)
    client, headers = account_stand.client, bearer(leader)
    card = await create_card(account_stand, leader, {"name": "Store history"})
    given = "archive-recipient@example.com"
    await set_card_channels(account_stand, card.id, recipient=given, linked=attendee)
    path = f"{CLIENTS}/{card.id}"
    balance_from(
        await client.post(
            f"{path}/payments",
            headers=headers,
            json={"amount": "300.50", "date": PAST.isoformat()},
        ),
        201,
    )
    now = datetime.now(UTC).replace(microsecond=0)
    completed = await post_meeting(
        account_stand,
        leader,
        client_form(
            card.id,
            now - timedelta(days=2),
            outcome={"status": "completed", "actual_duration_minutes": 45},
        ),
    )
    earlier = await post_meeting(
        account_stand, leader, client_form(card.id, now - timedelta(days=1))
    )
    future = await post_meeting(
        account_stand, leader, client_form(card.id, now + timedelta(days=1))
    )
    ongoing = await post_meeting(
        account_stand, leader, client_form(card.id, now - timedelta(minutes=10))
    )

    deliveries: list[EmailMessage] = []

    def unavailable(message: EmailMessage) -> None:
        deliveries.append(message)
        error = f"Cannot deliver to {given}"
        raise OSError(error)

    monkeypatch.setattr(emails, "_deliver", unavailable)
    preview = await _preview(account_stand, leader, card.id)
    assert [meeting.id for meeting in preview.meetings_to_delete] == [
        ongoing.id,
        future.id,
    ]
    assert [meeting.id for meeting in preview.meetings_awaiting_outcome] == [earlier.id]
    assert preview.balance == Money(amount="200.25", currency=Currency.RUB)
    assert preview == await _preview(account_stand, leader, card.id)
    blocked = await client.post(
        f"{path}/archive", headers=headers, json={"preview_token": "0" * 64}
    )
    problem(blocked, 409, ErrorCode.OUTCOMES_PENDING)
    active = card_from(await client.get(path, headers=headers))
    assert active.status == ClientCardStatus.ACTIVE and active.linked
    assert not deliveries and not await notices_for(account_stand, attendee)
    assert (
        await client.get(f"{MEETINGS}/{future.id}", headers=headers)
    ).status_code == 200

    missed = meeting_from(
        await client.put(
            f"{MEETINGS}/{earlier.id}/outcome",
            headers=headers,
            json={"status": "not_taken_place", "charged": False},
        )
    )
    assert missed.status == MeetingStatus.NOT_TAKEN_PLACE
    ledger = balance_from(await client.get(f"{path}/balance", headers=headers))
    zone = ZoneInfo(leader.account.time_zone)
    date_before = datetime.now(zone).date()
    archived = card_from(await _archive(account_stand, leader, card.id, preview))
    assert archived.status == ClientCardStatus.ARCHIVED and archived.archived_at
    assert (
        date_before
        <= archived.archived_at.astimezone(zone).date()
        <= datetime.now(zone).date()
    )
    assert archived.link == active.link and archived.linked
    assert archived.completed_sessions == 1 and archived.completed_hours == 0.8
    assert archived.balance == ledger.balance
    assert (
        list_from(await client.get(CLIENTS, headers=headers)).plan.active_clients == 0
    )
    for deleted in (ongoing, future):
        problem(
            await client.get(f"{MEETINGS}/{deleted.id}", headers=headers),
            404,
            ErrorCode.NOT_FOUND,
        )
    assert [str(mail["To"]) for mail in deliveries] == [given, given]
    assert all("has been cancelled" in str(mail["Subject"]) for mail in deliveries)
    assert (
        "Transactional email handoff failed" in caplog.text and given not in caplog.text
    )
    notices = await notices_for(account_stand, attendee)
    assert len(notices) == 2 and {notice.key for notice in notices} == {
        NoticeKey.CANCELLED
    }
    assert {notice.params["starts_at"] for notice in notices} == {
        ongoing.starts_at.isoformat(),
        future.starts_at.isoformat(),
    }
    rows = await client.get(f"{path}/meetings", headers=headers)
    assert rows.status_code == 200
    meetings = ClientMeetingList.model_validate_json(rows.content)
    assert not meetings.upcoming
    assert [meeting.id for meeting in meetings.past] == [missed.id, completed.id]
    assert [meeting.status for meeting in meetings.past] == [
        MeetingStatus.NOT_TAKEN_PLACE,
        MeetingStatus.COMPLETED,
    ]
    assert all(
        meeting.client is not None and meeting.client.archived
        for meeting in meetings.past
    )
    retained = balance_from(await client.get(f"{path}/balance", headers=headers))
    assert retained.balance == ledger.balance
    assert retained.items == [
        entry.model_copy(update={"editable": False}) for entry in ledger.items
    ]
    problem(
        await _archive(account_stand, leader, card.id, preview),
        409,
        ErrorCode.CLIENT_ARCHIVED,
    )

    for _ in range(3):
        restored = card_from(await client.post(f"{path}/restore", headers=headers))
        assert (
            restored.status == ClientCardStatus.ACTIVE and restored.archived_at is None
        )
        assert restored.link == active.link and restored.balance == archived.balance
        assert (
            balance_from(await client.get(f"{path}/balance", headers=headers)) == ledger
        )
        problem(
            await client.post(f"{path}/restore", headers=headers),
            409,
            ErrorCode.CLIENT_NOT_ARCHIVED,
        )
        empty = await _preview(account_stand, leader, card.id)
        assert not empty.meetings_awaiting_outcome and not empty.meetings_to_delete
        assert card_from(await _archive(account_stand, leader, card.id, empty)).linked
    assert (
        await notices_for(account_stand, attendee) == notices and len(deliveries) == 2
    )


async def test_archive_requires_current_preview_and_scopes_all_operations(
    account_stand: AccountStand, mail_outbox: list[EmailMessage]
) -> None:
    leader = await account_stand.add_account("preview_owner")
    outsider = await account_stand.add_account("preview_other")
    attendee = await account_stand.add_account("preview_attendee")
    await account_stand.activate(leader)
    await account_stand.activate(outsider)
    client, headers = account_stand.client, bearer(leader)
    card = await create_card(account_stand, leader, {"name": "Preview"})
    other = await create_card(account_stand, leader, {"name": "Other"})
    await set_card_channels(
        account_stand, card.id, recipient="preview@example.com", linked=attendee
    )
    path = f"{CLIENTS}/{card.id}"
    current = await _preview(account_stand, leader, card.id)
    elsewhere = await _preview(account_stand, leader, other.id)
    assert current.preview_token != elsewhere.preview_token
    for suffix, method, json in (
        ("archive-preview", "GET", None),
        ("archive", "POST", {"preview_token": current.preview_token}),
        ("restore", "POST", None),
    ):
        url = f"{path}/{suffix}"
        problem(
            await client.request(method, url, json=json), 401, ErrorCode.UNAUTHORIZED
        )
        problem(
            await client.request(method, url, headers=bearer(attendee), json=json),
            403,
            ErrorCode.ACTIVATION_REQUIRED,
        )
        problem(
            await client.request(method, url, headers=bearer(outsider), json=json),
            404,
            ErrorCode.NOT_FOUND,
        )
        invalid = f"{CLIENTS}/non-uuid/{suffix}"
        assert (
            await client.request(method, invalid, headers=headers, json=json)
        ).status_code == 422
    for invalid_body in ({}, {"preview_token": ""}, {"preview_token": "A" * 64}):
        assert (
            await client.post(f"{path}/archive", headers=headers, json=invalid_body)
        ).status_code == 422
    problem(
        await _archive(account_stand, leader, card.id, elsewhere),
        409,
        ErrorCode.CONFLICT,
    )

    meeting = await post_meeting(
        account_stand,
        leader,
        client_form(card.id, datetime.now(UTC) + timedelta(days=1)),
    )
    problem(
        await _archive(account_stand, leader, card.id, current), 409, ErrorCode.CONFLICT
    )
    fresh = await _preview(account_stand, leader, card.id)
    assert [row.id for row in fresh.meetings_to_delete] == [meeting.id]
    meeting_path = f"{MEETINGS}/{meeting.id}"
    meeting_from(
        await client.patch(meeting_path, headers=headers, json={"duration_minutes": 75})
    )
    problem(
        await _archive(account_stand, leader, card.id, fresh), 409, ErrorCode.CONFLICT
    )
    changed = await _preview(account_stand, leader, card.id)
    assert changed.preview_token != fresh.preview_token
    assert changed.meetings_to_delete[0].duration_minutes == 75
    assert (
        meeting_from(await client.get(meeting_path, headers=headers)).duration_minutes
        == 75
    )
    assert (
        card_from(await client.get(path, headers=headers)).status
        == ClientCardStatus.ACTIVE
    )
    assert not await notices_for(account_stand, attendee) and not mail_outbox
    assert (
        card_from(await _archive(account_stand, leader, card.id, changed)).archived_at
        is not None
    )
    assert len(mail_outbox) == 1


async def test_archive_and_new_meeting_serialize_against_the_confirmed_list(
    account_stand: AccountStand, mail_outbox: list[EmailMessage]
) -> None:
    leader = await account_stand.add_account("schedule_race")
    attendee = await account_stand.add_account("schedule_attendee")
    await account_stand.activate(leader)
    client, headers = account_stand.client, bearer(leader)
    card = await create_card(account_stand, leader, {"name": "Race"})
    await set_card_channels(account_stand, card.id, linked=attendee)
    start = datetime.now(UTC) + timedelta(days=1)
    previous = await post_meeting(account_stand, leader, client_form(card.id, start))
    preview = await _preview(account_stand, leader, card.id)
    async with timeout(10):
        archive, create = await gather(
            _archive(account_stand, leader, card.id, preview),
            client.post(
                MEETINGS,
                headers=headers,
                json=client_form(card.id, start + timedelta(days=1)),
            ),
        )
    notices = await notices_for(account_stand, attendee)
    prior = await client.get(f"{MEETINGS}/{previous.id}", headers=headers)
    if archive.status_code == 200:
        assert card_from(archive).status == ClientCardStatus.ARCHIVED
        problem(create, 409, ErrorCode.MEETING_CLIENT_ARCHIVED)
        problem(prior, 404, ErrorCode.NOT_FOUND)
        assert len(notices) == 1 and notices[0].key == NoticeKey.CANCELLED
    else:
        problem(archive, 409, ErrorCode.CONFLICT)
        inserted = meeting_from(create, 201)
        assert meeting_from(prior).id == previous.id
        fresh = await _preview(account_stand, leader, card.id)
        assert [meeting.id for meeting in fresh.meetings_to_delete] == [
            previous.id,
            inserted.id,
        ]
        assert not notices
    assert not mail_outbox


async def test_restore_and_creation_share_the_cap_and_subscription_lifts_it(
    account_stand: AccountStand,
) -> None:
    leader = await account_stand.add_account("restore_owner")
    await account_stand.activate(leader)
    client, headers = account_stand.client, bearer(leader)
    card = await create_card(account_stand, leader, {"name": "Restore me"})
    for name in ("Retained A", "Retained B"):
        await create_card(account_stand, leader, {"name": name})
    preview = await _preview(account_stand, leader, card.id)
    assert card_from(
        await _archive(account_stand, leader, card.id, preview)
    ).archived_at
    assert (
        list_from(await client.get(CLIENTS, headers=headers)).plan.active_clients == 2
    )
    restore_path = f"{CLIENTS}/{card.id}/restore"
    async with timeout(10):
        restore, create = await gather(
            client.post(restore_path, headers=headers),
            client.post(CLIENTS, headers=headers, json={"name": "Last place"}),
        )
    assert (
        list_from(await client.get(CLIENTS, headers=headers)).plan.active_clients == 3
    )
    if restore.status_code == 200:
        assert card_from(restore).status == ClientCardStatus.ACTIVE
        problem(create, 409, ErrorCode.CLIENT_LIMIT_REACHED)
        assert card_from(
            await _archive(account_stand, leader, card.id, preview)
        ).archived_at
        await create_card(account_stand, leader, {"name": "New active card"})
    else:
        problem(restore, 409, ErrorCode.CLIENT_LIMIT_REACHED)
        assert card_from(create, 201).status == ClientCardStatus.ACTIVE
    problem(
        await client.post(restore_path, headers=headers),
        409,
        ErrorCode.CLIENT_LIMIT_REACHED,
    )
    still_archived = card_from(
        await client.get(f"{CLIENTS}/{card.id}", headers=headers)
    )
    assert still_archived.status == ClientCardStatus.ARCHIVED
    async with account_stand.session() as session:
        session.add(
            Subscription(
                account_id=leader.account.id,
                until=datetime.now(UTC).date() + timedelta(days=30),
                granted_by="test",
            )
        )
        await session.commit()
    assert (
        card_from(await client.post(restore_path, headers=headers)).status
        == ClientCardStatus.ACTIVE
    )
    assert (
        list_from(await client.get(CLIENTS, headers=headers)).plan.active_clients == 4
    )


async def test_archived_card_and_historical_finances_are_read_only(
    account_stand: AccountStand, mail_outbox: list[EmailMessage]
) -> None:
    leader = await account_stand.add_account("archive_history")
    attendee = await account_stand.add_account("history_attendee")
    await account_stand.activate(leader)
    client, headers = account_stand.client, bearer(leader)
    card = await create_card(account_stand, leader, {"name": "History"})
    await set_card_channels(
        account_stand, card.id, linked=attendee, recipient="history@example.com"
    )
    path = f"{CLIENTS}/{card.id}"
    upload = {"file": ("retained.png", PNG, "image/png")}
    assert (
        await client.put(f"{path}/photo", headers=headers, files=upload)
    ).status_code == 200
    posted_at = datetime(2025, 4, 23, 11, tzinfo=UTC)
    meeting = await post_meeting(
        account_stand,
        leader,
        client_form(
            card.id,
            posted_at,
            outcome={"status": "completed", "actual_duration_minutes": 45},
        ),
    )
    payment_body = {"amount": "200.25", "date": PAST.isoformat()}
    keyed = {**headers, "Idempotency-Key": str(uuid7())}
    payments = f"{path}/payments"
    before = balance_from(
        await client.post(payments, headers=keyed, json=payment_body), 201
    )
    payment_id = next(item.id for item in before.items if not item.created_by_system)
    payment_path = f"{payments}/{payment_id}"
    preview = await _preview(account_stand, leader, card.id)
    assert card_from(
        await _archive(account_stand, leader, card.id, preview)
    ).archived_at
    ledger = balance_from(
        await client.post(payments, headers=keyed, json=payment_body), 201
    )
    assert ledger.balance == before.balance
    assert ledger.items == [
        item.model_copy(update={"editable": False}) for item in before.items
    ]
    assert (await client.get(f"{path}/photo", headers=headers)).content == PNG
    for response in (
        await client.patch(path, headers=headers, json={"name": "New name"}),
        await client.put(f"{path}/photo", headers=headers, files=upload),
        await client.delete(f"{path}/photo", headers=headers),
        await client.put(
            f"{path}/link", headers=headers, json={"login": attendee.account.login}
        ),
        await client.delete(f"{path}/link", headers=headers),
        await client.post(payments, headers=headers, json=payment_body),
        await client.patch(payment_path, headers=headers, json={"amount": "100"}),
        await client.delete(payment_path, headers=headers),
    ):
        problem(response, 409, ErrorCode.CLIENT_ARCHIVED)
    meeting_path = f"{MEETINGS}/{meeting.id}"
    for response in (
        await client.post(
            MEETINGS, headers=headers, json=client_form(card.id, posted_at)
        ),
        await client.patch(meeting_path, headers=headers, json={"price": "100.26"}),
        await client.patch(meeting_path, headers=headers, json={"currency": "EUR"}),
        await client.patch(
            meeting_path, headers=headers, json={"payment_type": "barter"}
        ),
        await client.patch(
            meeting_path,
            headers=headers,
            json={"starts_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()},
        ),
        await client.put(
            f"{meeting_path}/outcome",
            headers=headers,
            json={"status": "not_taken_place", "charged": False},
        ),
        await client.delete(meeting_path, headers=headers, params={"refund": "true"}),
    ):
        problem(response, 409, ErrorCode.MEETING_CLIENT_ARCHIVED)

    revised_at = posted_at - timedelta(hours=5)
    updated = meeting_from(
        await client.patch(
            meeting_path,
            headers=headers,
            json={
                "client_id": str(card.id),
                "price": "0100.25",
                "currency": "RUB",
                "payment_type": "paid",
                "comment": "A correction to the venue",
                "starts_at": revised_at.isoformat(),
                "place": "in_person",
                "address": "Studio",
                "duration_minutes": 90,
            },
        )
    )
    assert updated.starts_at == revised_at and updated.address == "Studio"
    assert updated.duration_minutes == 90 and updated.actual_duration_minutes == 45
    assert updated.status == MeetingStatus.COMPLETED and updated.price == meeting.price
    assert updated.balance_charge == meeting.balance_charge
    assert updated.client is not None and updated.client.archived
    assert balance_from(await client.get(f"{path}/balance", headers=headers)) == ledger
    assert not await notices_for(account_stand, attendee) and not mail_outbox
