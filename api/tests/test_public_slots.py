from datetime import UTC, date, datetime, time, timedelta
from email.message import EmailMessage

import pytest
from httpx import Response
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, create_card, list_from, problem
from test_meeting_notifications import mail_outbox
from test_meetings_api import post_meeting, service_form
from test_meetings_ledger import client_form
from test_public_bookings import (
    BOOKING_NOW,
    BOOKINGS,
    PUBLIC,
    booking_form,
    freeze_booking_time,
)

from celmento_api.models.enums import ErrorCode, Weekday
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.public import BookingSlotList, PublicSpecialistPage

__all__: list[str] = ["account_stand", "mail_outbox"]


def _slots(response: Response) -> BookingSlotList:
    assert response.status_code == 200, response.text
    return BookingSlotList.model_validate_json(response.content)


async def _working_week(
    stand: AccountStand,
    leader: SignInSession,
    working: set[Weekday],
    opening: str,
    closing: str,
    zone: str,
) -> None:
    response = await stand.client.patch(
        ACCOUNT,
        headers=bearer(leader),
        json={
            "time_zone": zone,
            "leader": {
                "working_hours": [
                    {
                        "weekday": day.value,
                        "working": day in working,
                        "start": opening,
                        "end": closing,
                    }
                    for day in Weekday
                ]
            },
        },
    )
    assert response.status_code == 200, response.text


async def _slots_on(
    stand: AccountStand, login: str, day: date, zone: str
) -> BookingSlotList:
    return _slots(
        await stand.client.get(
            f"{PUBLIC}/specialists/{login}/slots",
            params={"from": day.isoformat(), "to": day.isoformat(), "time_zone": zone},
        )
    )


