from asyncio import gather, timeout
from collections.abc import Mapping
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import Response
from sqlalchemy.ext.asyncio import AsyncSession
from test_account import PNG, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, create_card, problem

from celmento_api.models.account import Account
from celmento_api.models.enums import (
    Currency,
    ErrorCode,
    MeetingSource,
    MeetingStatus,
    MeetingType,
)
from celmento_api.routers import meetings as meeting_router
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.meetings import (
    Meeting,
    MeetingCalendarMonth,
    MeetingDefaults,
    MeetingDetail,
    MeetingList,
    MeetingPendingOutcomeList,
)
from celmento_api.services.schedule import meeting_defaults

__all__: list[str] = [
    "MEETINGS",
    "account_stand",
    "meeting_from",
    "post_meeting",
    "service_form",
]

MEETINGS: str = "/api/v1/meetings"


def meeting_from(response: Response, status: int = 200) -> MeetingDetail:
    assert response.status_code == status, response.text
    return MeetingDetail.model_validate_json(response.content)


def service_form(starts_at: datetime, **edits: object) -> dict[str, object]:
    return {
        "type": "personal_therapy",
        "starts_at": starts_at.isoformat(),
        "duration_minutes": 60,
        "place": "online",
        "price": "50",
        "currency": "RUB",
        **edits,
    }


async def post_meeting(
    stand: AccountStand, leader: SignInSession, body: Mapping[str, object]
) -> MeetingDetail:
    return meeting_from(
        await stand.client.post(MEETINGS, json=dict(body), headers=bearer(leader)),
        201,
    )


def _list(response: Response) -> MeetingList:
    assert response.status_code == 200, response.text
    return MeetingList.model_validate_json(response.content)


def _calendar(response: Response) -> MeetingCalendarMonth:
    assert response.status_code == 200, response.text
    return MeetingCalendarMonth.model_validate_json(response.content)


