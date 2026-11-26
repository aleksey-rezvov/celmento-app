from asyncio import Barrier, Event, TaskGroup, gather, timeout
from datetime import timedelta
from decimal import Decimal
from email.message import EmailMessage
from uuid import UUID, uuid7

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, list_from, problem
from test_meeting_notifications import mail_outbox, notices_for, set_card_channels
from test_meetings_api import MEETINGS, meeting_from
from test_public_bookings import BOOKING_NOW, PUBLIC, FrozenTime, freeze_booking_time
from test_specialists_api import (
    ATTENDED,
    SPECIALISTS,
    archive_card,
    attended_from,
    link_card,
    specialist_from,
    validation_problem,
)

from celmento_api.models.account import Account
from celmento_api.models.enums import (
    Currency,
    ErrorCode,
    MeetingPlace,
    MeetingSource,
    MeetingStatus,
    NoticeKey,
    SessionFormat,
)
from celmento_api.models.legal import Acceptance
from celmento_api.models.meeting import Meeting, MeetingCreateReceipt
from celmento_api.routers import specialists
from celmento_api.schemas.meetings import MeetingList
from celmento_api.schemas.money import Money
from celmento_api.schemas.public import BookingSlotList
from celmento_api.services import app_bookings
from celmento_api.services.limit import FREE_PLAN_LIMIT

__all__: list[str] = ["account_stand", "mail_outbox"]

BOOKINGS: str = "/api/v1/bookings"
DAY: dict[str, str] = {"from": "2030-01-07", "to": "2030-01-07"}


def _freeze_app_booking(monkeypatch: pytest.MonkeyPatch) -> None:
    freeze_booking_time(monkeypatch)
    clock = FrozenTime(BOOKING_NOW)
    monkeypatch.setattr(specialists, "datetime", clock)
    monkeypatch.setattr(app_bookings, "datetime", clock)


