from collections import defaultdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from test_account import AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card
from test_clients_balance import balance_from
from test_meetings_api import MEETINGS, meeting_from, post_meeting, service_form
from test_meetings_ledger import client_form
from test_records_api import (
    add_payment,
    custom_period,
    records_from,
    records_hours,
    records_operations,
    records_summary,
)
from test_specialists_api import link_card, validation_problem

from celmento_api.models.enums import (
    BalanceOperationKind,
    Currency,
    MeetingStatus,
    RecordsOperationKind,
)
from celmento_api.schemas.meetings import MeetingList
from celmento_api.schemas.money import Money

__all__: list[str] = ["account_stand"]


# spec:test accounting-summary#compute-income-amounts-charged-client
# spec:test accounting-summary#compute-expenses-prices-personal-therapy
# spec:test accounting-summary#compute-money-indicator-separately
# spec:test accounting-summary#count-client-session-payment-type
# spec:test accounting-summary#count-mutual-practice-meeting-money
# spec:test accounting-summary#count-attended-meetings-leader-attendee
# spec:test accounting-summary#sum-convert-amounts-different-currencies
# spec:test attended-meetings#count-attended-meetings-account-pending
# spec:test hours-log#fill-practice-log-client-sessions
# spec:test hours-log#count-client-session-supervision-therapy
# spec:test hours-log#count-client-session-payment-type
# spec:test hours-log#count-completed-mutual-practice-meeting-pro-bono
# spec:test hours-log#count-completed-meeting-longer-24-hours
# spec:test hours-log#count-meeting-not-taken-place-status
# spec:test hours-log#count-attended-meetings-leader-attendee
# spec:test money-operations-feed#list-client-session-payment-type-paid-completed
# spec:test money-operations-feed#list-client-session-payment-type-paid
# spec:test money-operations-feed#list-client-payment-receipts-row
# spec:test money-operations-feed#list-personal-therapy-supervision
# spec:test money-operations-feed#match-per-currency-sum-rows-filter
# spec:test money-operations-feed#list-scheduled-meetings-awaiting-outcome
# spec:test money-operations-feed#list-client-sessions-payment-type
# spec:test meeting-outcome-recording#set-status-completed-done-saved-paid
# spec:test meeting-outcome-recording#set-status-completed-done-saved-barter
# spec:test meeting-outcome-recording#set-status-completed-done-saved-pro-bono
# spec:test meeting-outcome-recording#count-actual-duration-hours-log
# spec:test meeting-outcome-recording#set-status-not-taken-place-screen-4-3-saved-yes
# spec:test meeting-outcome-recording#set-status-not-taken-place-screen-4-3-saved-no
# spec:test meeting-outcome-recording#create-balance-operation-income-expense
# spec:test meeting-outcome-recording#count-not-taken-place-meeting-hours-log
# spec:test meeting-outcome-recording#let-backdated-meeting-saved-outcome
async def test_records_uses_exact_outcome_money_and_hours_for_own_meetings_only(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("records_finance_leader")
    specialist = await stand.add_account("records_other_specialist")
    for person in (owner, specialist):
        await stand.activate(person)
    client, owner_headers = stand.client, bearer(owner)
    card = await create_card(
        stand, owner, {"name": "Euro client", "currency": "EUR", "rate": "60"}
    )
    peer = await create_card(
        stand, specialist, {"name": "Viewer as an attendee", "currency": "USD"}
    )
    await link_card(stand, specialist, peer.id, owner)
    start = datetime(2025, 6, 3, 9, tzinfo=UTC)
    await post_meeting(
        stand,
        specialist,
        client_form(
            peer.id,
            start,
            price="999",
            outcome={"status": "completed", "actual_duration_minutes": 300},
        ),
    )
    await post_meeting(
        stand, specialist, client_form(peer.id, start + timedelta(hours=2), price="990")
    )
    await post_meeting(stand, owner, client_form(card.id, start + timedelta(days=13)))

    paid = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start,
            price="10.10",
            outcome={"status": "completed", "actual_duration_minutes": 65},
        ),
    )
    missed = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start + timedelta(hours=2),
            price="20.20",
            outcome={"status": "not_taken_place", "charged": True},
        ),
    )
    uncharged = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start + timedelta(hours=4),
            price="999",
            outcome={"status": "not_taken_place", "charged": False},
        ),
    )
    barter = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start + timedelta(days=1),
            price="567",
            payment_type="barter",
            outcome={"status": "completed", "actual_duration_minutes": 75},
        ),
    )
    free = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start + timedelta(days=1, hours=2),
            price="456",
            payment_type="pro_bono",
            outcome={"status": "completed", "actual_duration_minutes": 45},
        ),
    )
    mutual_start = start + timedelta(days=2)
    mutual = await post_meeting(
        stand,
        owner,
        {
            "type": "mutual_practice",
            "with_whom": "Partner",
            "starts_at": mutual_start.isoformat(),
            "duration_minutes": 90,
            "my_duration_minutes": 35,
            "place": "online",
            "outcome": {"status": "completed"},
        },
    )
    await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start - timedelta(days=12),
            price="10",
            outcome={"status": "completed", "actual_duration_minutes": 30},
        ),
    )
    therapy = await post_meeting(
        stand,
        owner,
        service_form(
            start + timedelta(days=2, hours=4),
            price="30.15",
            currency="EUR",
            with_whom="Therapist",
            outcome={"status": "not_taken_place", "charged": True},
        ),
    )
    supervision = await post_meeting(
        stand,
        owner,
        service_form(
            start + timedelta(days=3),
            type="supervision",
            price="64.40",
            currency="USD",
            outcome={"status": "completed", "actual_duration_minutes": 90},
        ),
    )
    training = await post_meeting(
        stand,
        owner,
        service_form(
            start + timedelta(days=8),
            type="training",
            price="0",
            currency="RUB",
            duration_minutes=1500,
            outcome={"status": "completed", "actual_duration_minutes": 1561},
        ),
    )
    await add_payment(stand, owner, card.id, "0.1", "2025-06-26")
    await add_payment(stand, owner, card.id, "0.2", "2025-06-30")
    period = custom_period("2025-06-01", "2025-06-30")
    view = await records_summary(stand, owner, period)
    assert view.income == [Money(amount="30.3", currency=Currency.EUR)]
    assert view.receipts == [Money(amount="0.3", currency=Currency.EUR)]
    assert view.expenses == [
        Money(amount="0", currency=Currency.RUB),
        Money(amount="-30.15", currency=Currency.EUR),
        Money(amount="-64.4", currency=Currency.USD),
    ]
    assert view.completed_sessions == 4 and view.practice_hours == 3.67
    assert view.supervision_hours == 1.5 and view.personal_therapy_hours == 0
    assert view.training_hours == 26.02 and view.growth_hours == 27.52
    assert await records_summary(stand, specialist, period) != view

    rows = (await records_operations(stand, owner, period)).items
    assert [row.date for row in rows] == sorted(
        (row.date for row in rows), reverse=True
    )
    assert {row.meeting_id for row in rows} == {
        None,
        paid.id,
        missed.id,
        therapy.id,
        supervision.id,
        training.id,
    }
    by_meeting = {row.meeting_id: row for row in rows if row.meeting_id is not None}
    assert by_meeting[paid.id].kind == RecordsOperationKind.SESSION_CHARGE
    assert by_meeting[missed.id].kind == RecordsOperationKind.MISSED_CHARGE
    assert by_meeting[therapy.id].with_whom == "Therapist"
    assert by_meeting[training.id].amount == Money(amount="0", currency=Currency.RUB)
    assert all(
        row.client is not None and row.client.id == card.id
        for row in rows
        if row.kind == RecordsOperationKind.PAYMENT
    )
    assert all(
        meeting.status == MeetingStatus.COMPLETED
        for meeting in (paid, barter, free, supervision, training)
    )
    assert missed.status == uncharged.status == MeetingStatus.NOT_TAKEN_PLACE
    for group, tile in (
        ("income", view.income),
        ("receipts", view.receipts),
        ("expenses", view.expenses),
    ):
        filtered = (
            await records_operations(stand, owner, {**period, "kind": group})
        ).items
        amounts: defaultdict[Currency, Decimal] = defaultdict(Decimal)
        for row in filtered:
            amounts[row.amount.currency] += Decimal(row.amount.amount)
        assert dict(amounts) == {
            money.currency: Decimal(money.amount) for money in tile
        }
    ledger = balance_from(
        await client.get(f"{CLIENTS}/{card.id}/balance", headers=owner_headers)
    )
    assert not {barter.id, free.id, uncharged.id} & {
        item.meeting_id for item in ledger.items
    }

    practice = await records_hours(stand, owner, period)
    assert practice.total_hours == 4.17 and practice.period_hours == view.practice_hours
    assert practice.breakdown.paid == 2.33 and practice.breakdown.pro_bono == 1.33
    assert practice.breakdown.individual == view.practice_hours
    assert [item.id for item in practice.items] == [
        mutual.id,
        free.id,
        barter.id,
        paid.id,
    ]
    training_log = await records_hours(stand, owner, {**period, "type": "training"})
    assert (
        training_log.items[0].hours
        == training_log.period_hours
        == training_log.total_hours
        == 26.02
    )
    assert (
        training_log.breakdown.paid is None and training_log.breakdown.pro_bono is None
    )
    assert (
        await records_hours(stand, owner, {**period, "type": "therapy"})
    ).items == []
    empty = await records_hours(stand, owner, custom_period("2025-01-01", "2025-01-31"))
    assert (
        empty.total_hours == practice.total_hours
        and empty.period_hours == 0
        and not empty.items
    )
    all_time = await records_hours(stand, owner)
    assert all_time.total_hours == all_time.period_hours == practice.total_hours
    schedule = records_from(
        await client.get(
            MEETINGS,
            headers=owner_headers,
            params={"from": period["from"], "to": period["to"]},
        ),
        MeetingList,
    )
    assert schedule.attended_total == 2 and schedule.pending_outcomes_count == 1


