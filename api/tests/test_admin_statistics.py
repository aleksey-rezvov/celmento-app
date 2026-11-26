from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID, uuid7

import pytest
from sqlalchemy import select
from test_account import ACCOUNT, AccountStand, account_stand
from test_admin_api import ADMIN, JOURNAL, admin_access, admin_result
from test_clients_api import bearer, create_card
from test_meeting_notifications import mail_outbox
from test_meetings_api import MEETINGS, meeting_from, post_meeting, service_form
from test_notes_api import NOTES, post_note
from test_plans_api import LIMIT_HITS, PLANS, REQUESTS
from test_public_bookings import (
    BOOKINGS,
    FrozenTime,
    booking_form,
    booking_from,
    freeze_booking_time,
)
from test_specialists_api import link_card, validation_problem
from test_specialists_bookings import BOOKINGS as APP_BOOKINGS

from celmento_api.models.account import Account
from celmento_api.models.enums import AcceptanceKind, AdminAction, Language
from celmento_api.models.legal import Acceptance
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.admin import AdminJournalList, AdminStatistics
from celmento_api.services import app_bookings

__all__: list[str] = ["account_stand", "mail_outbox"]

STATS: str = f"{ADMIN}/statistics"


async def _meeting_id(stand: AccountStand, public_id: UUID) -> UUID:
    async with stand.session() as session:
        meeting_id = await session.scalar(
            select(Meeting.meeting_id).where(Meeting.public_id == public_id)
        )
        assert meeting_id is not None
        return meeting_id