# spec:test public-booking-page#start-slots-30-minutes-start
# spec:test public-booking-page#offer-slot-only-rule-holds
# spec:test public-booking-page#compute-slots-leader-current-working
async def test_slots_apply_exact_horizon_attended_and_owner_windows(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    freeze_booking_time(monkeypatch)
    stand = account_stand
    leader = await stand.add_account("slot_specialist")
    teammate = await stand.add_account("occupied_colleague")
    for actor in (leader, teammate):
        await stand.activate(actor)
    await _working_week(stand, leader, {Weekday.MON}, "07:00", "13:00", "UTC")
    login = leader.account.login
    first = BOOKING_NOW + timedelta(hours=3)
    last = BOOKING_NOW + timedelta(weeks=4)
    initial = await _slots_on(stand, login, first.date(), "UTC")
    assert initial.has_available_slots and initial.next_free_date == first.date()
    assert [row.starts_at for row in initial.items] == [
        first + timedelta(minutes=30 * offset) for offset in range(5)
    ]
    assert all(row.duration_minutes == 60 for row in initial.items)
    horizon = await _slots_on(stand, login, last.date(), "UTC")
    assert [row.starts_at for row in horizon.items] == [last]
    assert horizon.next_free_date == last.date()
    distant = await _slots_on(stand, login, last.date() + timedelta(days=1), "UTC")
    assert (
        not distant.items
        and distant.next_free_date is None
        and distant.has_available_slots
    )
    yesterday = await _slots_on(stand, login, first.date() - timedelta(days=1), "UTC")
    assert not yesterday.items and yesterday.next_free_date == first.date()

    await post_meeting(stand, leader, service_form(first + timedelta(hours=1)))
    occupied = await create_card(stand, teammate, {"name": "Their client"})
    assert (
        await stand.client.put(
            f"{CLIENTS}/{occupied.id}/link",
            headers=bearer(teammate),
            json={"login": login},
        )
    ).status_code == 200
    await post_meeting(
        stand, teammate, client_form(occupied.id, first + timedelta(hours=2))
    )
    remaining = await _slots_on(stand, login, first.date(), "UTC")
    assert [row.starts_at for row in remaining.items] == [first]
    farther = await _slots_on(
        stand, login, first.date() - timedelta(days=1), "Pacific/Pago_Pago"
    )
    assert [row.starts_at for row in farther.items] == [first]

    body = await booking_form(stand, leader, first)
    for offset in (30, 120):
        picked = first + timedelta(minutes=offset)
        failed = await stand.client.post(
            BOOKINGS, json={**body, "starts_at": picked.isoformat()}
        )
        problem(failed, 409, ErrorCode.SLOT_TAKEN)
    for invalid in (
        first - timedelta(minutes=30),
        first + timedelta(minutes=1),
        last + timedelta(minutes=30),
        first + timedelta(days=1),
    ):
        failed = await stand.client.post(
            BOOKINGS, json={**body, "starts_at": invalid.isoformat()}
        )
        problem(failed, 409, ErrorCode.SLOT_INVALID)
    malformed_zone = await stand.client.get(
        f"{PUBLIC}/specialists/{login}/slots",
        params={
            "from": first.date().isoformat(),
            "to": first.date().isoformat(),
            "time_zone": "not-a-zone",
        },
    )
    assert malformed_zone.status_code == 422
    await post_meeting(stand, leader, service_form(last))
    only_before = await _slots_on(stand, login, last.date(), "UTC")
    assert (
        not only_before.items
        and only_before.next_free_date is None
        and only_before.has_available_slots
    )
    await _working_week(stand, leader, set(), "07:00", "13:00", "UTC")
    nothing = await _slots_on(stand, login, last.date(), "UTC")
    assert (
        not nothing.items
        and nothing.next_free_date is None
        and not nothing.has_available_slots
    )


@pytest.mark.parametrize(
    ("local_day", "utc_times"),
    [
        (date(2025, 3, 30), ("00:30", "01:00", "01:30")),
        (
            date(2025, 10, 26),
            ("23:30", "00:00", "00:30", "01:00", "01:30", "02:00", "02:30"),
        ),
    ],
)
async def test_dst_slots_skip_gaps_and_keep_both_valid_folds(
    account_stand: AccountStand,
    monkeypatch: pytest.MonkeyPatch,
    local_day: date,
    utc_times: tuple[str, ...],
) -> None:
    freeze_booking_time(
        monkeypatch, datetime.combine(local_day - timedelta(days=1), time(12), UTC)
    )
    stand = account_stand
    leader = await stand.add_account("dst_specialist")
    await stand.activate(leader)
    await _working_week(
        stand, leader, {Weekday.SUN}, "01:30", "04:30", "Europe/Belgrade"
    )
    offered = await _slots_on(stand, leader.account.login, local_day, "Europe/Belgrade")
    assert (
        tuple(
            slot.starts_at.astimezone(UTC).strftime("%H:%M") for slot in offered.items
        )
        == utc_times
    )
    assert len({slot.starts_at for slot in offered.items}) == len(utc_times)
    assert all(slot.duration_minutes == 60 for slot in offered.items)


# spec:test public-booking-page#show-page-only-login-account
# spec:test public-booking-page#resolve-login-only-accounts-contour
# spec:test public-booking-page#look-up-login-other-contour
# spec:test public-booking-page#reveal-leader-meetings-clients-other
# spec:test default-rate-currency#supply-profile-rate-currency-price
async def test_public_profile_is_scoped_and_draft_cannot_follow_reused_login(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    freeze_booking_time(monkeypatch)
    stand = account_stand
    original = await stand.add_account("available_address")
    successor = await stand.add_account("other_address")
    client = stand.client
    endpoint = f"{PUBLIC}/specialists/{original.account.login}"
    unknown = f"{PUBLIC}/specialists/no_such_specialist"
    # spec:test booking-link-login#serve-booking-page-login-non-leader
    problem(await client.get(endpoint), 404, ErrorCode.NOT_FOUND)
    problem(await client.get(unknown), 404, ErrorCode.NOT_FOUND)
    for actor in (original, successor):
        await stand.activate(actor)
    response = await client.get(
        f"{PUBLIC}/specialists/{original.account.login.upper()}"
    )
    assert response.status_code == 200, response.text
    page = PublicSpecialistPage.model_validate_json(response.content)
    # spec:test booking-link-login#make-booking-link-work-moment
    assert page.login == original.account.login and page.price is None
    assert page.session_duration_minutes == 60 and page.session_format.value == "online"
    assert original.account.email not in response.text and page.main_contact is None
    assert (
        await client.patch(
            ACCOUNT,
            headers=bearer(original),
            json={
                "phone": "+1000000000",
                "leader": {
                    "default_rate": "135.25",
                    "default_currency": "USD",
                    "main_channel": "phone",
                },
            },
        )
    ).status_code == 200
    enriched = PublicSpecialistPage.model_validate_json(
        (await client.get(endpoint)).content
    )
    assert enriched.price is not None and enriched.price.amount == "135.25"
    assert enriched.price.currency.value == "USD"
    assert (
        enriched.main_contact is not None
        and enriched.main_contact.value == "+1000000000"
    )
    assert enriched.booking_context == page.booking_context
    draft = await booking_form(stand, original, BOOKING_NOW + timedelta(hours=3))
    assert (
        await client.patch(
            ACCOUNT, headers=bearer(original), json={"login": "different_address"}
        )
    ).status_code == 200
    problem(await client.get(endpoint), 404, ErrorCode.NOT_FOUND)
    assert (
        await client.patch(
            ACCOUNT, headers=bearer(successor), json={"login": original.account.login}
        )
    ).status_code == 200
    changed = PublicSpecialistPage.model_validate_json(
        (await client.get(endpoint)).content
    )
    assert changed.booking_context != draft["booking_context"]
    problem(await client.post(BOOKINGS, json=draft), 409, ErrorCode.CONFLICT)
    assert not mail_outbox
    assert list_from(await client.get(CLIENTS, headers=bearer(successor))).items == []