# spec:test accounting-summary#reflect-recorded-changed-outcome-edited
# spec:test hours-log#update-totals-breakdown-list-immediately
# spec:test money-operations-feed#show-meeting-row-amount-currently
# spec:test money-operations-feed#remove-meeting-row-soon-outcome
# spec:test meeting-outcome-recording#let-leader-change-outcome-completed
# spec:test meeting-outcome-recording#recalculate-balance-charge-expense
# spec:test meeting-outcome-recording#apply-edited-payment-type-client
async def test_records_reflects_edits_and_keeps_balance_only_rows_out_of_the_feed(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("records_mutation_leader")
    await stand.activate(owner)
    client, headers = stand.client, bearer(owner)
    card = await create_card(stand, owner, {"name": "Corrected card", "rate": "60"})
    start = datetime(2025, 6, 2, 9, tzinfo=UTC)
    paid = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start,
            price="10.10",
            outcome={"status": "completed", "actual_duration_minutes": 60},
        ),
    )
    service = await post_meeting(
        stand,
        owner,
        service_form(
            start + timedelta(hours=2),
            price="70",
            outcome={"status": "completed", "actual_duration_minutes": 80},
        ),
    )
    path = f"{MEETINGS}/{paid.id}"
    service_path = f"{MEETINGS}/{service.id}"
    payment_path = f"{CLIENTS}/{card.id}/payments"
    first = await add_payment(stand, owner, card.id, "5.15", "2025-06-20")
    second = await add_payment(stand, owner, card.id, "3.13", "2025-06-21")
    first_id = next(
        row.id for row in first.items if row.kind == BalanceOperationKind.PAYMENT
    )
    second_id = next(
        row.id for row in second.items if row.kind == BalanceOperationKind.PAYMENT
    )
    period = custom_period("2025-06-01", "2025-06-30")
    before = await records_summary(stand, owner, period)
    assert before.receipts == [Money(amount="8.28", currency=Currency.RUB)]
    assert before.practice_hours == 1 and before.personal_therapy_hours == 1.33

    meeting_from(await client.patch(path, headers=headers, json={"price": "15.15"}))
    meeting_from(
        await client.patch(service_path, headers=headers, json={"price": "20"})
    )
    balance_from(
        await client.patch(
            f"{payment_path}/{first_id}",
            headers=headers,
            json={"amount": "6.40", "date": "2025-05-31"},
        )
    )
    revised = await records_summary(stand, owner, period)
    assert revised.income == [Money(amount="15.15", currency=Currency.RUB)]
    assert revised.expenses == [Money(amount="-20", currency=Currency.RUB)]
    assert revised.receipts == [Money(amount="3.13", currency=Currency.RUB)]
    entries = (await records_operations(stand, owner, period)).items
    assert {row.id: row.amount.amount for row in entries} == {
        second_id: "3.13",
        service.id: "-20",
        paid.id: "15.15",
    }

    meeting_from(
        await client.put(
            f"{path}/outcome",
            headers=headers,
            json={"status": "completed", "actual_duration_minutes": 90},
        )
    )
    meeting_from(
        await client.patch(path, headers=headers, json={"payment_type": "pro_bono"})
    )
    assert (await records_summary(stand, owner, period)).income == []
    reclassified = await records_hours(stand, owner, period)
    assert reclassified.total_hours == reclassified.period_hours == 1.5
    assert reclassified.breakdown.paid == 0 and reclassified.breakdown.pro_bono == 1.5
    meeting_from(
        await client.patch(path, headers=headers, json={"payment_type": "paid"})
    )
    meeting_from(
        await client.put(
            f"{path}/outcome",
            headers=headers,
            json={"status": "not_taken_place", "charged": False},
        )
    )
    changed_outcome = await records_summary(stand, owner, period)
    assert not changed_outcome.income and not changed_outcome.completed_sessions
    assert (await records_hours(stand, owner, period)).items == []
    meeting_from(
        await client.put(
            f"{path}/outcome",
            headers=headers,
            json={"status": "not_taken_place", "charged": True},
        )
    )
    assert (await records_summary(stand, owner, period)).income == revised.income
    restored = meeting_from(
        await client.put(
            f"{path}/outcome",
            headers=headers,
            json={"status": "completed", "actual_duration_minutes": 120},
        )
    )
    assert restored.status == MeetingStatus.COMPLETED
    assert (await records_summary(stand, owner, period)).income == revised.income
    restored_hours = await records_hours(stand, owner)
    assert restored_hours.period_hours == restored_hours.total_hours == 2
    assert restored_hours.breakdown.paid == 2
    cancelled = await client.delete(path, headers=headers, params={"refund": "false"})
    assert cancelled.status_code == 204, cancelled.text
    assert (
        await client.delete(f"{payment_path}/{second_id}", headers=headers)
    ).status_code == 200
    meeting_from(
        await client.put(
            f"{service_path}/outcome",
            headers=headers,
            json={"status": "not_taken_place", "charged": False},
        )
    )
    final = await records_summary(stand, owner, period)
    assert (
        not final.income
        and not final.receipts
        and not final.expenses
        and final.growth_hours == 0
    )
    assert (await records_operations(stand, owner, period)).items == []
    assert (await records_summary(stand, owner)).receipts == [
        Money(amount="6.4", currency=Currency.RUB)
    ]
    assert final.debts == [Money(amount="-8.75", currency=Currency.RUB)]
    ledger = balance_from(
        await client.get(f"{CLIENTS}/{card.id}/balance", headers=headers)
    )
    assert {
        BalanceOperationKind.CORRECTION,
        BalanceOperationKind.REFUND_TO_BALANCE,
        BalanceOperationKind.DELETED_MEETING_CHARGE,
    } <= {row.kind for row in ledger.items}


