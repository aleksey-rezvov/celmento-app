from asyncio import gather, timeout
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid7

from httpx import Response
from sqlalchemy import select
from test_account import AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, list_from, problem
from test_meetings_api import MEETINGS, meeting_from, post_meeting, service_form

from celmento_api.models.balance import BalanceOperation as BalanceRecord
from celmento_api.models.client_card import ClientCard as ClientRecord
from celmento_api.models.enums import (
    BalanceOperationKind,
    ClientCardStatus,
    ClientSource,
    Currency,
    ErrorCode,
    MeetingStatus,
)
from celmento_api.models.meeting import MeetingCreateReceipt, MeetingExpenseCorrection
from celmento_api.schemas.balance import ClientBalance
from celmento_api.schemas.meetings import ClientMeetingList

__all__: list[str] = ["account_stand"]


def _client_form(
    client_id: UUID, starts_at: datetime, **edits: object
) -> dict[str, object]:
    return {
        "type": "client_session",
        "client_id": str(client_id),
        "starts_at": starts_at.isoformat(),
        "duration_minutes": 60,
        "place": "online",
        "price": "100.25",
        **edits,
    }


def _ledger(response: Response) -> ClientBalance:
    assert response.status_code == 200, response.text
    return ClientBalance.model_validate_json(response.content)


def _client_meetings(response: Response) -> ClientMeetingList:
    assert response.status_code == 200, response.text
    return ClientMeetingList.model_validate_json(response.content)


