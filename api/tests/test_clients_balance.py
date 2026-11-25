from asyncio import gather, timeout
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import uuid7

from httpx import Response
from sqlalchemy import func, select
from test_account import AccountStand, account_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, list_from, problem

from celmento_api.models.client_card import ClientCard as ClientRecord
from celmento_api.models.client_request_receipt import ClientRequestReceipt
from celmento_api.models.enums import (
    BalanceOperationKind,
    ClientCardStatus,
    Currency,
    ErrorCode,
)
from celmento_api.schemas.balance import ClientBalance
from celmento_api.services.balance import add_operation

__all__: list[str] = ["account_stand"]

PAST: date = date(2025, 1, 13)


def balance_from(response: Response, status: int = 200) -> ClientBalance:
    assert response.status_code == status, response.text
    return ClientBalance.model_validate_json(response.content)


# spec:test client-balance-payments#compute-client-balance-payments-plus
# spec:test client-balance-payments#compute-session-count-balance-divided
# spec:test client-balance-payments#open-screen-6-4-history-listing
# spec:test client-balance-payments#allow-editing-deleting-session-missed
# spec:test client-balance-payments#allow-editing-deleting-payment-recorded
# spec:test client-rate-currency#convert-amounts-currencies-add-up
async def test_ledger_is_exact_and_previous_currency_payments_stay_immutable(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    owner = await account_stand.add_account("ledger_owner")
    await account_stand.activate(owner)
    headers = bearer(owner)
    card = await create_card(account_stand, owner, {"name": "Ledger", "rate": "0.01"})
    path = f"{CLIENTS}/{card.id}"
    payments = f"{path}/payments"
    huge = "999999999999999.99"
    body = {"amount": huge, "date": PAST.isoformat(), "comment": "Initial credit"}
    for invalid in (
        {**body, "amount": "0"},
        {**body, "amount": "-1"},
        {**body, "date": "2999-01-01"},
    ):
        problem(
            await client.post(payments, json=invalid, headers=headers),
            400,
            ErrorCode.PAYMENT_INVALID,
        )
    assert (
        await client.post(
            payments, json={**body, "amount": "1000000000000000"}, headers=headers
        )
    ).status_code == 422

    first = balance_from(await client.post(payments, json=body, headers=headers), 201)
    assert first.balance.balance.amount == huge
    assert first.balance.sessions_left == "99999999999999999"
    assert first.balance.unpaid_sessions is None
    payment = first.items[0]
    assert payment.comment == "Initial credit" and payment.editable
    assert (
        payment.kind == BalanceOperationKind.PAYMENT and not payment.created_by_system
    )
    assert payment.id.version == 7
    listed = list_from(await client.get(CLIENTS, headers=headers)).items[0]
    assert listed.balance == first.balance
    problem(
        await client.patch(
            path, json={"rate": "25", "currency": "EUR"}, headers=headers
        ),
        409,
        ErrorCode.BALANCE_NOT_ZERO,
    )

    async with account_stand.session() as session:
        stored = await session.get(ClientRecord, card.id)
        assert stored is not None
        charge = await add_operation(
            session,
            stored,
            BalanceOperationKind.SESSION_CHARGE,
            -Decimal(huge),
            date(2025, 1, 14),
            None,
            meeting_id=None,
            by_system=True,
        )
        refund = await add_operation(
            session,
            stored,
            BalanceOperationKind.REFUND_TO_BALANCE,
            Decimal(9),
            date(2025, 1, 15),
            None,
            meeting_id=None,
            by_system=True,
        )
        await session.commit()
    with_refund = balance_from(await client.get(f"{path}/balance", headers=headers))
    assert with_refund.balance.balance.amount == "9"
    assert with_refund.balance.sessions_left == "900"
    assert [item.id for item in with_refund.items] == [
        refund.balance_operation_id,
        charge.balance_operation_id,
        payment.id,
    ]
    assert with_refund.items[1].amount.amount == f"-{huge}"
    assert not with_refund.items[0].editable and not with_refund.items[1].editable
    problem(
        await client.delete(
            f"{payments}/{charge.balance_operation_id}", headers=headers
        ),
        404,
        ErrorCode.NOT_FOUND,
    )

    async with account_stand.session() as session:
        stored = await session.get(ClientRecord, card.id)
        assert stored is not None
        await add_operation(
            session,
            stored,
            BalanceOperationKind.CORRECTION,
            Decimal(-9),
            date(2025, 1, 16),
            "Remainder cleared",
            meeting_id=None,
            by_system=True,
        )
        await session.commit()
    zero = balance_from(await client.get(f"{path}/balance", headers=headers))
    assert zero.balance.balance.amount == "0" and zero.balance.sessions_left is None
    problem(
        await client.patch(path, json={"currency": "EUR"}, headers=headers),
        400,
        ErrorCode.RATE_REQUIRED,
    )
    euro = card_from(
        await client.patch(
            path, json={"rate": "25", "currency": "EUR"}, headers=headers
        )
    )
    assert (
        euro.balance.balance.currency == Currency.EUR
        and euro.balance.balance.amount == "0"
    )
    euro_history = balance_from(await client.get(f"{path}/balance", headers=headers))
    assert {row.amount.currency for row in euro_history.items} == {Currency.RUB}
    assert all(not row.editable for row in euro_history.items)
    problem(
        await client.patch(
            f"{payments}/{payment.id}", json={"amount": "100"}, headers=headers
        ),
        409,
        ErrorCode.CONFLICT,
    )
    rub = card_from(
        await client.patch(
            path, json={"rate": "100", "currency": "RUB"}, headers=headers
        )
    )
    assert rub.balance.balance.amount == "0"
    rub_history = balance_from(await client.get(f"{path}/balance", headers=headers))
    assert all(not row.editable for row in rub_history.items)
    problem(
        await client.delete(f"{payments}/{payment.id}", headers=headers),
        409,
        ErrorCode.CONFLICT,
    )

    new = balance_from(
        await client.post(
            payments, json={"amount": "150.01", "date": "2025-01-20"}, headers=headers
        ),
        201,
    )
    newest = new.items[0]
    assert newest.editable and new.balance.sessions_left == "1"
    changed = balance_from(
        await client.patch(
            f"{payments}/{newest.id}",
            json={"amount": "50.01", "comment": "Updated"},
            headers=headers,
        )
    )
    assert (
        changed.balance.sessions_left == "0" and changed.items[0].comment == "Updated"
    )
    assert changed.items[0].date == newest.date
    barter = card_from(
        await client.patch(path, json={"payment_type": "barter"}, headers=headers)
    )
    assert (
        barter.balance.balance.amount == "50.01"
        and barter.balance.sessions_left is None
    )
    card_from(await client.patch(path, json={"payment_type": "paid"}, headers=headers))

    async with account_stand.session() as session:
        active = await session.get(ClientRecord, card.id)
        assert active is not None
        await add_operation(
            session,
            active,
            BalanceOperationKind.MISSED_CHARGE,
            Decimal("-101.02"),
            date(2025, 1, 21),
            None,
            meeting_id=None,
            by_system=True,
        )
        await session.commit()
    negative = balance_from(
        await client.delete(f"{payments}/{newest.id}", headers=headers)
    )
    assert negative.balance.balance.amount == "-101.02"
    assert (
        negative.balance.sessions_left is None
        and negative.balance.unpaid_sessions == "1"
    )
    assert newest.id not in {row.id for row in negative.items}


# spec:test client-balance-payments#allow-adding-editing-deleting-payment
async def test_payment_idempotency_survives_delete_and_is_scoped_to_payload_and_target(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    owner = await account_stand.add_account("keyed_payments")
    await account_stand.activate(owner)
    headers = bearer(owner)
    key = str(uuid7())
    keyed = {**headers, "Idempotency-Key": key}
    first = card_from(
        await client.post(
            CLIENTS, json={"name": "Original card", "rate": "50"}, headers=keyed
        ),
        201,
    )
    second = await create_card(
        account_stand, owner, {"name": "Other card", "rate": "50"}
    )
    path = f"{CLIENTS}/{first.id}"
    payments = f"{path}/payments"
    body = {"amount": "100.01", "date": PAST.isoformat(), "comment": "Receipt"}
    async with timeout(10):
        duplicates = await gather(
            client.post(payments, json=body, headers=keyed),
            client.post(payments, json=body, headers=keyed),
        )
    initial, replay = (balance_from(response, 201) for response in duplicates)
    assert len(initial.items) == 1 and initial == replay
    assert (
        initial.balance.balance.amount == "100.01"
        and initial.balance.sessions_left == "2"
    )
    payment_id = initial.items[0].id
    problem(
        await client.post(payments, json={**body, "amount": "100.02"}, headers=keyed),
        409,
        ErrorCode.CONFLICT,
    )
    problem(
        await client.post(f"{CLIENTS}/{second.id}/payments", json=body, headers=keyed),
        409,
        ErrorCode.CONFLICT,
    )
    zero = balance_from(
        await client.delete(f"{payments}/{payment_id}", headers=headers)
    )
    assert zero.items == [] and zero.balance.balance.amount == "0"
    assert (
        balance_from(await client.post(payments, json=body, headers=keyed), 201) == zero
    )

    new = balance_from(await client.post(payments, json=body, headers=headers), 201)
    assert len(new.items) == 1 and new.items[0].id != payment_id
    async with account_stand.session() as session:
        stored = await session.get(ClientRecord, first.id)
        assert stored is not None
        stored.status = ClientCardStatus.ARCHIVED.value
        stored.archived_at = datetime.now(UTC)
        assert (
            await session.scalar(select(func.count()).select_from(ClientRequestReceipt))
            == 2
        )
        await session.commit()
    archived = balance_from(await client.get(f"{path}/balance", headers=headers))
    assert len(archived.items) == 1 and not archived.items[0].editable
    assert (
        balance_from(await client.post(payments, json=body, headers=keyed), 201)
        == archived
    )
    payment_path = f"{payments}/{new.items[0].id}"
    for rejected in (
        await client.post(payments, json=body, headers=headers),
        await client.patch(payment_path, json={"amount": "50"}, headers=headers),
        await client.delete(payment_path, headers=headers),
    ):
        problem(rejected, 409, ErrorCode.CLIENT_ARCHIVED)
    preflight = await client.options(
        CLIENTS,
        headers={
            "Origin": account_stand.settings.web_url_ru.rstrip("/"),
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
    )
    assert (
        preflight.status_code == 200
        and "idempotency-key"
        in preflight.headers["Access-Control-Allow-Headers"].lower()
    )
