from asyncio import (
    Barrier,
    Event,
    TaskGroup,
    gather,
    get_running_loop,
    run_coroutine_threadsafe,
    timeout,
)
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo
from decimal import Decimal
from email.message import EmailMessage
from urllib.parse import urlsplit
from uuid import UUID, uuid7

import pytest
from httpx import Response
from pydantic import AnyHttpUrl
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, list_from, problem
from test_meeting_notifications import mail_outbox, notices_for, set_card_channels
from test_meetings_api import MEETINGS, meeting_from

from celmento_api import contour, emails
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    Currency,
    ErrorCode,
    LegalDocumentKind,
    MeetingSource,
    NoticeKey,
    NoticeTab,
)
from celmento_api.models.legal import Acceptance
from celmento_api.models.meeting import GuestBookingReceipt, Meeting
from celmento_api.routers import public as public_router
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.documents import LegalDocument
from celmento_api.schemas.meetings import ClientArchivePreview
from celmento_api.schemas.public import (
    GuestBookingConfirmation,
    GuestBookingCreate,
    PublicSpecialistPage,
)
from celmento_api.services import bookings

__all__: list[str] = ["account_stand", "mail_outbox"]

PUBLIC: str = "/api/v1/public"
BOOKINGS: str = f"{PUBLIC}/bookings"
BOOKING_NOW: datetime = datetime(2030, 1, 7, 7, tzinfo=UTC)


@dataclass(frozen=True, slots=True)
class FrozenTime:
    instant: datetime

    def now(self, zone: tzinfo = UTC) -> datetime:
        return self.instant.astimezone(zone)


def freeze_booking_time(
    monkeypatch: pytest.MonkeyPatch, now: datetime = BOOKING_NOW
) -> None:
    clock = FrozenTime(now)
    monkeypatch.setattr(public_router, "datetime", clock)
    monkeypatch.setattr(bookings, "datetime", clock)


async def booking_form(
    stand: AccountStand, leader: SignInSession, start: datetime, **updates: object
) -> dict[str, object]:
    response = await stand.client.get(f"{PUBLIC}/specialists/{leader.account.login}")
    assert response.status_code == 200, response.text
    page = PublicSpecialistPage.model_validate_json(response.content)
    consents: list[dict[str, str]] = []
    for kind in (
        LegalDocumentKind.TERMS_OF_USE,
        LegalDocumentKind.PERSONAL_DATA_CONSENT,
    ):
        response = await stand.client.get(
            f"/api/v1/documents/{kind.value}", params={"language": "en"}
        )
        assert response.status_code == 200, response.text
        document = LegalDocument.model_validate_json(response.content)
        consents.append({"document": kind.value, "version": document.version})
    return {
        "login": page.login,
        "booking_context": page.booking_context,
        "starts_at": start.isoformat(),
        "name": "Guest nickname",
        "email": "guest+booking@example.com",
        "language": "en",
        "time_zone": "Europe/Belgrade",
        "contact": "Optional contact",
        "comment": "Private booking comment",
        "consents": consents,
        **updates,
    }


def booking_from(response: Response) -> GuestBookingConfirmation:
    assert response.status_code == 201, response.text
    return GuestBookingConfirmation.model_validate_json(response.content)


def _public_invite(login: str, public_id: UUID) -> str:
    return f"{PUBLIC}/specialists/{login}/meet/{public_id}"