# spec:test hours-log#change-hours-counted-client-archived
async def test_records_preserves_previous_currency_without_repricing_history(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("records_currency_leader")
    await stand.activate(owner)
    client, headers = stand.client, bearer(owner)
    card = await create_card(
        stand,
        owner,
        {"name": "Multi-currency client", "rate": "10.10", "currency": "USD"},
    )
    start = datetime(2025, 6, 2, 9, tzinfo=UTC)
    previous = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start,
            price="10.10",
            outcome={"status": "completed", "actual_duration_minutes": 60},
        ),
    )
    await add_payment(stand, owner, card.id, "10.10", "2025-06-02")
    changed = card_from(
        await client.patch(
            f"{CLIENTS}/{card.id}",
            headers=headers,
            json={"currency": "EUR", "rate": "20.20"},
        )
    )
    assert changed.currency == Currency.EUR
    assert (await records_hours(stand, owner)).total_hours == 1
    current = await post_meeting(
        stand,
        owner,
        client_form(
            card.id,
            start + timedelta(days=1),
            price="20.20",
            outcome={"status": "completed", "actual_duration_minutes": 75},
        ),
    )
    view = await records_summary(stand, owner)
    assert view.income == [
        Money(amount="20.2", currency=Currency.EUR),
        Money(amount="10.1", currency=Currency.USD),
    ]
    assert view.receipts == [Money(amount="10.1", currency=Currency.USD)]
    assert view.debts == [Money(amount="-20.2", currency=Currency.EUR)]
    assert view.practice_hours == 2.25
    rows = (await records_operations(stand, owner, {"kind": "income"})).items
    assert [(row.id, row.amount.currency) for row in rows] == [
        (current.id, Currency.EUR),
        (previous.id, Currency.USD),
    ]


