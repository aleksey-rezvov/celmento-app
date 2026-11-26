from collections.abc import Mapping
from datetime import UTC, date, datetime
from uuid import UUID

import pytest
from httpx import Response
from pydantic import BaseModel
from test_account import ACCOUNT, AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, create_card, problem
from test_clients_balance import balance_from
from test_meetings_api import post_meeting, service_form
from test_meetings_ledger import client_form
from test_public_bookings import FrozenTime
from test_specialists_api import archive_card, link_card, validation_problem

from celmento_api.models.enums import Currency, ErrorCode, RecordsPeriodKind
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.balance import ClientBalance
from celmento_api.schemas.money import Money
from celmento_api.schemas.records import (
    RecordsBalanceList,
    RecordsHoursLog,
    RecordsOperationList,
    RecordsSummary,
)
from celmento_api.services import account_access

__all__: list[str] = ["account_stand"]

RECORDS: str = "/api/v1/records"


def records_from[T: BaseModel](response: Response, model: type[T]) -> T:
    assert response.status_code == 200, response.text
    return model.model_validate_json(response.content)


def custom_period(start: str, end: str) -> dict[str, str]:
    return {"period": "custom", "from": start, "to": end}


async def records_summary(
    stand: AccountStand, leader: SignInSession, params: Mapping[str, str] | None = None
) -> RecordsSummary:
    return records_from(
        await stand.client.get(
            f"{RECORDS}/summary", headers=bearer(leader), params=params
        ),
        RecordsSummary,
    )


async def records_operations(
    stand: AccountStand, leader: SignInSession, params: Mapping[str, str] | None = None
) -> RecordsOperationList:
    return records_from(
        await stand.client.get(
            f"{RECORDS}/operations", headers=bearer(leader), params=params
        ),
        RecordsOperationList,
    )


async def records_hours(
    stand: AccountStand, leader: SignInSession, params: Mapping[str, str] | None = None
) -> RecordsHoursLog:
    return records_from(
        await stand.client.get(
            f"{RECORDS}/hours",
            headers=bearer(leader),
            params={"type": "practice", **(params or {})},
        ),
        RecordsHoursLog,
    )


async def add_payment(
    stand: AccountStand, leader: SignInSession, card_id: UUID, amount: str, on: str
) -> ClientBalance:
    return balance_from(
        await stand.client.post(
            f"{CLIENTS}/{card_id}/payments",
            headers=bearer(leader),
            json={"amount": amount, "date": on},
        ),
        201,
    )


