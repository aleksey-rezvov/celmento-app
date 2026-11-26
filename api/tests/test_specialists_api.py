from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from httpx import Response
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, problem
from test_meeting_notifications import mail_outbox, notices_for, set_card_channels
from test_meetings_api import MEETINGS, meeting_from, post_meeting, service_form
from test_meetings_ledger import client_form
from test_notes_api import NOTES, note_from, post_note

from celmento_api.errors import HTTPValidationError
from celmento_api.models.client_card import ClientCard as ClientRecord
from celmento_api.models.enums import (
    ClientCardStatus,
    ClientLinkStatus,
    Currency,
    ErrorCode,
    MeetingStatus,
    NoticeKey,
    PaymentType,
    Specialization,
)
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.balance import ClientBalance
from celmento_api.schemas.clients import ClientCard
from celmento_api.schemas.meetings import (
    AttendedMeeting,
    ClientArchivePreview,
    MeetingCalendarMonth,
    MeetingList,
)
from celmento_api.schemas.money import Money
from celmento_api.schemas.notes import Note
from celmento_api.schemas.specialists import SpecialistCard, SpecialistList

__all__: list[str] = ["account_stand", "mail_outbox"]

SPECIALISTS: str = "/api/v1/specialists"
ATTENDED: str = "/api/v1/attended-meetings"


async def link_card(
    stand: AccountStand, leader: SignInSession, card_id: UUID, attendee: SignInSession
) -> None:
    linked = card_from(
        await stand.client.put(
            f"{CLIENTS}/{card_id}/link",
            headers=bearer(leader),
            json={"login": attendee.account.login},
        )
    )
    assert linked.linked


async def archive_card(
    stand: AccountStand, leader: SignInSession, card_id: UUID
) -> ClientCard:
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
    assert archived.status == ClientCardStatus.ARCHIVED and archived.linked
    return archived


def specialist_from(response: Response) -> SpecialistCard:
    assert response.status_code == 200, response.text
    return SpecialistCard.model_validate_json(response.content)


def attended_from(response: Response, status: int = 200) -> AttendedMeeting:
    assert response.status_code == status, response.text
    return AttendedMeeting.model_validate_json(response.content)


def validation_problem(response: Response, source: str, kind: str) -> None:
    assert response.status_code == 422, response.text
    parsed = HTTPValidationError.model_validate_json(response.content)
    assert len(parsed.detail) == 1
    detail = parsed.detail[0]
    assert detail.loc == [source] and detail.type == kind


def _specialists(response: Response) -> SpecialistList:
    assert response.status_code == 200, response.text
    return SpecialistList.model_validate_json(response.content)


def _schedule(response: Response) -> MeetingList:
    assert response.status_code == 200, response.text
    return MeetingList.model_validate_json(response.content)


def _month(response: Response) -> MeetingCalendarMonth:
    assert response.status_code == 200, response.text
    return MeetingCalendarMonth.model_validate_json(response.content)


async def _tagged_note(
    stand: AccountStand, author: SignInSession, card_id: UUID, title: str
) -> Note:
    note = await post_note(stand, author, {"title": title, "text": f"Text for {title}"})
    return note_from(
        await stand.client.post(
            f"{NOTES}/{note.id}/tags",
            headers=bearer(author),
            json={"target_id": str(card_id)},
        ),
        201,
    )