# spec:test client-app-booking#offer-booking-account-linked-card
# spec:test client-app-booking#ask-no-name-email-contact
# spec:test client-app-booking#create-scheduled-individual-client
# spec:test client-app-booking#apply-free-plan-client-limit-since
# spec:test client-app-booking#send-email-booking-made-app
# spec:test client-app-booking#create-second-client-card-change
async def test_app_booking_uses_shared_slots_and_keeps_linked_card_unchanged_at_limit(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _freeze_app_booking(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("app_booking_specialist")
    attendee = await stand.add_account("app_booking_client")
    await stand.activate(leader)
    client, owner, headers = stand.client, bearer(leader), bearer(attendee)
    specialist = f"{SPECIALISTS}/{leader.account.id}"
    assert (
        await client.patch(
            ACCOUNT,
            headers=owner,
            json={
                "leader": {
                    "session_format": "both",
                    "session_duration_minutes": 45,
                    "default_meeting_link": "https://studio.example.com/call",
                }
            },
        )
    ).status_code == 200
    card = await create_card(
        stand,
        leader,
        {"name": "Retained card", "rate": "195.23", "currency": "USD"},
    )
    await set_card_channels(stand, card.id, recipient="preserve-self-given@example.com")
    await link_card(stand, leader, card.id, attendee)
    for index in range(FREE_PLAN_LIMIT - 1):
        await create_card(stand, leader, {"name": f"Unrelated client {index}"})
    assert (
        list_from(await client.get(CLIENTS, headers=owner)).plan.active_clients
        == FREE_PLAN_LIMIT
    )
    before = card_from(await client.get(f"{CLIENTS}/{card.id}", headers=owner))

    slots = await client.get(f"{specialist}/slots", headers=headers, params=DAY)
    public = await client.get(
        f"{PUBLIC}/specialists/{leader.account.login}/slots",
        params={**DAY, "time_zone": attendee.account.time_zone},
    )
    assert slots.status_code == public.status_code == 200
    assert slots.headers["Cache-Control"] == "no-store"
    assert BookingSlotList.model_validate_json(
        slots.content
    ) == BookingSlotList.model_validate_json(public.content)
    validation_problem(
        await client.get(
            f"{specialist}/slots",
            headers=headers,
            params={**DAY, "time_zone": "nowhere"},
        ),
        "query",
        "value_error",
    )
    start = BOOKING_NOW + timedelta(hours=3)
    body = {"specialist_id": str(leader.account.id), "starts_at": start.isoformat()}
    validation_problem(
        await client.post(BOOKINGS, headers=headers, json=body), "body", "value_error"
    )
    full = {**body, "place": "online", "comment": "Follow up next time"}
    validation_problem(
        await client.post(
            BOOKINGS, headers=headers, json={**full, "email": attendee.account.email}
        ),
        "body",
        "extra_forbidden",
    )
    problem(
        await client.post(
            BOOKINGS,
            headers=headers,
            json={**full, "starts_at": (start + timedelta(seconds=1)).isoformat()},
        ),
        409,
        ErrorCode.SLOT_INVALID,
    )
    keyed = {**headers, "Idempotency-Key": str(uuid7())}
    booked = attended_from(await client.post(BOOKINGS, headers=keyed, json=full), 201)
    assert booked.starts_at == start and booked.duration_minutes == 45
    assert booked.price == Money(amount="195.23", currency=Currency.USD)
    assert booked.meeting_link == "https://studio.example.com/call"
    assert booked.status == MeetingStatus.SCHEDULED
    assert (
        attended_from(await client.post(BOOKINGS, headers=keyed, json=full), 201)
        == booked
    )
    problem(
        await client.post(BOOKINGS, headers=headers, json=full),
        409,
        ErrorCode.SLOT_TAKEN,
    )
    problem(
        await client.post(
            BOOKINGS, headers=keyed, json={**full, "comment": "Different"}
        ),
        409,
        ErrorCode.CONFLICT,
    )
    own = meeting_from(await client.get(f"{MEETINGS}/{booked.id}", headers=owner))
    assert own.source == MeetingSource.SELF_BOOKED
    assert own.client_comment == full["comment"] and own.price == booked.price
    assert own.client_card is not None and own.client_card.id == card.id
    attended = await client.get(MEETINGS, headers=headers, params=DAY)
    assert attended.status_code == 200, attended.text
    assert MeetingList.model_validate_json(attended.content).attended == [booked]
    assert specialist_from(
        await client.get(specialist, headers=headers)
    ).upcoming_meetings == [booked]
    assert card_from(await client.get(f"{CLIENTS}/{card.id}", headers=owner)) == before
    assert (
        list_from(await client.get(CLIENTS, headers=owner)).plan.active_clients
        == FREE_PLAN_LIMIT
    )
    assert mail_outbox == []
    async with stand.session() as session:
        saved = await session.get(Meeting, booked.id)
        assert saved is not None and saved.price == Decimal("195.23")
        assert saved.guest_language is None and saved.guest_time_zone is None
        assert not await session.scalar(
            select(func.count())
            .select_from(Acceptance)
            .where(Acceptance.guest_booking_id.is_not(None))
        )


async def test_app_booking_rejects_outdated_format_without_creating_meeting_or_receipt(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    _freeze_app_booking(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("format_change_leader")
    attendee = await stand.add_account("format_change_attendee")
    await stand.activate(leader)
    client, owner, headers = stand.client, bearer(leader), bearer(attendee)
    card = await create_card(stand, leader, {"name": "Existing linked card"})
    await link_card(stand, leader, card.id, attendee)
    before = specialist_from(
        await client.get(f"{SPECIALISTS}/{leader.account.id}", headers=headers)
    )
    assert before.session_format == SessionFormat.ONLINE
    update = await client.patch(
        ACCOUNT, headers=owner, json={"leader": {"session_format": "in_person"}}
    )
    assert update.status_code == 200, update.text
    body = {
        "specialist_id": str(leader.account.id),
        "starts_at": (BOOKING_NOW + timedelta(hours=3)).isoformat(),
        "expected_session_format": before.session_format.value,
        "place": "online",
    }
    keyed = {**headers, "Idempotency-Key": str(uuid7())}
    problem(
        await client.post(BOOKINGS, headers=keyed, json=body), 409, ErrorCode.CONFLICT
    )
    async with stand.session() as session:
        assert not await session.scalar(select(func.count()).select_from(Meeting))
        assert not await session.scalar(
            select(func.count()).select_from(MeetingCreateReceipt)
        )
    corrected = {**body, "place": "in_person", "expected_session_format": "in_person"}
    assert (
        attended_from(
            await client.post(BOOKINGS, headers=keyed, json=corrected), 201
        ).place
        == MeetingPlace.IN_PERSON
    )


# spec:test client-app-booking#show-screen-9-4-notify-leader
# spec:test client-archive-restore#show-leader-archived-client-tried-bar
async def test_archived_slot_read_is_silent_and_keyed_refusal_only_raises_one_notice(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _freeze_app_booking(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("archived_booking_leader")
    attendee = await stand.add_account("archived_booking_attendee")
    await stand.activate(leader)
    client, owner, headers = stand.client, bearer(leader), bearer(attendee)
    specialist = f"{SPECIALISTS}/{leader.account.id}"
    assert (
        await client.patch(
            ACCOUNT,
            headers=owner,
            json={
                "leader": {
                    "main_channel": "email",
                    "contact_email": "studio@example.com",
                }
            },
        )
    ).status_code == 200
    card = await create_card(stand, leader, {"name": "Archived linked card"})
    await link_card(stand, leader, card.id, attendee)
    assert specialist_from(
        await client.get(specialist, headers=headers)
    ).booking_available
    body = {"specialist_id": str(leader.account.id)}
    validation_problem(
        await client.post(BOOKINGS, headers=headers, json=body),
        "body",
        "value_error",
    )
    await archive_card(stand, leader, card.id)
    unavailable = problem(
        await client.get(f"{specialist}/slots", headers=headers, params=DAY),
        409,
        ErrorCode.BOOKING_UNAVAILABLE,
    )
    assert unavailable.details == {
        "main_contact": {"channel": "email", "value": "studio@example.com"}
    }
    assert await notices_for(stand, leader) == []
    keyed = {**headers, "Idempotency-Key": str(uuid7())}
    async with timeout(10):
        requests = await gather(
            client.post(BOOKINGS, headers=keyed, json=body),
            client.post(BOOKINGS, headers=keyed, json=body),
        )
    for response in requests:
        assert (
            problem(response, 409, ErrorCode.BOOKING_UNAVAILABLE).details
            == unavailable.details
        )
    problem(
        await client.post(
            BOOKINGS, headers=keyed, json={**body, "comment": "Different request"}
        ),
        409,
        ErrorCode.CONFLICT,
    )
    notices = await notices_for(stand, leader)
    assert [(row.key, row.params) for row in notices] == [
        (NoticeKey.ARCHIVED_CLIENT_TRIED, {"name": card.name})
    ]
    assert mail_outbox == []
    async with stand.session() as session:
        rows = list(await session.scalars(select(MeetingCreateReceipt)))
        assert len(rows) == 1 and rows[0].meeting_id is None
        assert not await session.scalar(select(func.count()).select_from(Meeting))
    assert card_from(
        await client.post(f"{CLIENTS}/{card.id}/restore", headers=owner)
    ).linked
    assert specialist_from(
        await client.get(specialist, headers=headers)
    ).booking_available
    problem(
        await client.post(BOOKINGS, headers=keyed, json=body), 409, ErrorCode.CONFLICT
    )
    await archive_card(stand, leader, card.id)
    problem(
        await client.post(BOOKINGS, headers=keyed, json=body), 409, ErrorCode.CONFLICT
    )
    assert await notices_for(stand, leader) == notices


async def test_app_booking_receipt_survives_reschedule_and_rejects_reassignment_or_deletion(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    _freeze_app_booking(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("app_receipt_leader")
    attendee = await stand.add_account("app_receipt_attendee")
    other = await stand.add_account("app_receipt_other")
    await stand.activate(leader)
    first = await create_card(stand, leader, {"name": "Original linked client"})
    second = await create_card(stand, leader, {"name": "Other linked client"})
    await link_card(stand, leader, first.id, attendee)
    await link_card(stand, leader, second.id, other)
    client, owner = stand.client, bearer(leader)
    keyed = {**bearer(attendee), "Idempotency-Key": str(uuid7())}
    starts = BOOKING_NOW + timedelta(hours=3)
    body = {"specialist_id": str(leader.account.id), "starts_at": starts.isoformat()}
    booked = attended_from(await client.post(BOOKINGS, headers=keyed, json=body), 201)
    path = f"{MEETINGS}/{booked.id}"
    moved = starts + timedelta(hours=1)
    meeting_from(
        await client.patch(path, headers=owner, json={"starts_at": moved.isoformat()})
    )
    replay = attended_from(await client.post(BOOKINGS, headers=keyed, json=body), 201)
    assert replay.id == booked.id and replay.starts_at == moved
    meeting_from(
        await client.patch(path, headers=owner, json={"client_id": str(second.id)})
    )
    problem(
        await client.post(BOOKINGS, headers=keyed, json=body), 409, ErrorCode.CONFLICT
    )
    problem(
        await client.get(f"{ATTENDED}/{booked.id}", headers=keyed),
        404,
        ErrorCode.NOT_FOUND,
    )
    meeting_from(
        await client.patch(path, headers=owner, json={"client_id": str(first.id)})
    )
    problem(
        await client.post(BOOKINGS, headers=keyed, json=body), 409, ErrorCode.CONFLICT
    )
    assert (await client.delete(path, headers=owner)).status_code == 204
    await archive_card(stand, leader, first.id)
    problem(
        await client.post(BOOKINGS, headers=keyed, json=body), 409, ErrorCode.CONFLICT
    )
    assert await notices_for(stand, leader) == []


# spec:test client-app-booking#offer-booking-app-leader-card
async def test_unlinked_account_does_not_wait_for_specialist_lock(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    leader = await stand.add_account("locked_specialist")
    unlinked = await stand.add_account("unknown_attendee")
    await stand.activate(leader)
    client, headers = stand.client, bearer(unlinked)
    specialist = f"{SPECIALISTS}/{leader.account.id}"
    body = {
        "specialist_id": str(leader.account.id),
        "starts_at": BOOKING_NOW.isoformat(),
    }
    async with stand.session() as locking:
        assert await locking.scalar(
            select(Account)
            .where(Account.account_id == leader.account.id)
            .with_for_update(key_share=True)
        )
        async with timeout(5):
            problem(
                await client.post(BOOKINGS, headers=headers, json=body),
                404,
                ErrorCode.NOT_FOUND,
            )
            problem(
                await client.delete(f"{specialist}/link", headers=headers),
                404,
                ErrorCode.NOT_FOUND,
            )
    problem(
        await client.post(BOOKINGS, headers=bearer(leader), json=body),
        404,
        ErrorCode.NOT_FOUND,
    )
    problem(
        await client.get(f"{specialist}/slots", headers=headers, params=DAY),
        404,
        ErrorCode.NOT_FOUND,
    )


async def test_booking_revalidates_link_after_account_locks(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    _freeze_app_booking(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("book_race_specialist")
    attendee = await stand.add_account("book_race_attendee")
    await stand.activate(leader)
    card = await create_card(stand, leader, {"name": "Link changed while booking"})
    await link_card(stand, leader, card.id, attendee)
    client = stand.client
    entered, released = Event(), Event()
    lock_accounts = app_bookings.lock_booking_accounts

    async def wait_after_precheck(
        session: AsyncSession, leader_id: UUID, attendee_id: UUID | None
    ) -> Account:
        entered.set()
        await released.wait()
        return await lock_accounts(session, leader_id, attendee_id)

    monkeypatch.setattr(app_bookings, "lock_booking_accounts", wait_after_precheck)
    body = {
        "specialist_id": str(leader.account.id),
        "starts_at": (BOOKING_NOW + timedelta(hours=3)).isoformat(),
    }
    async with timeout(10), TaskGroup() as work:
        booking = work.create_task(
            client.post(BOOKINGS, headers=bearer(attendee), json=body)
        )
        await entered.wait()
        removed = await client.delete(
            f"{CLIENTS}/{card.id}/link", headers=bearer(leader)
        )
        assert not card_from(removed).linked
        released.set()
    problem(booking.result(), 404, ErrorCode.NOT_FOUND)
    async with stand.session() as session:
        assert not await session.scalar(select(func.count()).select_from(Meeting))


# spec:test client-app-booking#re-check-book-slot-free-show
async def test_reciprocal_app_bookings_serialize_under_real_account_locks(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _freeze_app_booking(monkeypatch)
    stand = account_stand
    left = await stand.add_account("app_left_specialist")
    right = await stand.add_account("app_right_specialist")
    for leader, attendee in ((left, right), (right, left)):
        await stand.activate(leader)
        card = await create_card(stand, leader, {"name": "Reciprocal client"})
        await link_card(stand, leader, card.id, attendee)
    rendezvous = Barrier(2)
    lock_accounts = app_bookings.lock_booking_accounts

    async def begin_together(
        session: AsyncSession, leader_id: UUID, attendee_id: UUID | None
    ) -> Account:
        await rendezvous.wait()
        return await lock_accounts(session, leader_id, attendee_id)

    start = BOOKING_NOW + timedelta(hours=3)
    with monkeypatch.context() as patch:
        patch.setattr(app_bookings, "lock_booking_accounts", begin_together)
        async with timeout(10):
            responses = await gather(
                *(
                    stand.client.post(
                        BOOKINGS,
                        headers={**bearer(attendee), "Idempotency-Key": str(uuid7())},
                        json={
                            "specialist_id": str(leader.account.id),
                            "starts_at": start.isoformat(),
                        },
                    )
                    for leader, attendee in ((left, right), (right, left))
                )
            )
    assert sorted(response.status_code for response in responses) == [201, 409]
    booked_index = next(
        index for index, response in enumerate(responses) if response.status_code == 201
    )
    successful = attended_from(responses[booked_index], 201)
    problem(responses[1 - booked_index], 409, ErrorCode.SLOT_TAKEN)
    assert successful.starts_at == start and mail_outbox == []
    async with stand.session() as session:
        assert list(await session.scalars(select(Meeting.meeting_id))) == [
            successful.id
        ]
        assert list(await session.scalars(select(MeetingCreateReceipt.meeting_id))) == [
            successful.id
        ]
