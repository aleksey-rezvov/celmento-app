from asyncio import gather
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import pytest
from httpx import Response
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import bearer, create_card, problem
from test_meeting_notifications import mail_outbox
from test_meetings_api import MEETINGS, post_meeting, service_form
from test_public_bookings import (
    BOOKING_NOW,
    PUBLIC,
    FrozenTime,
    booking_form,
    freeze_booking_time,
)
from test_public_bookings import (
    BOOKINGS as PUBLIC_BOOKINGS,
)
from test_records_api import records_summary
from test_specialists_api import SPECIALISTS, attended_from, link_card
from test_specialists_bookings import BOOKINGS as APP_BOOKINGS

from celmento_api.models.enums import ErrorCode, Weekday
from celmento_api.routers import specialists
from celmento_api.schemas.meetings import BookingTimeBlock, MeetingList
from celmento_api.schemas.public import BookingSlotList
from celmento_api.services import app_bookings

__all__: list[str] = ["account_stand", "mail_outbox"]

BLOCKS: str = f"{MEETINGS}/booking-blocks"


def _block(response: Response) -> BookingTimeBlock:
    assert response.status_code == 201, response.text
    return BookingTimeBlock.model_validate_json(response.content)


def _meetings(response: Response) -> MeetingList:
    assert response.status_code == 200, response.text
    return MeetingList.model_validate_json(response.content)


def _slots(response: Response) -> list[datetime]:
    assert response.status_code == 200, response.text
    return [
        slot.starts_at
        for slot in BookingSlotList.model_validate_json(response.content).items
    ]


