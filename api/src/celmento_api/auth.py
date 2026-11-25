from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.db import get_session
from celmento_api.errors import AppError
from celmento_api.models.account import Account, AccountSession
from celmento_api.models.enums import ErrorCode
from celmento_api.services.sessions import require_session

bearer: HTTPBearer = HTTPBearer(auto_error=False, scheme_name="bearerAuth")

Database = Annotated[AsyncSession, Depends(get_session)]


async def current_session(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    session: Database,
) -> AccountSession:
    if credentials is None:
        raise AppError(401, ErrorCode.UNAUTHORIZED)
    return await require_session(session, credentials.credentials)


async def current_account(
    account_session: Annotated[AccountSession, Depends(current_session)],
    session: Database,
) -> Account:
    account = await session.get(Account, account_session.account_id)
    if account is None:
        raise AppError(401, ErrorCode.UNAUTHORIZED)
    return account


async def current_leader(
    account: Annotated[Account, Depends(current_account)],
) -> Account:
    if account.activated_at is None:
        raise AppError(403, ErrorCode.ACTIVATION_REQUIRED)
    return account