# spec:test accounting-summary#interpret-period-year-current-calendar
# spec:test accounting-summary#assign-meeting-period-date-start
# spec:test time-zone-handling#assign-meeting-day-schedule-start
async def test_records_resolves_leader_only_civil_periods_and_moves_meeting_on_zone_change(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    stand = account_stand
    owner = await stand.add_account("records_period_owner")
    client, headers = stand.client, bearer(owner)
    for endpoint in ("summary", "operations", "hours?type=practice", "balances"):
        uri = f"{RECORDS}/{endpoint}"
        problem(await client.get(uri), 401, ErrorCode.UNAUTHORIZED)
        problem(
            await client.get(uri, headers=headers), 403, ErrorCode.ACTIVATION_REQUIRED
        )
    await stand.activate(owner)
    instant = datetime(2025, 8, 31, 23, 45, tzinfo=UTC)
    monkeypatch.setattr(account_access, "datetime", FrozenTime(instant))
    all_time = await records_summary(
        stand, owner, {"from": "2025-09-30", "to": "2025-09-01"}
    )
    assert all_time.period.kind == RecordsPeriodKind.ALL
    assert all_time.period.from_ is None and all_time.period.to is None
    assert (
        not all_time.has_outcomes
        and not all_time.income
        and all_time.practice_hours == 0
    )
    for kind, start, end in (
        ("year", date(2025, 1, 1), date(2025, 12, 31)),
        ("month", date(2025, 9, 1), date(2025, 9, 30)),
        ("week", date(2025, 9, 1), date(2025, 9, 7)),
    ):
        resolved = (await records_summary(stand, owner, {"period": kind})).period
        assert (resolved.kind, resolved.from_, resolved.to) == (
            RecordsPeriodKind(kind),
            start,
            end,
        )
    for query in ({"period": "custom"}, custom_period("2025-09-02", "2025-09-01")):
        for view in ("summary", "operations", "hours"):
            params = {**query, "type": "practice"} if view == "hours" else query
            validation_problem(
                await client.get(f"{RECORDS}/{view}", headers=headers, params=params),
                "query",
                "value_error",
            )
    assert (await client.get(f"{RECORDS}/hours", headers=headers)).status_code == 422

    recorded = await post_meeting(
        stand,
        owner,
        service_form(
            instant, outcome={"status": "completed", "actual_duration_minutes": 45}
        ),
    )
    august = custom_period("2025-08-31", "2025-08-31")
    september = custom_period("2025-09-01", "2025-09-01")
    sep = await records_summary(stand, owner, september)
    assert sep.personal_therapy_hours == 0.75
    assert sep.expenses == [Money(amount="-50", currency=Currency.RUB)]
    aug = await records_summary(stand, owner, august)
    assert aug.has_outcomes and not aug.expenses
    items = (await records_hours(stand, owner, {**september, "type": "therapy"})).items
    assert [(row.id, row.date) for row in items] == [(recorded.id, date(2025, 9, 1))]
    reply = await client.patch(
        ACCOUNT, headers=headers, json={"time_zone": "America/New_York"}
    )
    assert reply.status_code == 200, reply.text
    assert not (await records_summary(stand, owner, september)).expenses
    assert (await records_summary(stand, owner, august)).expenses == sep.expenses
    entries = (await records_operations(stand, owner, august)).items
    assert [(entry.id, entry.date) for entry in entries] == [
        (recorded.id, date(2025, 8, 31))
    ]
    items = (await records_hours(stand, owner, {**august, "type": "therapy"})).items
    assert [(row.id, row.date) for row in items] == [(recorded.id, date(2025, 8, 31))]
    monday = (await records_summary(stand, owner, {"period": "week"})).period
    assert monday.from_ == date(2025, 8, 25) and monday.to == date(2025, 8, 31)


# spec:test accounting-summary#compute-receipts-client-payments-dated
# spec:test accounting-summary#show-prepaid-debts-tile-sum-positive
# spec:test accounting-summary#open-prepaid-debts-tile-screen-title
# spec:test accounting-summary#keep-hours-amounts-archived-clients
# spec:test client-archive-restore#leave-hours-log-balance-amount
# spec:test meeting-outcome-recording#keep-outcome-hours-money-records
# spec:test hours-log#keep-hours-archived-clients-totals
# spec:test money-operations-feed#keep-rows-archived-clients
async def test_balances_use_today_and_keep_payments_before_outcomes_and_archived_debts(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    stand = account_stand
    leader = await stand.add_account("records_balance_leader")
    attendee = await stand.add_account("records_archived_attendee")
    await stand.activate(leader)
    client, headers = stand.client, bearer(leader)
    monkeypatch.setattr(
        account_access, "datetime", FrozenTime(datetime(2025, 3, 1, 0, 15, tzinfo=UTC))
    )
    large = await create_card(
        stand,
        leader,
        {
            "name": "Larger prepayment",
            "currency": "EUR",
            "rate": "0",
            "payment_type": "pro_bono",
        },
    )
    small = await create_card(
        stand, leader, {"name": "Smaller prepayment", "currency": "USD", "rate": "10"}
    )
    debt = await create_card(
        stand, leader, {"name": "Archived debtor", "currency": "EUR", "rate": "50"}
    )
    await add_payment(stand, leader, large.id, "420.42", "2025-03-01")
    await add_payment(stand, leader, small.id, "25", "2025-02-27")
    no_outcomes = await records_summary(stand, leader)
    assert not no_outcomes.has_outcomes and no_outcomes.completed_sessions == 0
    assert no_outcomes.income == no_outcomes.expenses == no_outcomes.debts == []
    assert (
        no_outcomes.receipts
        == no_outcomes.prepaid
        == [
            Money(amount="420.42", currency=Currency.EUR),
            Money(amount="25", currency=Currency.USD),
        ]
    )
    changed_zone = await client.patch(
        ACCOUNT, headers=headers, json={"time_zone": "America/Los_Angeles"}
    )
    assert changed_zone.status_code == 200, changed_zone.text
    after_zone = await records_summary(stand, leader)
    assert after_zone.receipts == no_outcomes.receipts
    assert after_zone.prepaid == [Money(amount="25", currency=Currency.USD)]
    shown = records_from(
        await client.get(f"{RECORDS}/balances", headers=headers), RecordsBalanceList
    )
    assert [row.client.id for row in shown.items] == [small.id]
    assert shown.items[0].balance.sessions_left == "2"

    await add_payment(stand, leader, large.id, "100", "2025-02-28")
    await link_card(stand, leader, debt.id, attendee)
    await post_meeting(
        stand,
        leader,
        client_form(
            debt.id,
            datetime(2025, 2, 26, 12, tzinfo=UTC),
            price="95.50",
            outcome={"status": "completed", "actual_duration_minutes": 45},
        ),
    )
    before_archive = await records_summary(stand, leader)
    await archive_card(stand, leader, debt.id)
    assert await records_summary(stand, leader) == before_archive
    log = await records_hours(stand, leader)
    assert log.total_hours == log.period_hours == 0.75
    assert log.items[0].client is not None and log.items[0].client.archived
    feed = (await records_operations(stand, leader, {"kind": "income"})).items
    assert len(feed) == 1 and feed[0].client is not None and feed[0].client.archived
    outside = await records_summary(
        stand, leader, custom_period("2025-01-01", "2025-01-31")
    )
    assert outside.has_outcomes and outside.practice_hours == 0 and not outside.receipts
    assert outside.debts == [Money(amount="-95.5", currency=Currency.EUR)]
    assert outside.prepaid == [
        Money(amount="100", currency=Currency.EUR),
        Money(amount="25", currency=Currency.USD),
    ]
    remaining = records_from(
        await client.get(f"{RECORDS}/balances", headers=headers), RecordsBalanceList
    )
    negative, first_prepaid, second_prepaid = remaining.items
    assert [row.client.id for row in remaining.items] == [debt.id, large.id, small.id]
    assert negative.client.archived and negative.balance.unpaid_sessions == "1"
    assert negative.balance.balance in outside.debts
    assert (
        first_prepaid.balance.sessions_left is None
        and first_prepaid.balance.unpaid_sessions is None
    )
    assert second_prepaid.balance.sessions_left == "2"