# spec:test guest-booking-flow#match-entered-email-case-insensitively
# spec:test guest-booking-flow#create-client-card-email-matches
# spec:test guest-booking-flow#copy-entered-email-contacts-title-new
# spec:test guest-booking-flow#give-card-created-booking-payment
# spec:test guest-booking-flow#create-scheduled-individual-client
# spec:test guest-booking-flow#attach-booking-active-card-self-given
# spec:test guest-booking-flow#send-confirmation-email-entered-email
# spec:test guest-booking-flow#open-sign-in-leader-contour-domain
# spec:test guest-booking-flow#verify-entered-email-before-booking
# spec:test guest-booking-flow#create-account-guest-ask-age
# spec:test legal-documents#store-guest-booking-date-time
async def test_guest_booking_keeps_delivery_data_and_revokes_reassigned_public_ids(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    freeze_booking_time(monkeypatch)
    stand = account_stand
    client = stand.client
    leader = await stand.add_account("public_specialist")
    await stand.activate(leader)
    headers = bearer(leader)
    assert (
        await client.patch(
            ACCOUNT,
            headers=headers,
            json={
                "time_zone": "UTC",
                "leader": {
                    "default_rate": "75.25",
                    "default_currency": "EUR",
                    "default_meeting_link": "https://studio.example.com/call",
                    "contact_email": "studio@example.com",
                    "main_channel": "email",
                },
            },
        )
    ).status_code == 200
    api_url = "http://preview-api.example.com:18001/api/v1"
    settings = stand.settings.model_copy(update={"public_api_url": AnyHttpUrl(api_url)})
    monkeypatch.setattr(contour, "get_settings", lambda: settings)
    outbox: list[EmailMessage] = []
    committed: list[tuple[int, int]] = []
    loop = get_running_loop()

    async def stored_guest_counts() -> tuple[int, int]:
        async with stand.session() as session:
            meetings = await session.scalar(
                select(func.count())
                .select_from(Meeting)
                .where(Meeting.guest_language.is_not(None))
            )
            consents = await session.scalar(
                select(func.count())
                .select_from(Acceptance)
                .where(Acceptance.guest_booking_id.is_not(None))
            )
            return meetings or 0, consents or 0

    def deliver(message: EmailMessage) -> None:
        committed.append(
            run_coroutine_threadsafe(stored_guest_counts(), loop).result(5)
        )
        outbox.append(message)

    monkeypatch.setattr(emails, "_deliver", deliver)
    start = BOOKING_NOW + timedelta(hours=3)
    body = await booking_form(
        stand, leader, start, email="  GUEST+Booking@EXAMPLE.COM  "
    )
    key = {"Idempotency-Key": str(uuid7())}
    first = booking_from(await client.post(BOOKINGS, headers=key, json=body))
    assert first.id.version == 4
    assert first.email == "guest+booking@example.com" and first.starts_at == start
    assert first.meeting_link == "https://studio.example.com/call"
    # spec:test transactional-email#hand-email-delivery-immediately-after
    assert committed == [(1, 2)] and len(outbox) == 1
    assert str(outbox[0]["To"]) == first.email
    assert str(outbox[0]["Subject"]) == "You're booked with New Account on 7 January"
    html = outbox[0].get_body(("html",))
    assert html is not None
    rendered: object = html.get_content()
    assert isinstance(rendered, str)
    assert f'href="{api_url}/public/bookings/{first.id}/calendar.ics"' in rendered
    assert (
        "email=guest%2Bbooking%40example.com" in rendered
        and "public_booking" in rendered
    )
    assert "(Belgrade, UTC+1)" in rendered and "studio@example.com" in rendered
    assert "Private booking comment" not in rendered
    assert booking_from(await client.post(BOOKINGS, headers=key, json=body)) == first
    problem(
        await client.post(BOOKINGS, headers=key, json={**body, "comment": "Changed"}),
        409,
        ErrorCode.CONFLICT,
    )
    assert len(outbox) == 1

    listing = list_from(await client.get(CLIENTS, headers=headers))
    assert len(listing.items) == 1 and listing.items[0].is_new
    card_id = listing.items[0].id
    card_path = f"{CLIENTS}/{card_id}"
    original_card = card_from(await client.get(card_path, headers=headers))
    # spec:test client-card-profile-link#store-self-given-email-card-separate
    assert original_card.self_given_email == first.email and original_card.email is None
    assert original_card.other_contact == "Optional contact"
    assert original_card.rate == "75.25" and original_card.currency == Currency.EUR
    assert original_card.payment_type.value == "paid" and not original_card.linked
    edited_card = card_from(
        await client.patch(
            card_path,
            headers=headers,
            json={
                "name": "Leader's name",
                "rate": "125.50",
                "email": "private@example.com",
                "info": "Private card information",
            },
        )
    )
    second = booking_from(
        await client.post(
            BOOKINGS,
            json={
                **body,
                "starts_at": (start + timedelta(hours=1)).isoformat(),
                "name": "Discarded replacement",
                "contact": "Discarded contact",
                "language": "ru",
                "time_zone": "Asia/Tokyo",
            },
        )
    )
    assert second.id != first.id
    assert committed == [(1, 2), (2, 4)]
    assert str(outbox[-1]["Subject"]).startswith("Вы записаны")
    assert card_from(await client.get(card_path, headers=headers)) == edited_card

    async with stand.session() as session:
        first_row = await session.scalar(
            select(Meeting).where(Meeting.public_id == first.id)
        )
        second_row = await session.scalar(
            select(Meeting).where(Meeting.public_id == second.id)
        )
        assert first_row is not None and second_row is not None
        assert first_row.client_card_id == second_row.client_card_id == card_id
        assert first_row.meeting_id != first.id and second_row.meeting_id != second.id
        # spec:test time-zone-handling#record-guest-device-zone-guest
        assert (first_row.guest_language, first_row.guest_time_zone) == (
            "en",
            "Europe/Belgrade",
        )
        assert (second_row.guest_language, second_row.guest_time_zone) == (
            "ru",
            "Asia/Tokyo",
        )
        assert (
            first_row.source == MeetingSource.SELF_BOOKED.value
            and first_row.client_comment == "Private booking comment"
        )
        assert first_row.price == Decimal("75.25") and second_row.price == Decimal(
            "125.50"
        )
        assert await session.scalar(select(func.count()).select_from(Account)) == 1
        receipt = await session.scalar(select(GuestBookingReceipt))
        assert receipt is not None and receipt.public_id == first.id
        records = (
            await session.scalars(
                select(Acceptance).where(
                    Acceptance.guest_booking_id == second_row.meeting_id
                )
            )
        ).all()
        expected_records = GuestBookingCreate.model_validate(body).consents
        assert {(row.kind, row.version) for row in records} == {
            (consent.document.value, consent.version) for consent in expected_records
        }
        assert all(
            row.account_id is None
            and row.meeting_id == second_row.meeting_id
            and row.version
            and row.accepted_at == BOOKING_NOW
            for row in records
        )

    first_file = f"{BOOKINGS}/{first.id}/calendar.ics"
    original = await client.get(first_file)
    assert original.status_code == 200 and original.headers["Content-Type"].startswith(
        "text/calendar"
    )
    assert "SUMMARY:Session with New Account\r\n" in original.text
    assert "DESCRIPTION:https://studio.example.com/call\r\n" in original.text
    assert all(len(line) <= 75 for line in original.content.split(b"\r\n"))
    assert (
        await client.delete(f"{MEETINGS}/{second_row.meeting_id}", headers=headers)
    ).status_code == 204
    problem(
        await client.get(f"{BOOKINGS}/{second.id}/calendar.ics"),
        404,
        ErrorCode.NOT_FOUND,
    )
    async with stand.session() as session:
        saved = await session.get(ClientCard, card_id)
        assert saved is not None and (saved.guest_language, saved.guest_time_zone) == (
            "ru",
            "Asia/Tokyo",
        )
        retained = (
            await session.scalars(
                select(Acceptance).where(
                    Acceptance.guest_booking_id == second_row.meeting_id
                )
            )
        ).all()
        assert len(retained) == 2 and all(
            row.meeting_id is None and row.version for row in retained
        )

    meeting_path = f"{MEETINGS}/{first_row.meeting_id}"
    moved_start = start + timedelta(hours=2)
    moved = meeting_from(
        await client.patch(
            meeting_path, headers=headers, json={"starts_at": moved_start.isoformat()}
        )
    )
    assert moved.invite_url is not None and moved.invite_url.endswith(str(first.id))
    assert "перенесена" in str(outbox[-1]["Subject"]) and "Белград" in str(
        outbox[-1]["Subject"]
    )
    updated = await client.get(first_file)
    assert updated.status_code == 200 and "DTSTART:20300107T120000Z" in updated.text
    assert "SUMMARY:Session with New Account" in updated.text

    replacement = await create_card(stand, leader, {"name": "Replacement client"})
    reassigned = meeting_from(
        await client.patch(
            meeting_path, headers=headers, json={"client_id": str(replacement.id)}
        )
    )
    assert (
        reassigned.invite_url is not None and reassigned.invite_url != moved.invite_url
    )
    assert (await client.get(first_file)).status_code == 404
    assert (
        await client.get(_public_invite(leader.account.login, first.id))
    ).status_code == 404
    problem(
        await client.post(BOOKINGS, headers=key, json=body), 409, ErrorCode.CONFLICT
    )
    new_id = UUID(urlsplit(reassigned.invite_url).path.rsplit("/", 1)[-1])
    assert (
        await client.get(_public_invite(leader.account.login, new_id))
    ).status_code == 200
    assert (await client.delete(meeting_path, headers=headers)).status_code == 204
    problem(
        await client.post(BOOKINGS, headers=key, json=body), 409, ErrorCode.CONFLICT
    )


# spec:test guest-booking-flow#set-auto-link-card-booking
# spec:test client-card-profile-link#make-auto-link-booking
# spec:test guest-booking-flow#re-check-book-slot-free-taken
async def test_reciprocal_bookings_serialize_attended_time_in_separate_transactions(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze_booking_time(monkeypatch)
    stand = account_stand
    left = await stand.add_account("left_specialist")
    right = await stand.add_account("right_specialist")
    for actor in (left, right):
        await stand.activate(actor)
    start = BOOKING_NOW + timedelta(hours=3)
    left_body = await booking_form(stand, left, start, email=right.account.email)
    right_body = await booking_form(stand, right, start, email=left.account.email)
    barrier = Barrier(2)
    lock_accounts = bookings.lock_booking_accounts

    async def start_together(
        session: AsyncSession, leader_id: UUID, attendee_id: UUID | None
    ) -> Account:
        await barrier.wait()
        return await lock_accounts(session, leader_id, attendee_id)

    with monkeypatch.context() as patch:
        patch.setattr(bookings, "lock_booking_accounts", start_together)
        async with timeout(10):
            results = await gather(
                stand.client.post(BOOKINGS, json=left_body),
                stand.client.post(BOOKINGS, json=right_body),
            )
    assert sorted(response.status_code for response in results) == [201, 409]
    problem(
        next(response for response in results if response.status_code == 409),
        409,
        ErrorCode.SLOT_TAKEN,
    )
    assert len(mail_outbox) == 1
    async with stand.session() as session:
        meeting = await session.scalar(select(Meeting))
        assert meeting is not None and meeting.client_card_id is not None
        card = await session.get(ClientCard, meeting.client_card_id)
        assert card is not None
        expected = right if meeting.leader_account_id == left.account.id else left
        assert (
            card.linked_account_id == expected.account.id and card.link_method == "auto"
        )

    other_time = (start + timedelta(hours=1)).isoformat()
    competing = right_body if results[0].status_code == 201 else left_body
    assert booking_from(
        await stand.client.post(BOOKINGS, json={**competing, "starts_at": other_time})
    ).starts_at == start + timedelta(hours=1)
    assert len(mail_outbox) == 2


async def test_booking_retries_lock_scope_if_card_link_changes_after_discovery(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze_booking_time(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("rediscovery_specialist")
    email_match = await stand.add_account("before_link")
    manual_link = await stand.add_account("new_manual_link")
    await stand.activate(leader)
    card = await create_card(stand, leader, {"name": "Existing booking card"})
    await set_card_channels(stand, card.id, recipient=email_match.account.email)
    body = await booking_form(
        stand, leader, BOOKING_NOW + timedelta(hours=3), email=email_match.account.email
    )
    entered, released = Event(), Event()
    seen: list[UUID | None] = []
    lock_accounts = bookings.lock_booking_accounts

    async def wait_before_lock(
        session: AsyncSession, leader_id: UUID, attendee_id: UUID | None
    ) -> Account:
        seen.append(attendee_id)
        if len(seen) == 1:
            entered.set()
            await released.wait()
        return await lock_accounts(session, leader_id, attendee_id)

    monkeypatch.setattr(bookings, "lock_booking_accounts", wait_before_lock)
    async with timeout(10), TaskGroup() as tasks:
        request = tasks.create_task(stand.client.post(BOOKINGS, json=body))
        await entered.wait()
        linked = await stand.client.put(
            f"{CLIENTS}/{card.id}/link",
            headers=bearer(leader),
            json={"login": manual_link.account.login},
        )
        assert card_from(linked).linked
        released.set()
    result = booking_from(request.result())
    assert seen == [email_match.account.id, manual_link.account.id]
    assert (
        len(mail_outbox) == 1 and str(mail_outbox[0]["To"]) == email_match.account.email
    )
    async with stand.session() as session:
        meeting = await session.scalar(
            select(Meeting).where(Meeting.public_id == result.id)
        )
        assert meeting is not None and meeting.client_card_id == card.id
        saved = await session.get(ClientCard, card.id)
        assert saved is not None and saved.linked_account_id == manual_link.account.id


# spec:test guest-booking-flow#refuse-booking-self-booking-entered
# spec:test guest-booking-flow#create-meeting-card-set-link
# spec:test free-plan-client-limit#show-leader-bar-limit-new-client-guest
# spec:test free-plan-client-limit#refuse-booking-create-new-card
# spec:test free-plan-client-limit#block-count-booking-matches-existing
# spec:test free-plan-client-limit#show-bar-archived-client-tried-raised
async def test_guest_refusals_leave_data_unchanged_and_durably_notify_leader(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze_booking_time(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("refusal_specialist")
    await stand.activate(leader)
    client, headers = stand.client, bearer(leader)
    start = BOOKING_NOW + timedelta(hours=3)
    body = await booking_form(stand, leader, start)
    problem(
        await client.post(BOOKINGS, json={**body, "consents": []}),
        400,
        ErrorCode.CONSENT_REQUIRED,
    )
    problem(
        await client.post(
            BOOKINGS, json={**body, "email": leader.account.email.upper()}
        ),
        409,
        ErrorCode.SELF_BOOKING,
    )
    assert not mail_outbox and not await notices_for(stand, leader)
    assert (
        await client.patch(
            ACCOUNT, headers=headers, json={"leader": {"session_format": "both"}}
        )
    ).status_code == 200
    assert (await client.post(BOOKINGS, json=body)).status_code == 422
    body["place"] = "in_person"
    first = booking_from(await client.post(BOOKINGS, json=body))
    assert first.place.value == "in_person" and first.meeting_link is None
    await create_card(
        stand, leader, {"name": "Reference only", "email": "new@example.com"}
    )
    await create_card(stand, leader, {"name": "Fills the cap"})
    next_time = (start + timedelta(hours=1)).isoformat()
    refused = problem(
        await client.post(
            BOOKINGS,
            json={
                **body,
                "starts_at": next_time,
                "name": "Another guest",
                "email": "new@example.com",
            },
        ),
        409,
        ErrorCode.BOOKING_UNAVAILABLE,
    )
    assert refused.details == {"main_contact": None}
    async with stand.session() as session:
        assert await session.scalar(select(func.count()).select_from(ClientCard)) == 3
        assert await session.scalar(select(func.count()).select_from(Meeting)) == 1
    existing = booking_from(
        await client.post(BOOKINGS, json={**body, "starts_at": next_time})
    )
    assert existing.id != first.id
    assert len(mail_outbox) == 2
    cards = list_from(await client.get(CLIENTS, headers=headers))
    assert cards.plan.active_clients == 3
    owned = next(card for card in cards.items if card.name == "Guest nickname")
    path = f"{CLIENTS}/{owned.id}"
    guest = card_from(await client.get(path, headers=headers))
    assert guest.rate is None and guest.payment_type.value == "pro_bono"
    preview = await client.get(f"{path}/archive-preview", headers=headers)
    assert preview.status_code == 200
    token = ClientArchivePreview.model_validate_json(preview.content).preview_token
    assert (
        await client.post(
            f"{path}/archive", headers=headers, json={"preview_token": token}
        )
    ).status_code == 200
    count = len(mail_outbox)
    problem(
        await client.post(BOOKINGS, json={**body, "starts_at": next_time}),
        409,
        ErrorCode.BOOKING_UNAVAILABLE,
    )
    assert len(mail_outbox) == count
    notices = await notices_for(stand, leader)
    assert all(notice.tab == NoticeTab.PEOPLE for notice in notices)
    assert {(notice.key, notice.params["name"]) for notice in notices} == {
        (NoticeKey.LIMIT_NEW_CLIENT, "Another guest"),
        (NoticeKey.ARCHIVED_CLIENT_TRIED, "Guest nickname"),
    }
    async with stand.session() as session:
        assert await session.scalar(select(func.count()).select_from(ClientCard)) == 3
        assert await session.scalar(select(func.count()).select_from(Meeting)) == 0
        assert (
            await session.scalar(
                select(func.count())
                .select_from(Acceptance)
                .where(Acceptance.guest_booking_id.is_not(None))
            )
            == 4
        )