# spec:test hours-log#count-completed-mutual-practice-meeting
# spec:test hours-log#count-part-mutual-practice-meeting
# spec:test hours-log#show-total-large-type-log
async def test_mutual_hours_count_confirmed_own_minutes_and_follow_explicit_edits(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    owner = await stand.add_account("records_mutual_leader")
    await stand.activate(owner)
    client, headers = stand.client, bearer(owner)
    start = datetime(2025, 6, 4, 9, tzinfo=UTC)
    mutual = await post_meeting(
        stand,
        owner,
        {
            "type": "mutual_practice",
            "with_whom": "Partner",
            "starts_at": start.isoformat(),
            "duration_minutes": 90,
            "my_duration_minutes": 30,
            "place": "online",
        },
    )
    path = f"{MEETINGS}/{mutual.id}"
    validation_problem(
        await client.put(
            f"{path}/outcome",
            headers=headers,
            json={"status": "completed", "actual_duration_minutes": 0},
        ),
        "body",
        "greater_than_equal",
    )
    for confirmed in (120, 45):
        updated = meeting_from(
            await client.put(
                f"{path}/outcome",
                headers=headers,
                json={"status": "completed", "actual_duration_minutes": confirmed},
            )
        )
        assert updated.actual_duration_minutes == confirmed
        log = await records_hours(stand, owner)
        assert (
            log.items[0].hours == log.period_hours == log.total_hours == confirmed / 60
        )
    unchanged = meeting_from(
        await client.patch(
            path,
            headers=headers,
            json={"my_duration_minutes": 30, "with_whom": "Renamed"},
        )
    )
    assert unchanged.actual_duration_minutes == 45
    revised = meeting_from(
        await client.patch(path, headers=headers, json={"my_duration_minutes": 60})
    )
    assert revised.actual_duration_minutes == 60
    followup = meeting_from(
        await client.patch(
            path,
            headers=headers,
            json={"my_duration_minutes": 60, "comment": "Private"},
        )
    )
    assert followup.actual_duration_minutes == 60
    log = await records_hours(stand, owner)
    assert (
        log.items[0].hours
        == log.breakdown.pro_bono
        == log.breakdown.individual
        == log.total_hours
        == log.period_hours
        == 1
    )
    view = await records_summary(stand, owner)
    assert view.practice_hours == 1 and view.completed_sessions == 1
    validation_problem(
        await client.put(
            f"{path}/outcome", headers=headers, json={"status": "scheduled"}
        ),
        "body",
        "enum",
    )
