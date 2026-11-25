from asyncio import get_running_loop
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from hmac import compare_digest, digest
from math import ceil
from secrets import randbelow
from threading import Lock
from time import monotonic

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.config import get_settings
from celmento_api.emails import EmailTemplate, send_email
from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import ErrorCode, Language

CODE_VALID_SECONDS: int = 10 * 60
RESEND_SECONDS: int = 60
LOCK_SECONDS: int = 15 * 60
MAX_ATTEMPTS: int = 5
STATE_RETENTION_SECONDS: int = CODE_VALID_SECONDS + LOCK_SECONDS


@dataclass(slots=True)
class Challenge:
    digest: bytes = field(repr=False)
    sent_at: float
    attempts: int = 0
    unlock_at: float = 0
    used: bool = False
    claimed: bool = False


_lock: Lock = Lock()
_challenges: dict[bytes, Challenge] = {}


def normalize_email(value: str) -> str:
    try:
        email = validate_email(value.strip(), check_deliverability=False).normalized
    except EmailNotValidError:
        raise AppError(400, ErrorCode.EMAIL_INVALID) from None
    # spec:impl email-code-sign-in#normalize-email
    return email.lower()


async def find_account(session: AsyncSession, email: str) -> Account | None:
    # spec:impl email-code-sign-in#look-up-entry-contour
    return await session.scalar(select(Account).where(Account.email == email))


def _digest(payload: bytes) -> bytes:
    key = get_settings().session_secret.get_secret_value().encode()
    return digest(key, payload, "sha256")


def _identity(email: str) -> bytes:
    return _digest(b"code-identity:" + email.encode())


def _code_digest(identity: bytes, code: str) -> bytes:
    return _digest(b"code-value:" + identity + code.encode("ascii"))


def _rate_error(code: ErrorCode, seconds: float) -> AppError:
    return AppError(429, code, {"retry_after_seconds": ceil(seconds)})


def _forget(identity: bytes, challenge: Challenge) -> None:
    with _lock:
        if _challenges.get(identity) is challenge and not challenge.claimed:
            del _challenges[identity]


def _issue_code(identity: bytes) -> str:
    now = monotonic()
    with _lock:
        existing = _challenges.get(identity)
        if existing is not None:
            if existing.unlock_at > now:
                raise _rate_error(ErrorCode.CODE_LOCKED, existing.unlock_at - now)
            remaining = RESEND_SECONDS - (now - existing.sent_at)
            if remaining > 0 or existing.claimed:
                # spec:impl email-code-sign-in#enforce-resend-cooldown
                raise _rate_error(ErrorCode.RESEND_TOO_SOON, max(1, remaining))
        code = f"{randbelow(1_000_000):06d}"
        code_digest = _code_digest(identity, code)
        attempts = 0
        if existing is not None:
            if now < existing.sent_at + CODE_VALID_SECONDS and not existing.used:
                attempts = existing.attempts
            while compare_digest(existing.digest, code_digest):
                code = f"{randbelow(1_000_000):06d}"
                code_digest = _code_digest(identity, code)
        challenge = Challenge(digest=code_digest, sent_at=now, attempts=attempts)
        _challenges[identity] = challenge
        get_running_loop().call_later(
            STATE_RETENTION_SECONDS,
            _forget,
            identity,
            challenge,
        )
    return code


async def send_code(email: str, language: Language) -> None:
    # spec:impl email-code-sign-in#send-code-email-transactional-email-code
    await send_email(
        email,
        EmailTemplate.SIGN_IN_CODE,
        language,
        {
            "code": _issue_code(_identity(email)),
            "code_valid_minutes": str(CODE_VALID_SECONDS // 60),
        },
    )


@contextmanager
def claim_code(email: str, code: str) -> Generator[None]:
    identity = _identity(email)
    now = monotonic()
    with _lock:
        challenge = _challenges.get(identity)
        if challenge is None or challenge.used or challenge.claimed:
            raise AppError(400, ErrorCode.CODE_INVALID)
        if challenge.unlock_at > now:
            raise _rate_error(ErrorCode.CODE_LOCKED, challenge.unlock_at - now)
        if now - challenge.sent_at >= CODE_VALID_SECONDS:
            # spec:impl email-code-sign-in#expire-code-in-ten-minutes
            raise AppError(400, ErrorCode.CODE_EXPIRED)
        if not compare_digest(challenge.digest, _code_digest(identity, code)):
            challenge.attempts += 1
            if challenge.attempts >= MAX_ATTEMPTS:
                # spec:impl email-code-sign-in#lock-after-five-attempts
                challenge.unlock_at = now + LOCK_SECONDS
                raise _rate_error(ErrorCode.CODE_LOCKED, LOCK_SECONDS)
            raise AppError(400, ErrorCode.CODE_INVALID)
        challenge.claimed = True
    succeeded = False
    try:
        yield
        succeeded = True
    finally:
        with _lock:
            challenge.used = succeeded
            challenge.claimed = False
            if monotonic() - challenge.sent_at >= STATE_RETENTION_SECONDS:
                del _challenges[identity]