# spec:test booking-time-blocks#owned-blocks
# spec:test booking-time-blocks#validate-local-interval
async def test_booking_blocks_are_owned_local_and_retry_safe(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    client = stand.client
    leader = await stand.add_account("closes_booking_time")
    inactive = await stand.add_account("cannot_close_booking")
    other = await stand.add_account("other_booking_owner")
    await stand.activate(leader)
    await stand.activate(other)
    owner = bearer(leader)
    date = "2026-10-25"

    problem(await client.post(BLOCKS, json={"date": date}), 401, ErrorCode.UNAUTHORIZED)
    problem(
        await client.post(BLOCKS, headers=bearer(inactive), json={"date": date}),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )
    responses = await gather(
        client.post(BLOCKS, headers=owner, json={"date": date}),
        client.post(
            BLOCKS, headers=owner, json={"date": date, "start": None, "end": None}
        ),
    )
    whole = _block(responses[0])
    assert whole == _block(responses[1])
    assert whole.starts_at == datetime(2026, 10, 24, 22, tzinfo=UTC)
    assert whole.ends_at == datetime(2026, 10, 25, 23, tzinfo=UTC)
    assert whole.ends_at - whole.starts_at == timedelta(hours=25)
    repeated = _block(
        await client.post(
            BLOCKS, headers=owner, json={"date": date, "start": "02:15", "end": "02:45"}
        )
    )
    assert repeated.starts_at == datetime(2026, 10, 25, 0, 15, tzinfo=UTC)
    assert repeated.ends_at == datetime(2026, 10, 25, 0, 45, tzinfo=UTC)

    for body in (
        {"date": "2026-03-29", "start": "02:15", "end": "03:15"},
        {"date": date, "start": "13:00"},
        {"date": date, "start": "13:00", "end": "12:00"},
        {"date": "9999-12-31"},
    ):
        assert (await client.post(BLOCKS, headers=owner, json=body)).status_code == 422

    day = {"from": date, "to": date}
    owned = _meetings(await client.get(MEETINGS, headers=owner, params=day))
    assert owned.booking_blocks == [whole, repeated]
    path = f"{BLOCKS}/{whole.id}"
    problem(
        await client.delete(path, headers=bearer(inactive)),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )
    problem(await client.delete(path, headers=bearer(other)), 404, ErrorCode.NOT_FOUND)
    assert not _meetings(
        await client.get(MEETINGS, headers=bearer(other), params=day)
    ).booking_blocks
    standalone = await client.delete(path, headers=owner)
    assert standalone.status_code == 204 and standalone.content == b""
    problem(await client.delete(path, headers=owner), 404, ErrorCode.NOT_FOUND)
    assert _meetings(
        await client.get(MEETINGS, headers=owner, params=day)
    ).booking_blocks == [repeated]


# spec:test public-booking-page#start-slots-30-minutes-start
# spec:test booking-time-blocks#exclude-from-booking
# spec:test booking-time-blocks#only-future-bookings-affected
# spec:test working-hours-booking-rules#use-working-hours-only-public
async def test_closures_remove_slots_from_both_paths_without_changing_existing_meetings(
    account_stand: AccountStand,
    monkeypatch: pytest.MonkeyPatch,
    mail_outbox: list[EmailMessage],
) -> None:
    freeze_booking_time(monkeypatch)
    clock = FrozenTime(BOOKING_NOW)
    monkeypatch.setattr(specialists, "datetime", clock)
    monkeypatch.setattr(app_bookings, "datetime", clock)
    stand = account_stand
    client = stand.client
    leader = await stand.add_account("split_availability_specialist")
    attendee = await stand.add_account("split_availability_client")
    await stand.activate(leader)
    owner, linked = bearer(leader), bearer(attendee)
    profile = await client.patch(
        ACCOUNT,
        headers=owner,
        json={
            "time_zone": "UTC",
            "leader": {
                "working_hours": [
                    {
                        "weekday": day.value,
                        "working": day == Weekday.MON,
                        "start": "10:00",
                        "end": "12:00",
                        "additional_intervals": (
                            [{"start": "13:15", "end": "16:15"}]
                            if day == Weekday.MON
                            else []
                        ),
                    }
                    for day in Weekday
                ]
            },
        },
    )
    assert profile.status_code == 200, profile.text
    card = await create_card(stand, leader, {"name": "Booked client"})
    await link_card(stand, leader, card.id, attendee)

    first = BOOKING_NOW + timedelta(hours=3)
    date = first.date().isoformat()
    day = {"from": date, "to": date}
    endpoints: tuple[tuple[str, dict[str, str]], ...] = (
        (f"{PUBLIC}/specialists/{leader.account.login}/slots", {}),
        (f"{SPECIALISTS}/{leader.account.id}/slots", linked),
    )
    before = [
        first + timedelta(minutes=offset)
        for offset in (0, 30, 60, 195, 225, 255, 285, 315)
    ]
    for endpoint, headers in endpoints:
        assert (
            _slots(
                await client.get(
                    endpoint, headers=headers, params={**day, "time_zone": "UTC"}
                )
            )
            == before
        )

    app_form = {
        "specialist_id": str(leader.account.id),
        "starts_at": first.isoformat(),
        "place": "online",
    }
    booked = attended_from(
        await client.post(APP_BOOKINGS, headers=linked, json=app_form), 201
    )
    meetings_before = _meetings(await client.get(MEETINGS, headers=owner, params=day))
    records_before = await records_summary(stand, leader, {})
    desired = first + timedelta(minutes=195)
    guest_form = await booking_form(stand, leader, desired)
    stale_linked = {**app_form, "starts_at": desired.isoformat()}

    partial = _block(
        await client.post(
            BLOCKS,
            headers=owner,
            json={"date": date, "start": "10:30", "end": "14:30"},
        )
    )
    for endpoint, headers in endpoints:
        assert (
            _slots(
                await client.get(
                    endpoint, headers=headers, params={**day, "time_zone": "UTC"}
                )
            )
            == before[-2:]
        )
    for endpoint, headers, body in (
        (PUBLIC_BOOKINGS, {}, guest_form),
        (APP_BOOKINGS, linked, stale_linked),
    ):
        problem(
            await client.post(endpoint, headers=headers, json=body),
            409,
            ErrorCode.SLOT_TAKEN,
        )
    assert mail_outbox == []

    whole = _block(await client.post(BLOCKS, headers=owner, json={"date": date}))
    for endpoint, headers in endpoints:
        assert not _slots(
            await client.get(
                endpoint, headers=headers, params={**day, "time_zone": "UTC"}
            )
        )
    after = _meetings(await client.get(MEETINGS, headers=owner, params=day))
    assert after.items == meetings_before.items and after.items[0].id == booked.id
    assert after.booking_blocks == [whole, partial]
    assert await records_summary(stand, leader, {}) == records_before
    during_gap = first + timedelta(hours=2)
    manual = await post_meeting(stand, leader, service_form(during_gap))
    assert manual.starts_at == during_gap

    for block in (whole, partial):
        assert (
            await client.delete(f"{BLOCKS}/{block.id}", headers=owner)
        ).status_code == 204
    for endpoint, headers in endpoints:
        assert (
            _slots(
                await client.get(
                    endpoint, headers=headers, params={**day, "time_zone": "UTC"}
                )
            )
            == before[2:]
        )
    reopened = attended_from(
        await client.post(APP_BOOKINGS, headers=linked, json=stale_linked), 201
    )
    assert reopened.starts_at == desired