# spec:test client-my-specialists#list-section-leader-client-card
# spec:test client-my-specialists#list-leader-no-card-linked
# spec:test client-my-specialists#show-list-card-9-6-card
async def test_specialist_card_exposes_only_linked_profile_sessions_and_shared_notes(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    leader = await stand.add_account("profile_specialist")
    attendee = await stand.add_account("profile_attendee")
    stranger = await stand.add_account("profile_unlinked")
    await stand.activate(leader)
    client, owner, headers = stand.client, bearer(leader), bearer(attendee)
    specialist_path = f"{SPECIALISTS}/{leader.account.id}"
    problem(await client.get(SPECIALISTS), 401, ErrorCode.UNAUTHORIZED)
    assert _specialists(await client.get(SPECIALISTS, headers=headers)).items == []
    problem(
        await client.get(specialist_path, headers=headers), 404, ErrorCode.NOT_FOUND
    )
    assert (
        await client.patch(
            ACCOUNT,
            headers=owner,
            json={
                "first_name": "Ada",
                "last_name": "Specialist",
                "telegram": "adastudio",
                "leader": {
                    "about": "Public description of Ada's practice",
                    "specializations": ["psychologist", "coach"],
                    "contact_email": "studio@example.com",
                    "main_channel": "email",
                },
            },
        )
    ).status_code == 200
    card = await create_card(
        stand,
        leader,
        {
            "name": "Private attendee title",
            "email": "private-reference@example.com",
            "rate": "123.45",
            "currency": "USD",
        },
    )
    private = await client.patch(
        f"{CLIENTS}/{card.id}", headers=owner, json={"info": "Private attendee history"}
    )
    assert card_from(private).info == "Private attendee history"
    await set_card_channels(stand, card.id, recipient="self-given@example.com")
    await link_card(stand, leader, card.id, attendee)
    other = await create_card(stand, leader, {"name": "Other hidden client"})
    await _tagged_note(stand, leader, other.id, "Hidden note of another client")
    await post_note(stand, leader, {"title": "Hidden private note"})
    shared = [
        await _tagged_note(stand, leader, card.id, title)
        for title in (
            "Oldest exercise",
            "First exercise",
            "Second exercise",
            "Third exercise",
        )
    ]
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(days=2)
    later = await post_meeting(
        stand, leader, client_form(card.id, start + timedelta(days=1))
    )
    soonest = await post_meeting(stand, leader, client_form(card.id, start))
    await post_meeting(stand, leader, client_form(other.id, start - timedelta(hours=2)))

    listed = _specialists(await client.get(SPECIALISTS, headers=headers)).items
    assert len(listed) == 1
    assert listed[0].next_booking_at == start
    assert listed[0].specialist.id == leader.account.id
    assert listed[0].specialist.first_name == "Ada"
    assert set(listed[0].specialist.specializations) == {
        Specialization.PSYCHOLOGIST,
        Specialization.COACH,
    }
    response = await client.get(specialist_path, headers=headers)
    visible = specialist_from(response)
    assert visible.specialist == listed[0].specialist
    assert visible.specialist.contact_email == "studio@example.com"
    assert visible.specialist.telegram == "adastudio"
    assert visible.about == "Public description of Ada's practice"
    assert visible.price_for_me == Money(amount="123.45", currency=Currency.USD)
    assert visible.payment_type == PaymentType.PAID and visible.booking_available
    assert [meeting.id for meeting in visible.upcoming_meetings] == [
        soonest.id,
        later.id,
    ]
    assert visible.past_meetings == []
    assert [note.id for note in visible.shared_notes] == [
        note.id for note in reversed(shared[1:])
    ]
    assert all(
        note.shared_with_me
        and not note.can_edit
        and not note.tags
        and note.folder_id is None
        for note in visible.shared_notes
    )
    for secret in (
        "Private attendee title",
        "Private attendee history",
        "private-reference@example.com",
        "self-given@example.com",
        leader.account.email,
        "Other hidden client",
        "Hidden private note",
        "Hidden note of another client",
        str(card.id),
    ):
        assert secret not in response.text
    problem(
        await client.get(specialist_path, headers=bearer(stranger)),
        404,
        ErrorCode.NOT_FOUND,
    )


# spec:test attended-meetings#show-attended-meetings-individual-client
# spec:test attended-meetings#show-attended-meetings-account-without-activation
# spec:test attended-meetings#show-actual-duration-leader-comment
# spec:test attended-meetings#show-attended-meeting-attached
# spec:test attended-meetings#show-in-person-meeting-address
# spec:test schedule-date-navigation#mark-dot-day-least-one
async def test_attendee_schedule_dots_details_and_calendar_follow_link_and_local_dates(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    leader = await stand.add_account("schedule_specialist")
    attendee = await stand.add_account("schedule_attendee")
    await stand.activate(leader)
    client, owner, headers = stand.client, bearer(leader), bearer(attendee)
    assert (
        await client.patch(
            ACCOUNT, headers=headers, json={"time_zone": "Asia/Tokyo", "language": "ru"}
        )
    ).status_code == 200
    card = await create_card(
        stand, leader, {"name": "Schedule client", "currency": "EUR"}
    )
    unrelated = await create_card(stand, leader, {"name": "Standalone schedule"})
    await link_card(stand, leader, card.id, attendee)
    start = datetime(2025, 9, 14, 23, tzinfo=UTC)
    completed = await post_meeting(
        stand,
        leader,
        client_form(
            card.id,
            start,
            place="in_person",
            address="12 Example Street, Room 3",
            comment="Confidential meeting comment",
            outcome={"status": "completed", "actual_duration_minutes": 45},
        ),
    )
    missed = await post_meeting(
        stand,
        leader,
        client_form(
            card.id,
            start + timedelta(hours=2),
            outcome={"status": "not_taken_place", "charged": True},
        ),
    )
    private = await post_meeting(
        stand, leader, client_form(unrelated.id, start - timedelta(days=1))
    )
    practice_time = start - timedelta(days=2)
    practice = await post_meeting(
        stand,
        leader,
        {
            "type": "mutual_practice",
            "with_whom": "Practice partner",
            "starts_at": practice_time.isoformat(),
            "duration_minutes": 60,
            "my_duration_minutes": 30,
            "place": "online",
        },
    )
    day = {"from": "2025-09-15", "to": "2025-09-15"}
    schedule = _schedule(await client.get(MEETINGS, headers=headers, params=day))
    assert schedule.items == [] and schedule.pending_outcomes_count == 0
    assert schedule.next_outcome_in_seconds is None
    assert schedule.attended_total == 2 and schedule.specialists_count == 1
    assert [meeting.id for meeting in schedule.attended] == [completed.id, missed.id]
    assert schedule.attended[1].status == MeetingStatus.NOT_TAKEN_PLACE
    assert schedule.attended[1].charged is True
    outside = _schedule(
        await client.get(
            MEETINGS, headers=headers, params={"from": "2025-09-14", "to": "2025-09-14"}
        )
    )
    assert not outside.attended and outside.attended_total == 2
    calendar_path = f"{MEETINGS}/calendar"
    month = {"month": "2025-09"}
    assert _month(
        await client.get(calendar_path, headers=headers, params=month)
    ).days == [date(2025, 9, 15)]
    details_path = f"{ATTENDED}/{completed.id}"
    response = await client.get(details_path, headers=headers)
    detail = attended_from(response)
    assert detail == schedule.attended[0]
    assert detail.address == "12 Example Street, Room 3" and detail.meeting_link is None
    assert detail.duration_minutes == 60 and detail.charged is None
    assert detail.price == Money(amount="100.25", currency=Currency.EUR)
    assert detail.specialist.time_zone == "Europe/Belgrade"
    for hidden in (
        "actual_duration_minutes",
        "Confidential meeting comment",
        "Schedule client",
        str(card.id),
    ):
        assert hidden not in response.text
    for unseen in (private.id, practice.id, completed.id):
        requester = owner if unseen == completed.id else headers
        problem(
            await client.get(f"{ATTENDED}/{unseen}", headers=requester),
            404,
            ErrorCode.NOT_FOUND,
        )
    download = f"{details_path}/calendar.ics"
    problem(await client.get(download), 401, ErrorCode.UNAUTHORIZED)
    calendar = await client.get(download, headers=headers)
    assert calendar.status_code == 200
    assert calendar.headers["Content-Type"].startswith("text/calendar")
    assert calendar.headers["Cache-Control"] == "no-store"
    assert "SUMMARY:Встреча с New Account" in calendar.text
    assert "DTSTART:20250914T230000Z" in calendar.text
    assert "DTEND:20250915T000000Z" in calendar.text
    assert "LOCATION:12 Example Street\\, Room 3" in calendar.text
    assert "Confidential" not in calendar.text

    await stand.activate(attendee)
    own = await post_meeting(stand, attendee, service_form(start + timedelta(hours=5)))
    activated = _schedule(await client.get(MEETINGS, headers=headers, params=day))
    assert [item.id for item in activated.items] == [own.id]
    assert (
        activated.attended == schedule.attended
        and activated.pending_outcomes_count == 1
    )
    assert _month(
        await client.get(calendar_path, headers=headers, params=month)
    ).days == [date(2025, 9, 15)]
    problem(
        await client.patch(
            f"{MEETINGS}/{completed.id}", headers=headers, json={"comment": "No"}
        ),
        404,
        ErrorCode.NOT_FOUND,
    )
    for malformed in (
        f"{ATTENDED}/bad",
        f"{ATTENDED}/bad/calendar.ics",
        f"{SPECIALISTS}/bad",
    ):
        validation_problem(
            await client.get(malformed, headers=headers), "path", "uuid_parsing"
        )


# spec:test client-meeting-notifications#keep-attendee-schedule-consistent-bar
# spec:test attended-meetings#update-attended-meeting-details-leader
# spec:test attended-meetings#keep-past-attended-meetings-leader
async def test_reschedule_and_archive_update_attendee_history_in_same_commits_as_notices(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    leader = await stand.add_account("archive_history_specialist")
    attendee = await stand.add_account("archive_history_attendee")
    await stand.activate(leader)
    client, owner, headers = stand.client, bearer(leader), bearer(attendee)
    card = await create_card(stand, leader, {"name": "Linked archival history"})
    await link_card(stand, leader, card.id, attendee)
    now = datetime.now(UTC).replace(microsecond=0)
    old = now - timedelta(days=2)
    original = now + timedelta(days=2)
    moved = original + timedelta(days=1)
    shifted_outcome = now + timedelta(days=40)
    completed = {"status": "completed", "actual_duration_minutes": 45}
    past = await post_meeting(
        stand, leader, client_form(card.id, old, outcome=completed)
    )
    hidden = await post_meeting(
        stand, leader, client_form(card.id, old + timedelta(hours=2), outcome=completed)
    )
    scheduled = await post_meeting(stand, leader, client_form(card.id, original))
    meeting_from(
        await client.patch(
            f"{MEETINGS}/{hidden.id}",
            headers=owner,
            json={"starts_at": shifted_outcome.isoformat()},
        )
    )
    meeting_from(
        await client.patch(
            f"{MEETINGS}/{scheduled.id}",
            headers=owner,
            json={"starts_at": moved.isoformat()},
        )
    )
    assert NoticeKey.RESCHEDULED in {
        notice.key for notice in await notices_for(stand, attendee)
    }
    assert (
        attended_from(
            await client.get(f"{ATTENDED}/{scheduled.id}", headers=headers)
        ).starts_at
        == moved
    )
    zone = ZoneInfo("Europe/Belgrade")
    window = {
        "from": old.astimezone(zone).date().isoformat(),
        "to": shifted_outcome.astimezone(zone).date().isoformat(),
    }
    before = _schedule(await client.get(MEETINGS, headers=headers, params=window))
    assert {meeting.id for meeting in before.attended} == {
        past.id,
        scheduled.id,
        hidden.id,
    }

    await archive_card(stand, leader, card.id)
    assert NoticeKey.CANCELLED in {
        notice.key for notice in await notices_for(stand, attendee)
    }
    history = _schedule(await client.get(MEETINGS, headers=headers, params=window))
    assert [meeting.id for meeting in history.attended] == [
        past.id
    ] and history.attended_total == 1
    for meeting in (hidden, scheduled):
        path = f"{ATTENDED}/{meeting.id}"
        problem(await client.get(path, headers=headers), 404, ErrorCode.NOT_FOUND)
        problem(
            await client.get(f"{path}/calendar.ics", headers=headers),
            404,
            ErrorCode.NOT_FOUND,
        )
    own_history = meeting_from(
        await client.get(f"{MEETINGS}/{hidden.id}", headers=owner)
    )
    assert own_history.status == MeetingStatus.COMPLETED
    month = {"month": shifted_outcome.astimezone(zone).strftime("%Y-%m")}
    assert (
        _month(
            await client.get(f"{MEETINGS}/calendar", headers=headers, params=month)
        ).days
        == []
    )
    specialist = specialist_from(
        await client.get(f"{SPECIALISTS}/{leader.account.id}", headers=headers)
    )
    assert not specialist.booking_available and specialist.upcoming_meetings == []
    assert [meeting.id for meeting in specialist.past_meetings] == [past.id]
    listed = _specialists(await client.get(SPECIALISTS, headers=headers)).items
    assert len(listed) == 1 and listed[0].next_booking_at is None


# spec:test client-card-profile-link#break-link-attendee-taps-unlink
# spec:test client-card-profile-link#keep-card-meetings-balance-payments
# spec:test attended-meetings#remove-attended-meeting-leader-account
@pytest.mark.parametrize("attendee_unlinks", [True, False])
async def test_unlink_revokes_card_based_access_and_preserves_owner_history(
    account_stand: AccountStand, mail_outbox: list[EmailMessage], attendee_unlinks: bool
) -> None:
    stand = account_stand
    leader = await stand.add_account("unlink_attended_specialist")
    attendee = await stand.add_account("unlink_attended_client")
    await stand.activate(leader)
    client, owner, headers = stand.client, bearer(leader), bearer(attendee)
    card = await create_card(stand, leader, {"name": "Card identity stays"})
    await link_card(stand, leader, card.id, attendee)
    card_path = f"{CLIENTS}/{card.id}"
    await set_card_channels(stand, card.id, recipient=attendee.account.email)
    payment = await client.post(
        f"{card_path}/payments",
        headers=owner,
        json={"amount": "150", "date": "2025-09-14"},
    )
    assert payment.status_code == 201, payment.text
    meeting = await post_meeting(
        stand,
        leader,
        client_form(
            card.id,
            datetime(2025, 9, 15, 9, tzinfo=UTC),
            outcome={"status": "completed", "actual_duration_minutes": 55},
        ),
    )
    note = await _tagged_note(stand, leader, card.id, "Shared via card")
    note_path = f"{NOTES}/{note.id}"
    reply = note_from(
        await client.post(
            f"{note_path}/replies",
            headers=headers,
            json={"text": "Direct account reply"},
        ),
        201,
    )
    before = await client.get(f"{card_path}/balance", headers=owner)
    assert before.status_code == 200
    ledger = ClientBalance.model_validate_json(before.content)
    assert len(ledger.items) == 2
    assert NoticeKey.LINKED in {
        notice.key for notice in await notices_for(stand, attendee)
    }
    if attendee_unlinks:
        await archive_card(stand, leader, card.id)
        response = await client.delete(
            f"{SPECIALISTS}/{leader.account.id}/link", headers=headers
        )
        assert response.status_code == 204 and not response.content
    else:
        assert not card_from(
            await client.delete(f"{card_path}/link", headers=owner)
        ).linked

    assert _specialists(await client.get(SPECIALISTS, headers=headers)).items == []
    for revoked in (
        f"{SPECIALISTS}/{leader.account.id}",
        f"{ATTENDED}/{meeting.id}",
        f"{ATTENDED}/{meeting.id}/calendar.ics",
        note_path,
    ):
        problem(await client.get(revoked, headers=headers), 404, ErrorCode.NOT_FOUND)
    schedule = _schedule(
        await client.get(
            MEETINGS, headers=headers, params={"from": "2025-09-15", "to": "2025-09-15"}
        )
    )
    assert not schedule.attended
    assert schedule.attended_total == schedule.specialists_count == 0
    assert NoticeKey.LINKED not in {
        notice.key for notice in await notices_for(stand, attendee)
    }
    persisted = card_from(await client.get(card_path, headers=owner))
    assert not persisted.linked and persisted.completed_sessions == 1
    if attendee_unlinks:
        assert persisted.link.status == ClientLinkStatus.UNLINKED_BY_CLIENT
        assert persisted.status == ClientCardStatus.ARCHIVED
    assert (
        meeting_from(await client.get(f"{MEETINGS}/{meeting.id}", headers=owner)).id
        == meeting.id
    )
    response = await client.get(f"{card_path}/balance", headers=owner)
    assert response.status_code == 200
    saved_ledger = ClientBalance.model_validate_json(response.content)
    assert saved_ledger.balance == ledger.balance
    expected = (
        [operation.model_copy(update={"editable": False}) for operation in ledger.items]
        if attendee_unlinks
        else ledger.items
    )
    assert saved_ledger.items == expected
    assert [
        tag.target_id
        for tag in note_from(await client.get(note_path, headers=owner)).tags
    ] == [card.id]
    assert note_from(
        await client.get(f"{NOTES}/{reply.id}", headers=owner)
    ).shared_with_me
    async with stand.session() as session:
        record = await session.get(ClientRecord, card.id)
        assert record is not None and record.auto_link_blocked
        assert record.self_given_email == attendee.account.email
    assert mail_outbox == []
