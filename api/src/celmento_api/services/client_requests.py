from dataclasses import dataclass
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.client_request_receipt import (
    ClientRequestReceipt,
    ClientWriteOperation,
)
from celmento_api.models.enums import ErrorCode
from celmento_api.services.account_access import lock_account
from celmento_api.services.idempotency import request_fingerprint


@dataclass(frozen=True, slots=True)
class ClientWriteRequest:
    operation: ClientWriteOperation
    key: UUID
    fingerprint: str


def client_write_request(
    operation: ClientWriteOperation,
    key: UUID | None,
    body: BaseModel,
    client_id: UUID | None = None,
) -> ClientWriteRequest | None:
    if key is None:
        return None
    return ClientWriteRequest(operation, key, request_fingerprint(body, client_id))


async def previous_client(
    session: AsyncSession, leader_id: UUID, request: ClientWriteRequest | None
) -> UUID | None:
    if request is None:
        return None
    # All keyed writes acquire the leader lock before looking up or changing a card.
    await lock_account(session, leader_id, no_key_update=True)
    receipt = await session.scalar(
        select(ClientRequestReceipt).where(
            ClientRequestReceipt.leader_account_id == leader_id,
            ClientRequestReceipt.operation == request.operation.value,
            ClientRequestReceipt.idempotency_key == request.key,
        )
    )
    if receipt is None:
        return None
    if receipt.request_digest != request.fingerprint:
        raise AppError(409, ErrorCode.CONFLICT)
    return receipt.client_card_id


def remember_client_write(
    session: AsyncSession,
    leader_id: UUID,
    client_id: UUID,
    request: ClientWriteRequest | None,
) -> None:
    if request is not None:
        session.add(
            ClientRequestReceipt(
                leader_account_id=leader_id,
                client_card_id=client_id,
                operation=request.operation.value,
                idempotency_key=request.key,
                request_digest=request.fingerprint,
            )
        )