# spec:test admin-feedback-stats#answer-statistics-question-number
# spec:test admin-feedback-stats#answer-number-meetings-outcome-share
# spec:test admin-feedback-stats#answer-number-bookings-made-public
# spec:test admin-feedback-stats#answer-number-notes-number-tags
# spec:test admin-feedback-stats#answer-number-leaders-ran-free
# spec:test admin-feedback-stats#answer-interface-language-usage-number
# spec:test admin-feedback-stats#answer-number-subscription-requests
# spec:test admin-feedback-stats#compute-indicator-period-administrator
# spec:test admin-feedback-stats#include-names-emails-other-personal
async def test_statistics_are_aggregate_and_keep_original_public_booking_cohort(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stand = account_stand
    now = datetime(2025, 6, 2, 7, tzinfo=UTC)
    freeze_booking_time(monkeypatch, now)
    monkeypatch.setattr(app_bookings, "datetime", FrozenTime(now))
    lead = await stand.add_account("statistics_specialist")
    already_registered = await stand.add_account("prior_guest")
    await stand.activate(lead)
    client, headers = stand.client, bearer(lead)
    _, admin = await admin_access(stand)
    report_before = admin_result(
        await client.get(STATS, headers=admin), AdminStatistics
    )
    assert (
        report_before.bookings.count == 0
        and report_before.bookings.guests_signed_in_share is None
    )
    assert report_before.meetings.not_taken_place_share is None
    async with stand.session() as session:
        recorded_account = await session.get(Account, already_registered.account.id)
        assert recorded_account is not None
        recorded_account.created_at = now - timedelta(days=1)
        await session.commit()

    start = now + timedelta(hours=3)
    first = booking_from(
        await client.post(
            BOOKINGS,
            json=await booking_form(
                stand,
                lead,
                start,
                email="later_registrant@example.com",
            ),
        )
    )
    second = booking_from(
        await client.post(
            BOOKINGS,
            json=await booking_form(
                stand,
                lead,
                start + timedelta(hours=1),
                email="later_registrant@example.com",
            ),
        )
    )
    booking_from(
        await client.post(
            BOOKINGS,
            json=await booking_form(
                stand,
                lead,
                start + timedelta(hours=2),
                email=already_registered.account.email,
            ),
        )
    )
    cancelled_id, reassigned_id = (
        await _meeting_id(stand, first.id),
        await _meeting_id(stand, second.id),
    )
    cancelled = await client.delete(f"{MEETINGS}/{cancelled_id}", headers=headers)
    assert cancelled.status_code == 204, cancelled.text
    replacement = await create_card(stand, lead, {"name": "Unrelated replacement card"})
    updated = meeting_from(
        await client.patch(
            f"{MEETINGS}/{reassigned_id}",
            headers=headers,
            json={"client_id": str(replacement.id)},
        )
    )
    assert updated.client_card is not None and updated.client_card.id == replacement.id
    later = await stand.add_account("later_registrant")
    await link_card(stand, lead, replacement.id, later)
    app = await client.post(
        APP_BOOKINGS,
        headers=bearer(later),
        json={
            "specialist_id": str(lead.account.id),
            "starts_at": (start + timedelta(hours=3)).isoformat(),
        },
    )
    assert app.status_code == 201, app.text
    await post_meeting(
        stand,
        lead,
        service_form(start + timedelta(hours=4), outcome={"status": "completed"}),
    )
    await post_meeting(
        stand,
        lead,
        service_form(
            start + timedelta(hours=5),
            outcome={"status": "not_taken_place", "charged": False},
        ),
    )
    note = await post_note(
        stand, lead, {"title": "Statistics sample", "text": "Private statistics note"}
    )
    tagged = await client.post(
        f"{NOTES}/{note.id}/tags",
        headers=headers,
        json={"target_id": str(replacement.id)},
    )
    assert tagged.status_code == 201, tagged.text
    for _ in range(2):
        assert (await client.post(LIMIT_HITS, headers=headers)).status_code == 200
        assert (await client.get(PLANS, headers=headers)).status_code == 200
    assert (
        await client.post(
            REQUESTS, headers=headers, json={"term": "month", "source": "profile"}
        )
    ).status_code == 201
    await stand.activate(already_registered)
    assert (
        await client.patch(
            ACCOUNT, headers=bearer(already_registered), json={"language": "ru"}
        )
    ).status_code == 200
    assert (
        await client.post(
            REQUESTS,
            headers=bearer(already_registered),
            json={"term": "year", "source": "limit_screen"},
        )
    ).status_code == 201

    async with stand.session() as session:
        archived_booking = await session.scalar(
            select(Acceptance).where(
                Acceptance.guest_booking_id == cancelled_id,
                Acceptance.kind == AcceptanceKind.TERMS_OF_USE.value,
            )
        )
        assert archived_booking is not None and archived_booking.meeting_id is None
        original_card_id = archived_booking.guest_client_card_id
        assert original_card_id is not None and original_card_id != replacement.id
        moved = await session.scalar(
            select(Acceptance).where(
                Acceptance.guest_booking_id == reassigned_id,
                Acceptance.kind == AcceptanceKind.TERMS_OF_USE.value,
            )
        )
        assert moved is not None and moved.guest_client_card_id == original_card_id
        session.add(
            Acceptance(
                guest_booking_id=uuid7(),
                kind=AcceptanceKind.TERMS_OF_USE.value,
                version=archived_booking.version,
                accepted_at=now,
            )
        )
        await session.commit()

    response = await client.get(STATS, headers=admin)
    all_time = admin_result(response, AdminStatistics)
    assert all_time.accounts.total == all_time.accounts.new == 3
    assert all_time.activations.total == all_time.activations.new == 2
    assert all_time.meetings.count == 5 and all_time.meetings.with_outcome == 2
    assert all_time.meetings.not_taken_place_share == 0.5
    assert (
        all_time.bookings.count == 4 and all_time.bookings.guests_signed_in_share == 0.5
    )
    assert all_time.notes.count > report_before.notes.count and all_time.notes.tags == 1
    assert (
        all_time.plan_limit.leaders_hit_limit == 1
        and all_time.plan_limit.plans_screen_openings == 2
    )
    assert {row.language: row.accounts for row in all_time.languages} == {
        Language.RU: 1,
        Language.EN: 2,
    }
    assert all_time.subscription_requests.total == 2
    assert (
        all_time.subscription_requests.month == all_time.subscription_requests.year == 1
    )
    for private_value in (
        "later_registrant",
        "Private statistics note",
        "Unrelated replacement card",
        str(lead.account.id),
    ):
        assert private_value not in response.text
    day = {"from": "2025-06-02", "to": "2025-06-02"}
    period = admin_result(
        await client.get(STATS, headers=admin, params=day), AdminStatistics
    )
    assert period.meetings == all_time.meetings and period.bookings == all_time.bookings
    assert (
        period.accounts.total == 3
        and period.accounts.new == 0
        and period.activations.new == 0
    )
    assert (
        period.languages == all_time.languages
        and period.subscription_requests.total == 0
    )
    assert (
        period.notes.count
        == period.notes.tags
        == period.plan_limit.leaders_hit_limit
        == 0
    )
    assert len(mail_outbox) == 4
    validation_problem(
        await client.get(
            STATS, headers=admin, params={"from": "2025-06-02", "to": "2025-06-01"}
        ),
        "query",
        "value_error",
    )
    entries = admin_result(
        await client.get(JOURNAL, headers=admin), AdminJournalList
    ).items
    assert entries[0].action == AdminAction.GET_STATISTICS and entries[0].params == day
