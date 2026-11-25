from datetime import UTC, datetime, timedelta
from hmac import digest
from secrets import token_urlsafe

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.config import get_settings
from celmento_api.contour import current_contour, web_url
from celmento_api.errors import AppError
from celmento_api.models.account import Account, AccountSession
from celmento_api.models.account import SignInTicket as TicketRecord
from celmento_api.models.enums import ErrorCode
from celmento_api.schemas.auth import SignInSession, SignInTicket
from celmento_api.services.accounts import account_view

TICKET_LIFETIME: timedelta = timedelta(minutes=2)


def _token_hash(purpose: bytes, token: str) -> str:
    secret = get_settings().session_secret.get_secret_value().encode()
    return digest(secret, purpose + b":" + token.encode(), "sha256").hex()


async def issue_session(
    session: AsyncSession, account: Account, origin: str
) -> SignInSession:
    token = token_urlsafe(32)
    session.add(
        AccountSession(
            account_id=account.account_id, token_hash=_token_hash(b"session", token)
        )
    )
    return SignInSession(
        token=token, account=await account_view(session, account, origin)
    )


async def require_session(session: AsyncSession, token: str) -> AccountSession:
    stored = await session.scalar(
        select(AccountSession).where(
            AccountSession.token_hash == _token_hash(b"session", token),
            AccountSession.revoked_at.is_(None),
        ),
    )
    if stored is None:
        raise AppError(401, ErrorCode.UNAUTHORIZED)
    return stored


async def issue_ticket(session: AsyncSession, account: Account) -> SignInTicket:
    ticket = token_urlsafe(32)
    expires_at = datetime.now(UTC) + TICKET_LIFETIME
    session.add(
        TicketRecord(
            account_id=account.account_id,
            token_hash=_token_hash(b"ticket", ticket),
            expires_at=expires_at,
        ),
    )
    return SignInTicket(
        ticket=ticket,
        ticket_url=f"{web_url(current_contour())}/login/ticket#ticket={ticket}",
        expires_at=expires_at,
    )


async def exchange_ticket(
    session: AsyncSession, ticket: str, origin: str
) -> SignInSession:
    now = datetime.now(UTC)
    # spec:impl region-contours#reject-invalid-tickets
    account_id = await session.scalar(
        update(TicketRecord)
        .where(
            TicketRecord.token_hash == _token_hash(b"ticket", ticket),
            TicketRecord.used_at.is_(None),
            TicketRecord.expires_at > now,
        )
        .values(used_at=now)
        .returning(TicketRecord.account_id),
    )
    if account_id is None:
        raise AppError(400, ErrorCode.TICKET_INVALID)
    account = await session.get(Account, account_id)
    if account is None:
        raise AppError(400, ErrorCode.TICKET_INVALID)
    return await issue_session(session, account, origin)