# spec:test time-zone-handling#store-meeting-instant-meeting-set
# spec:test schedule-date-navigation#show-meetings-details-inside-mini
# spec:test meeting-form#accept-manually-entered-duration-longer
# spec:test mutual-practice-meeting#require-my-duration-whole-number-minutes
# spec:test mutual-practice-meeting#refuse-save-my-duration-greater-total
# spec:test mutual-practice-meeting#link-mutual-practice-meeting-client
async def test_long_meeting_keeps_its_instant_and_start_day(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("long_meeting")
    viewer = await account_stand.add_account("meeting_viewer")
    await account_stand.activate(leader)
    headers = bearer(leader)
    starts_at = "2025-10-31T23:50:00+01:00"
    body: dict[str, object] = {
        "type": "mutual_practice",
        "with_whom": "Practice partner",
        "starts_at": starts_at,
        "duration_minutes": 1600,
        "my_duration_minutes": 1500,
        "place": "online",
    }
    missing = {
        key: value for key, value in body.items() if key != "my_duration_minutes"
    }
    for invalid in (
        missing,
        {**body, "my_duration_minutes": 0},
        {**body, "my_duration_minutes": 1601},
    ):
        problem(
            await client.post(MEETINGS, json=invalid, headers=headers),
            400,
            ErrorCode.MY_DURATION_INVALID,
        )
    for invalid_shape in (
        {**body, "my_duration_minutes": 20.5},
        {**body, "price": "10"},
        {**body, "client_id": str(viewer.account.id)},
        {**body, "currency": "EUR"},
        {**body, "payment_type": "pro_bono"},
        {**body, "duration_minutes": 2_147_483_648},
        {**body, "starts_at": "2025-10-31T23:50:00"},
        {**body, "starts_at": 1761951000},
        {**body, "starts_at": "9999-12-31T23:59:00Z"},
    ):
        assert (
            await client.post(MEETINGS, json=invalid_shape, headers=headers)
        ).status_code == 422

    saved = await post_meeting(account_stand, leader, body)
    instant = datetime(2025, 10, 31, 22, 50, tzinfo=UTC)
    assert saved.starts_at == instant and saved.id.version == 7
    assert saved.type == MeetingType.MUTUAL_PRACTICE
    assert (
        saved.source == MeetingSource.SPECIALIST
        and saved.status == MeetingStatus.SCHEDULED
    )
    assert saved.duration_minutes == 1600 and saved.my_duration_minutes == 1500
    assert saved.price is None and saved.payment_type is None and saved.client is None

    for shown, expected in (("2025-10-31", [saved.id]), ("2025-11-01", [])):
        view = _list(
            await client.get(
                MEETINGS, params={"from": shown, "to": shown}, headers=headers
            )
        )
        assert [meeting.id for meeting in view.items] == expected
        assert view.pending_outcomes_count == 1
    october = _calendar(
        await client.get(
            f"{MEETINGS}/calendar", params={"month": "2025-10"}, headers=headers
        )
    )
    assert october.model_dump(mode="json") == {
        "month": "2025-10",
        "days": ["2025-10-31"],
    }
    november = _calendar(
        await client.get(
            f"{MEETINGS}/calendar", params={"month": "2025-11"}, headers=headers
        )
    )
    assert november.days == []

    assert (
        await client.patch(
            "/api/v1/account", json={"time_zone": "Europe/Moscow"}, headers=headers
        )
    ).status_code == 200
    day = "2025-11-01"
    moved_view = _list(
        await client.get(MEETINGS, params={"from": day, "to": day}, headers=headers)
    )
    assert [meeting.starts_at for meeting in moved_view.items] == [instant]
    moved_calendar = _calendar(
        await client.get(
            f"{MEETINGS}/calendar", params={"month": "2025-11"}, headers=headers
        )
    )
    assert moved_calendar.days == [date(2025, 11, 1)]

    path = f"{MEETINGS}/{saved.id}"
    assert (
        await client.patch(
            path, json={"starts_at": "9999-12-31T23:59:00Z"}, headers=headers
        )
    ).status_code == 422
    completed = meeting_from(
        await client.put(
            f"{path}/outcome",
            json={"status": "completed", "actual_duration_minutes": 1550},
            headers=headers,
        )
    )
    assert completed.actual_duration_minutes == 1550
    assert completed.starts_at == saved.starts_at and completed.balance_charge is None
    assert completed.client_card is None and not completed.awaiting_outcome

    assert (
        await client.get(
            MEETINGS, params={"from": "2025-11-02", "to": "2025-11-01"}, headers=headers
        )
    ).status_code == 422
    assert (
        await client.get(
            f"{MEETINGS}/calendar", params={"month": "0000-02"}, headers=headers
        )
    ).status_code == 422
    empty = _list(
        await client.get(
            MEETINGS, params={"from": day, "to": day}, headers=bearer(viewer)
        )
    )
    assert empty.items == [] and empty.pending_outcomes_count == 0
    assert empty.next_outcome_in_seconds is None
    problem(
        await client.get(f"{MEETINGS}/pending-outcomes", headers=bearer(viewer)),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )


# spec:test pending-outcomes#treat-meeting-leader-type-mutual
# spec:test pending-outcomes#list-meeting-end-time-not-passed
# spec:test pending-outcomes#list-screen-3-5-meeting-awaiting
# spec:test meeting-reschedule-cancel-delete#let-scheduled-meeting-time-passed
# spec:test meeting-reschedule-cancel-delete#introduce-rescheduled-cancelled-status
async def test_pending_outcomes_are_global_and_exclude_meetings_in_progress(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("pending_leader")
    await account_stand.activate(leader)
    headers = bearer(leader)
    now = datetime.now(UTC).replace(microsecond=0)
    oldest = await post_meeting(
        account_stand, leader, service_form(now - timedelta(hours=4))
    )
    mutual = await post_meeting(
        account_stand,
        leader,
        {
            "type": "mutual_practice",
            "starts_at": (now - timedelta(hours=2)).isoformat(),
            "place": "online",
            "duration_minutes": 30,
            "my_duration_minutes": 15,
        },
    )
    ongoing = await post_meeting(
        account_stand,
        leader,
        service_form(now - timedelta(hours=1), duration_minutes=120),
    )
    assert not ongoing.awaiting_outcome
    path = f"{MEETINGS}/pending-outcomes"
    pending = await client.get(path, headers=headers)
    assert pending.status_code == 200, pending.text
    queue = MeetingPendingOutcomeList.model_validate_json(pending.content)
    assert queue.count == 2 and [item.id for item in queue.items] == [
        oldest.id,
        mutual.id,
    ]
    assert all(item.awaiting_outcome for item in queue.items)

    far = (now.date() + timedelta(days=5)).isoformat()
    view = _list(
        await client.get(MEETINGS, params={"from": far, "to": far}, headers=headers)
    )
    assert view.items == [] and view.pending_outcomes_count == 2
    assert view.next_outcome_in_seconds is not None
    assert 0 < view.next_outcome_in_seconds <= 3600
    assert (
        await client.delete(f"{MEETINGS}/{oldest.id}", headers=headers)
    ).status_code == 204
    problem(
        await client.get(f"{MEETINGS}/{oldest.id}", headers=headers),
        404,
        ErrorCode.NOT_FOUND,
    )
    missed = meeting_from(
        await client.put(
            f"{MEETINGS}/{mutual.id}/outcome",
            json={"status": "not_taken_place"},
            headers=headers,
        )
    )
    assert missed.status == MeetingStatus.NOT_TAKEN_PLACE and missed.charged is False
    assert missed.actual_duration_minutes is None and missed.balance_charge is None

    in_progress_outcome = meeting_from(
        await client.put(
            f"{MEETINGS}/{ongoing.id}/outcome",
            json={"status": "completed"},
            headers=headers,
        )
    )
    assert in_progress_outcome.actual_duration_minutes == 120
    assert in_progress_outcome.status == MeetingStatus.COMPLETED
    empty = MeetingPendingOutcomeList.model_validate_json(
        (await client.get(path, headers=headers)).content
    )
    assert empty.items == [] and empty.count == 0
    schedule = _list(
        await client.get(MEETINGS, params={"from": far, "to": far}, headers=headers)
    )
    assert schedule.next_outcome_in_seconds is None


# spec:test meeting-form#create-meeting-status-scheduled-save
# spec:test meeting-form#show-overlap-time-name-existing
async def test_concurrent_overlap_scope_and_explicit_confirmation(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("overlap_leader")
    other = await account_stand.add_account("overlap_other")
    await account_stand.activate(leader)
    await account_stand.activate(other)
    headers = bearer(leader)
    starts_at = (datetime.now(UTC) + timedelta(days=3)).replace(microsecond=0)
    body = service_form(
        starts_at, with_whom="Provider", topic="Reference", comment="Private"
    )
    async with timeout(10):
        responses = await gather(
            client.post(MEETINGS, json=body, headers=headers),
            client.post(MEETINGS, json=body, headers=headers),
        )
    assert sorted(response.status_code for response in responses) == [201, 409]
    meeting = meeting_from(
        next(response for response in responses if response.status_code == 201), 201
    )
    conflict = problem(
        next(response for response in responses if response.status_code == 409),
        409,
        ErrorCode.MEETING_OVERLAP,
    )
    assert conflict.details is not None
    existing = Meeting.model_validate(conflict.details["meeting"])
    assert existing.id == meeting.id and existing.with_whom == "Provider"
    assert existing.starts_at == starts_at and existing.comment == "Private"
    assert meeting.status == MeetingStatus.SCHEDULED and meeting.invite_url is None

    await post_meeting(account_stand, other, body)
    path = f"{MEETINGS}/{meeting.id}"
    problem(await client.get(path, headers=bearer(other)), 404, ErrorCode.NOT_FOUND)
    problem(
        await client.patch(path, json={"comment": "Forbidden"}, headers=bearer(other)),
        404,
        ErrorCode.NOT_FOUND,
    )
    assert (
        await client.get(f"{MEETINGS}/bad-uuid", headers=headers)
    ).status_code == 422
    assert (
        await client.delete(path, params={"refund": "bad-bool"}, headers=headers)
    ).status_code == 422
    starts_next = starts_at + timedelta(hours=1)
    adjacent = await post_meeting(account_stand, leader, service_form(starts_next))
    problem(
        await client.patch(
            path, json={"starts_at": starts_next.isoformat()}, headers=headers
        ),
        409,
        ErrorCode.MEETING_OVERLAP,
    )
    changed = meeting_from(
        await client.patch(
            path,
            json={"starts_at": starts_next.isoformat(), "allow_overlap": True},
            headers=headers,
        )
    )
    assert changed.status == MeetingStatus.SCHEDULED and changed.id != adjacent.id
    assert changed.starts_at == adjacent.starts_at
    assert changed.source == MeetingSource.SPECIALIST and changed.comment == "Private"

    overlap = await post_meeting(
        account_stand, leader, service_form(starts_next, allow_overlap=True)
    )
    assert overlap.starts_at == changed.starts_at and overlap.id != changed.id
    problem(
        await client.put(
            f"{path}/outcome", json={"status": "completed"}, headers=headers
        ),
        409,
        ErrorCode.MEETING_NOT_STARTED,
    )


# spec:test meeting-form#default-currency-personal-therapy
async def test_defaults_skip_occupied_and_nonexistent_civil_hours(
    account_stand: AccountStand,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("defaults_leader")
    await account_stand.activate(leader)
    headers = bearer(leader)
    assert (
        await client.patch(
            "/api/v1/account",
            json={
                "leader": {
                    "default_currency": "EUR",
                    "session_duration_minutes": 75,
                    "default_meeting_link": "https://meet.example.com/room",
                }
            },
            headers=headers,
        )
    ).status_code == 200

    async def defaults_at(
        session: AsyncSession,
        account: Account,
        day: date,
        with_whom: str | None,
        _now: datetime,
    ) -> MeetingDefaults:
        return await meeting_defaults(
            session, account, day, with_whom, datetime(2025, 3, 29, 23, 15, tzinfo=UTC)
        )

    monkeypatch.setattr(meeting_router, "meeting_defaults", defaults_at)
    await post_meeting(
        account_stand,
        leader,
        service_form(
            datetime(2025, 3, 30, 0, 30, tzinfo=UTC),
            with_whom="Provider",
            duration_minutes=30,
            currency="USD",
        ),
    )
    params = {"date": "2025-03-30", "with_whom": "Provider"}
    result = await client.get(f"{MEETINGS}/defaults", params=params, headers=headers)
    assert result.status_code == 200, result.text
    found = MeetingDefaults.model_validate_json(result.content)
    assert found.starts_at == datetime(2025, 3, 30, 1, tzinfo=UTC)
    local = found.starts_at.astimezone(ZoneInfo("Europe/Belgrade"))
    assert (local.hour, local.minute) == (3, 0)
    assert found.currency == Currency.USD and found.duration_minutes == 75
    assert found.meeting_link == "https://meet.example.com/room"

    await post_meeting(
        account_stand,
        leader,
        service_form(
            datetime(2025, 3, 30, 0, tzinfo=UTC),
            duration_minutes=1320,
            allow_overlap=True,
        ),
    )
    fallback = await client.get(
        f"{MEETINGS}/defaults",
        params={**params, "with_whom": "Different provider"},
        headers=headers,
    )
    assert fallback.status_code == 200
    defaults = MeetingDefaults.model_validate_json(fallback.content)
    assert defaults.starts_at == datetime(2025, 3, 30, 0, tzinfo=UTC)
    assert defaults.currency == Currency.EUR


# spec:test time-zone-handling#take-other-party-zone-only-linked
async def test_meeting_embeds_scoped_client_photo_and_linked_zone(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    owner = await account_stand.add_account("meeting_owner")
    attendee = await account_stand.add_account("meeting_attendee")
    await account_stand.activate(owner)
    await account_stand.activate(attendee)
    headers = bearer(owner)
    attendee_headers = bearer(attendee)
    assert (
        await client.patch(
            "/api/v1/account",
            json={"time_zone": "Asia/Tokyo"},
            headers=attendee_headers,
        )
    ).status_code == 200
    card = await create_card(
        account_stand,
        owner,
        {"name": "Card label", "email": " private reference ", "rate": "100"},
    )
    photo = await client.put(
        f"{CLIENTS}/{card.id}/photo",
        files={"file": ("photo.png", PNG, "image/png")},
        headers=headers,
    )
    assert photo.status_code == 200, photo.text
    body = {
        "type": "client_session",
        "client_id": str(card.id),
        "starts_at": (datetime.now(UTC) + timedelta(days=3)).isoformat(),
        "duration_minutes": 60,
        "place": "online",
        "price": "100",
    }
    saved = await post_meeting(account_stand, owner, body)
    assert (
        saved.client is not None
        and saved.client.name == "Card label"
        and saved.client.time_zone is None
    )
    assert (
        saved.client_card is not None
        and saved.client_card.email == " private reference "
    )
    assert saved.invite_url == f"{owner.account.address_url}/meet/{saved.id}"
    linked = await client.put(
        f"{CLIENTS}/{card.id}/link",
        json={"login": attendee.account.login},
        headers=headers,
    )
    assert linked.status_code == 200
    path = f"{MEETINGS}/{saved.id}"
    refreshed = meeting_from(await client.get(path, headers=headers))
    assert refreshed.client is not None and refreshed.client.time_zone == "Asia/Tokyo"
    assert refreshed.client.linked and refreshed.client.photo_url is not None
    photo_url = refreshed.client.photo_url
    assert (await client.get(photo_url, headers=headers)).content == PNG
    problem(
        await client.get(photo_url, headers=attendee_headers), 404, ErrorCode.NOT_FOUND
    )
    problem(await client.get(path, headers=attendee_headers), 404, ErrorCode.NOT_FOUND)
