from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter

from celmento_api.auth import Database, LeaderAccount
from celmento_api.errors import error_responses
from celmento_api.models.client_request_receipt import ClientWriteOperation
from celmento_api.models.enums import BalanceOperationKind
from celmento_api.schemas.balance import (
    ClientBalance,
    ClientPaymentCreate,
    ClientPaymentUpdate,
)
from celmento_api.schemas.clients import IdempotencyKey
from celmento_api.services.balance import (
    add_operation,
    editable_payment,
    read_client_balance,
    validate_payment,
)
from celmento_api.services.client_requests import (
    client_write_request,
    previous_client,
    remember_client_write,
)
from celmento_api.services.clients import active_client_for_update, owned_client

router: APIRouter = APIRouter(prefix="/clients/{client_id}", tags=["balance"])


@router.get(
    "/balance",
    operation_id="getClientBalance",
    summary="Get the client's balance and operation history",
    response_model=ClientBalance,
    responses=error_responses(401, 403, 404, 422, 500),
)
async def get_client_balance(
    client_id: UUID, leader: LeaderAccount, session: Database
) -> ClientBalance:
    card = await owned_client(session, leader.account_id, client_id, lock=True)
    return await read_client_balance(session, card)


@router.post(
    "/payments",
    operation_id="createClientPayment",
    summary="Record a payment from the client",
    status_code=201,
    response_model=ClientBalance,
    responses=error_responses(400, 401, 403, 404, 409, 422, 500),
)
async def create_client_payment(
    client_id: UUID,
    body: ClientPaymentCreate,
    leader: LeaderAccount,
    session: Database,
    idempotency_key: IdempotencyKey = None,
) -> ClientBalance:
    receipt = client_write_request(
        ClientWriteOperation.CREATE_PAYMENT, idempotency_key, body, client_id
    )
    existing_id = await previous_client(session, leader.account_id, receipt)
    if existing_id is not None:
        existing = await owned_client(
            session, leader.account_id, existing_id, lock=True
        )
        return await read_client_balance(session, existing)
    card = await active_client_for_update(session, leader.account_id, client_id)
    amount = Decimal(body.amount)
    validate_payment(amount, body.date, leader)
    await add_operation(
        session,
        card,
        BalanceOperationKind.PAYMENT,
        amount,
        body.date,
        body.comment,
        meeting_id=None,
        by_system=False,
    )
    remember_client_write(session, leader.account_id, card.client_card_id, receipt)
    result = await read_client_balance(session, card)
    await session.commit()
    return result


@router.patch(
    "/payments/{payment_id}",
    operation_id="updateClientPayment",
    summary="Edit a recorded payment",
    response_model=ClientBalance,
    responses=error_responses(400, 401, 403, 404, 409, 422, 500),
)
async def update_client_payment(
    client_id: UUID,
    payment_id: UUID,
    body: ClientPaymentUpdate,
    leader: LeaderAccount,
    session: Database,
) -> ClientBalance:
    card = await active_client_for_update(session, leader.account_id, client_id)
    payment = await editable_payment(session, card, payment_id)
    amount = Decimal(body.root["amount"]) if "amount" in body.root else payment.amount
    on = body.root.get("date", payment.date)
    validate_payment(amount, on, leader)
    payment.amount = amount
    payment.date = on
    payment.comment = body.root.get("comment", payment.comment)
    result = await read_client_balance(session, card)
    await session.commit()
    return result


@router.delete(
    "/payments/{payment_id}",
    operation_id="deleteClientPayment",
    summary="Delete a recorded payment",
    response_model=ClientBalance,
    responses=error_responses(401, 403, 404, 409, 422, 500),
)
async def delete_client_payment(
    client_id: UUID, payment_id: UUID, leader: LeaderAccount, session: Database
) -> ClientBalance:
    card = await active_client_for_update(session, leader.account_id, client_id)
    payment = await editable_payment(session, card, payment_id)
    await session.delete(payment)
    result = await read_client_balance(session, card)
    await session.commit()
    return result