# spec:test meeting-form#make-paid-unavailable-price-client
# spec:test meeting-reschedule-cancel-delete#keep-charge-balance-history-leader
# spec:test meeting-outcome-recording#recalculate-balance-charge-expense
async def test_outcome_changes_reconcile_the_ledger_and_keep_deleted_charge(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("ledger_specialist")
    await account_stand.activate(leader)
    headers = bearer(leader)
    card = await create_card(
        account_stand, leader, {"name": "Ledger card", "rate": "100.25"}
    )
    start = datetime(2025, 1, 13, 9, tzinfo=UTC)
    body = _client_form(card.id, start)
    problem(
        await client.post(MEETINGS, json={**body, "price": "0"}, headers=headers),
        400,
        ErrorCode.PAYMENT_TYPE_REQUIRED,
    )
    assert (
        await client.post(MEETINGS, json={**body, "currency": "EUR"}, headers=headers)
    ).status_code == 422

    meeting = await post_meeting(account_stand, leader, body)
    path = f"{MEETINGS}/{meeting.id}"
    outcome_url = f"{path}/outcome"
    ledger_url = f"{CLIENTS}/{card.id}/balance"
    problem(
        await client.put(
            outcome_url, json={"status": "not_taken_place"}, headers=headers
        ),
        400,
        ErrorCode.OUTCOME_CHOICE_REQUIRED,
    )
    complete_body = {"status": "completed", "actual_duration_minutes": 45}
    completed = meeting_from(
        await client.put(outcome_url, json=complete_body, headers=headers)
    )
    assert (
        completed.status == MeetingStatus.COMPLETED
        and completed.actual_duration_minutes == 45
    )
    assert (
        completed.balance_charge is not None
        and completed.balance_charge.amount == "100.25"
    )
    assert (
        completed.client_card is not None
        and completed.client_card.completed_sessions == 1
    )
    assert completed.client_card.completed_hours == 0.8
    assert completed.client_card.balance.balance.amount == "-100.25"
    same = meeting_from(
        await client.put(outcome_url, json=complete_body, headers=headers)
    )
    assert same.balance_charge == completed.balance_charge
    ledger = _ledger(await client.get(ledger_url, headers=headers))
    assert [row.kind for row in ledger.items] == [BalanceOperationKind.SESSION_CHARGE]
    assert ledger.items[0].meeting_id == meeting.id and not ledger.items[0].editable
    problem(
        await client.patch(path, json={"type": "training"}, headers=headers),
        409,
        ErrorCode.MEETING_HAS_OUTCOME,
    )

    corrected = meeting_from(
        await client.patch(path, json={"price": "120.35"}, headers=headers)
    )
    assert (
        corrected.balance_charge is not None
        and corrected.balance_charge.amount == "120.35"
    )
    ledger = _ledger(await client.get(ledger_url, headers=headers))
    assert ledger.balance.balance.amount == "-120.35"
    assert [row.kind for row in ledger.items] == [
        BalanceOperationKind.CORRECTION,
        BalanceOperationKind.SESSION_CHARGE,
    ]
    assert [row.amount.amount for row in ledger.items] == ["-20.1", "-100.25"]

    uncharged = meeting_from(
        await client.put(
            outcome_url,
            json={"status": "not_taken_place", "charged": False},
            headers=headers,
        )
    )
    assert uncharged.charged is False and uncharged.actual_duration_minutes is None
    assert uncharged.balance_charge is None and uncharged.client_card is not None
    assert uncharged.client_card.completed_sessions == 0
    assert uncharged.client_card.balance.balance.amount == "0"
    charged = meeting_from(
        await client.put(
            outcome_url,
            json={"status": "not_taken_place", "charged": True},
            headers=headers,
        )
    )
    assert charged.charged is True and charged.balance_charge is not None
    pro_bono = meeting_from(
        await client.patch(path, json={"payment_type": "pro_bono"}, headers=headers)
    )
    assert pro_bono.balance_charge is None and pro_bono.charged is False
    assert (
        pro_bono.client_card is not None
        and pro_bono.client_card.balance.balance.amount == "0"
    )
    paid = meeting_from(
        await client.patch(path, json={"payment_type": "paid"}, headers=headers)
    )
    assert paid.balance_charge is not None and paid.balance_charge.amount == "120.35"
    problem(
        await client.delete(path, headers=headers),
        400,
        ErrorCode.REFUND_CHOICE_REQUIRED,
    )
    assert (
        await client.delete(path, params={"refund": "false"}, headers=headers)
    ).status_code == 204
    problem(await client.get(path, headers=headers), 404, ErrorCode.NOT_FOUND)
    ledger = _ledger(await client.get(ledger_url, headers=headers))
    assert ledger.balance.balance.amount == "-120.35"
    assert [row.kind for row in ledger.items] == [
        BalanceOperationKind.DELETED_MEETING_CHARGE,
        BalanceOperationKind.CORRECTION,
        BalanceOperationKind.MISSED_CHARGE,
        BalanceOperationKind.REFUND_TO_BALANCE,
        BalanceOperationKind.CORRECTION,
        BalanceOperationKind.SESSION_CHARGE,
    ]
    assert [row.amount.amount for row in ledger.items] == [
        "-120.35",
        "120.35",
        "-120.35",
        "120.35",
        "-20.1",
        "-100.25",
    ]
    assert all(row.meeting_id is None and not row.editable for row in ledger.items)


# spec:test meeting-form#run-completed-not-taken-place-flow
# spec:test meeting-reschedule-cancel-delete#return-charged-amount-client-balance
async def test_concurrent_backdated_create_replays_once_and_receipt_survives_delete(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("replay_specialist")
    await account_stand.activate(leader)
    headers = bearer(leader)
    card = await create_card(
        account_stand, leader, {"name": "Memo card", "rate": "250"}
    )
    key = uuid7()
    keyed = {**headers, "Idempotency-Key": str(key)}
    body = _client_form(
        card.id,
        datetime(2025, 2, 3, 9, tzinfo=UTC),
        price="249.99",
        outcome={"status": "completed", "actual_duration_minutes": 35},
    )
    async with timeout(10):
        responses = await gather(
            client.post(MEETINGS, json=body, headers=keyed),
            client.post(
                MEETINGS, json=dict(reversed(tuple(body.items()))), headers=keyed
            ),
        )
    first, replay = (meeting_from(response, 201) for response in responses)
    assert first == replay and first.status == MeetingStatus.COMPLETED
    assert first.actual_duration_minutes == 35 and first.balance_charge is not None
    assert first.balance_charge.amount == "249.99"
    ledger_url = f"{CLIENTS}/{card.id}/balance"
    charged = _ledger(await client.get(ledger_url, headers=headers))
    assert charged.balance.balance.amount == "-249.99" and len(charged.items) == 1
    problem(
        await client.post(MEETINGS, json={**body, "price": "250"}, headers=keyed),
        409,
        ErrorCode.CONFLICT,
    )
    path = f"{MEETINGS}/{first.id}"
    assert (
        await client.delete(path, params={"refund": "true"}, headers=headers)
    ).status_code == 204
    after = _ledger(await client.get(ledger_url, headers=headers))
    assert after.balance.balance.amount == "0"
    assert [row.kind for row in after.items] == [
        BalanceOperationKind.REFUND_TO_BALANCE,
        BalanceOperationKind.SESSION_CHARGE,
    ]
    assert [row.amount.amount for row in after.items] == ["249.99", "-249.99"]
    assert all(
        row.created_by_system and not row.editable and row.meeting_id is None
        for row in after.items
    )
    problem(
        await client.post(MEETINGS, json=body, headers=keyed), 409, ErrorCode.CONFLICT
    )
    assert _ledger(await client.get(ledger_url, headers=headers)) == after
    async with account_stand.session() as session:
        receipt = await session.scalar(
            select(MeetingCreateReceipt).where(
                MeetingCreateReceipt.leader_account_id == leader.account.id,
                MeetingCreateReceipt.idempotency_key == key,
            )
        )
        assert receipt is not None and receipt.meeting_id is None
        assert receipt.meeting_create_receipt_id.version == 7


# spec:test client-rate-currency#apply-new-currency-new-rate
# spec:test client-rate-currency#keep-past-meetings-balance-history
# spec:test client-list#remove-new-badge-soon-client-first
# spec:test meeting-outcome-recording#allow-changing-outcome-meeting-client
async def test_currency_changes_update_future_meetings_and_preserve_started_history(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("currency_leader")
    await account_stand.activate(leader)
    headers = bearer(leader)
    card = await create_card(
        account_stand, leader, {"name": "Price history", "rate": "100"}
    )
    future_only = await create_card(
        account_stand, leader, {"name": "No previous meeting", "rate": "75"}
    )
    async with account_stand.session() as session:
        row = await session.get(ClientRecord, card.id)
        assert row is not None
        row.source = ClientSource.BOOKED_VIA_LINK.value
        row.is_new = True
        await session.commit()

    now = datetime.now(UTC).replace(microsecond=0)
    past = await post_meeting(
        account_stand, leader, _client_form(card.id, now - timedelta(days=2))
    )
    later_past = await post_meeting(
        account_stand, leader, _client_form(card.id, now - timedelta(days=1))
    )
    future = await post_meeting(
        account_stand, leader, _client_form(card.id, now + timedelta(days=1))
    )
    second_future = await post_meeting(
        account_stand, leader, _client_form(card.id, now + timedelta(days=2))
    )
    await post_meeting(
        account_stand, leader, _client_form(future_only.id, now + timedelta(days=3))
    )
    client_path = f"{CLIENTS}/{card.id}"
    listing = list_from(await client.get(CLIENTS, headers=headers))
    entries = {entry.id: entry for entry in listing.items}
    assert listing.plan.active_clients == 2
    assert (
        entries[card.id].is_new
        and entries[card.id].last_meeting_at == later_past.starts_at
    )
    assert entries[future_only.id].last_meeting_at is None

    bounded = _client_meetings(
        await client.get(
            f"{client_path}/meetings", params={"limit": 1}, headers=headers
        )
    )
    assert [item.id for item in bounded.upcoming] == [future.id]
    assert [item.id for item in bounded.past] == [later_past.id]
    assert (
        await client.get(
            f"{client_path}/meetings", params={"limit": 0}, headers=headers
        )
    ).status_code == 422

    changed = card_from(
        await client.patch(
            client_path, json={"currency": "EUR", "rate": "120.50"}, headers=headers
        )
    )
    assert changed.currency == Currency.EUR
    for original in (past, later_past):
        historical = meeting_from(
            await client.get(f"{MEETINGS}/{original.id}", headers=headers)
        )
        assert (
            historical.price == original.price
            and historical.status == MeetingStatus.SCHEDULED
        )
    for original in (future, second_future):
        recalculated = meeting_from(
            await client.get(f"{MEETINGS}/{original.id}", headers=headers)
        )
        assert recalculated.price is not None
        assert (recalculated.price.amount, recalculated.price.currency) == (
            "120.5",
            Currency.EUR,
        )

    completed = meeting_from(
        await client.put(
            f"{MEETINGS}/{past.id}/outcome",
            json={"status": "completed", "actual_duration_minutes": 45},
            headers=headers,
        )
    )
    assert completed.price == past.price and completed.client_card is not None
    assert completed.client_card.balance.balance.amount == "0"
    assert (
        completed.client_card.completed_sessions == 1
        and completed.client_card.completed_hours == 0.8
    )
    assert not completed.client_card.is_new
    after = list_from(await client.get(CLIENTS, headers=headers))
    after_card = next(item for item in after.items if item.id == card.id)
    assert after.plan.active_clients == 2 and after_card.completed_sessions == 1
    assert after_card.last_meeting_at == later_past.starts_at and not after_card.is_new

    card_from(
        await client.patch(
            client_path,
            json={"currency": "USD", "rate": "0", "payment_type": "pro_bono"},
            headers=headers,
        )
    )
    free_future = meeting_from(
        await client.get(f"{MEETINGS}/{future.id}", headers=headers)
    )
    assert free_future.price is not None
    assert (
        free_future.price.amount == "0" and free_future.price.currency == Currency.USD
    )
    assert free_future.payment_type == "pro_bono"
    corrected = meeting_from(
        await client.patch(
            f"{MEETINGS}/{past.id}", json={"price": "101.75"}, headers=headers
        )
    )
    assert corrected.balance_charge is not None
    assert (
        corrected.balance_charge.amount == "101.75"
        and corrected.balance_charge.currency == Currency.RUB
    )
    ledger = _ledger(await client.get(f"{client_path}/balance", headers=headers))
    assert (
        ledger.balance.balance.currency == Currency.USD
        and ledger.balance.balance.amount == "0"
    )
    assert [item.amount.amount for item in ledger.items] == ["-1.5", "-100.25"]
    assert {item.amount.currency for item in ledger.items} == {Currency.RUB}
    async with account_stand.session() as session:
        histories = await session.scalars(
            select(BalanceRecord.currency_version).where(
                BalanceRecord.meeting_id == past.id
            )
        )
        assert set(histories) == {1}
        stored = await session.get(ClientRecord, card.id)
        assert stored is not None
        stored.status = ClientCardStatus.ARCHIVED.value
        stored.archived_at = datetime.now(UTC)
        await session.commit()
    problem(
        await client.put(
            f"{MEETINGS}/{later_past.id}/outcome",
            json={"status": "completed"},
            headers=headers,
        ),
        409,
        ErrorCode.MEETING_CLIENT_ARCHIVED,
    )
    archived = _client_meetings(
        await client.get(f"{client_path}/meetings", headers=headers)
    )
    assert (
        len(archived.past) == 2 and archived.past[1].status == MeetingStatus.COMPLETED
    )


# spec:test meeting-outcome-recording#recalculate-balance-charge-expense
async def test_service_expense_corrections_keep_exact_deltas_until_delete(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("expense_leader")
    await account_stand.activate(leader)
    headers = bearer(leader)
    service = await post_meeting(
        account_stand,
        leader,
        service_form(
            datetime(2025, 2, 13, 9, tzinfo=UTC),
            type="supervision",
            price="100",
            outcome={"status": "completed"},
        ),
    )
    path = f"{MEETINGS}/{service.id}"
    changed = meeting_from(
        await client.patch(path, json={"price": "150"}, headers=headers)
    )
    assert changed.price is not None and changed.price.amount == "150"
    async with account_stand.session() as session:
        first = await session.scalar(
            select(MeetingExpenseCorrection).where(
                MeetingExpenseCorrection.meeting_id == service.id
            )
        )
        assert first is not None and (first.currency, first.amount) == (
            "RUB",
            Decimal(50),
        )
    switched = meeting_from(
        await client.patch(
            path, json={"price": "179.25", "currency": "EUR"}, headers=headers
        )
    )
    assert switched.price is not None
    assert (switched.price.currency, switched.price.amount) == (Currency.EUR, "179.25")
    async with account_stand.session() as session:
        rows = await session.scalars(
            select(MeetingExpenseCorrection).where(
                MeetingExpenseCorrection.meeting_id == service.id
            )
        )
        assert {(entry.currency, entry.amount) for entry in rows} == {
            ("RUB", Decimal(50)),
            ("RUB", Decimal(-150)),
            ("EUR", Decimal("179.25")),
        }
    assert (await client.delete(path, headers=headers)).status_code == 204
    async with account_stand.session() as session:
        assert (
            await session.scalar(
                select(MeetingExpenseCorrection).where(
                    MeetingExpenseCorrection.meeting_id == service.id
                )
            )
            is None
        )
