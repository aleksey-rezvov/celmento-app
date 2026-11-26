from hashlib import sha256
from re import fullmatch
from typing import Annotated

from fastapi import Depends
from fastapi.security import APIKeyHeader
from sqlalchemy import select

from celmento_api.auth import Database
from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.admin import AdminKey
from celmento_api.models.enums import ErrorCode

admin_header: APIKeyHeader = APIKeyHeader(
    name="X-Admin-Key", scheme_name="adminKey", auto_error=False
)


def admin_key_hash(value: str) -> str:
    return sha256(
        f"celmento:admin:{current_contour().value}:{value}".encode()
    ).hexdigest()


async def require_admin_key(
    raw: Annotated[str | None, Depends(admin_header)], session: Database
) -> AdminKey:
    if raw is None or fullmatch(r"clm_admin_[A-Za-z0-9_-]{43}", raw) is None:
        raise AppError(401, ErrorCode.UNAUTHORIZED)
    # spec:impl admin-ai-assistant#issue-separate-administrator-key-contour
    # spec:impl admin-ai-assistant#stop-performing-action-key-revoked
    key = await session.scalar(
        select(AdminKey)
        .where(AdminKey.key_hash == admin_key_hash(raw), AdminKey.revoked_at.is_(None))
        .with_for_update(read=True)
    )
    if key is None:
        raise AppError(401, ErrorCode.UNAUTHORIZED)
    return key


Administrator = Annotated[AdminKey, Depends(require_admin_key)]
