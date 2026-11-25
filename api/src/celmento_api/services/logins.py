from itertools import count
from re import fullmatch, sub
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account, ReservedLoginWord
from celmento_api.models.enums import ErrorCode, LoginAvailabilityStatus

MIN_LOGIN_LENGTH: int = 5
MAX_LOGIN_LENGTH: int = 32


def login_rule(login: str) -> LoginAvailabilityStatus:
    if not MIN_LOGIN_LENGTH <= len(login) <= MAX_LOGIN_LENGTH:
        return LoginAvailabilityStatus.RULE_LENGTH
    if not fullmatch(r"[a-z0-9_]+", login):
        return LoginAvailabilityStatus.RULE_CHARS
    if not fullmatch(r"[a-z]", login[0]):
        return LoginAvailabilityStatus.RULE_START
    if login.endswith("_"):
        return LoginAvailabilityStatus.RULE_END
    if "__" in login:
        return LoginAvailabilityStatus.RULE_DOUBLE
    return LoginAvailabilityStatus.AVAILABLE


async def login_status(
    session: AsyncSession,
    login: str,
    exclude_account_id: UUID | None = None,
) -> LoginAvailabilityStatus:
    login = login.lower()
    if await session.get(ReservedLoginWord, login) is not None:
        return LoginAvailabilityStatus.RESERVED
    # spec:impl booking-link-login#accept-login-5-32-characters
    rule = login_rule(login)
    if rule != LoginAvailabilityStatus.AVAILABLE:
        return rule
    existing = await session.scalar(
        select(Account.account_id).where(Account.login == login)
    )
    if existing is not None and existing != exclude_account_id:
        return LoginAvailabilityStatus.TAKEN
    return LoginAvailabilityStatus.AVAILABLE


async def require_available_login(session: AsyncSession, login: str) -> str:
    normalized = login.lower()
    availability = await login_status(session, normalized)
    if availability == LoginAvailabilityStatus.TAKEN:
        raise AppError(409, ErrorCode.LOGIN_TAKEN)
    if availability == LoginAvailabilityStatus.RESERVED:
        raise AppError(400, ErrorCode.LOGIN_RESERVED)
    if availability != LoginAvailabilityStatus.AVAILABLE:
        raise AppError(400, ErrorCode.LOGIN_INVALID, {"rule": availability.value})
    return normalized


async def propose_login(session: AsyncSession, email: str) -> str:
    # spec:impl registration-finish-screen#propose-login-from-email
    # spec:impl booking-link-login#propose-login-registration-part-email
    base = sub(r"[^a-z0-9_]", "", email.partition("@")[0].lower())
    base = sub(r"^[^a-z]+", "", base)
    base = sub(r"_+", "_", base)[:MAX_LOGIN_LENGTH].rstrip("_")
    if not base:
        # spec:impl registration-finish-screen#fallback-to-user-login-base
        # spec:impl booking-link-login#use-user-base-proposed-login
        base = "user"
    if len(base) < MIN_LOGIN_LENGTH:
        # spec:impl registration-finish-screen#pad-short-login
        base += "1234"[: MIN_LOGIN_LENGTH - len(base)]
    if await login_status(session, base) == LoginAvailabilityStatus.AVAILABLE:
        return base
    for n in count(1):
        suffix = str(n)
        candidate = base[: MAX_LOGIN_LENGTH - len(suffix)] + suffix
        if await login_status(session, candidate) == LoginAvailabilityStatus.AVAILABLE:
            # spec:impl registration-finish-screen#choose-smallest-free-suffix
            return candidate
    raise AssertionError("Login suffix search did not terminate")
