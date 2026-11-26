from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.account import RegistrationPackageUse
from celmento_api.models.enums import Contour, ErrorCode
from celmento_api.schemas.auth import RegistrationHandoff, RegistrationHandoffRequest
from celmento_api.services.registration_package import (
    DeviceProofPurpose,
    issue_handoff,
    package_digest,
    require_unexpired,
    verify_package,
)


def contour_conflict(selected: Contour) -> AppError:
    return AppError(409, ErrorCode.CONFLICT, {"selected_contour": selected.value})


async def recorded_contour(session: AsyncSession, digest: str) -> Contour | None:
    selected = await session.scalar(
        select(RegistrationPackageUse.selected_contour).where(
            RegistrationPackageUse.package_digest == digest
        )
    )
    return Contour(selected) if selected is not None else None


async def record_package_use(
    session: AsyncSession, digest: str, selected: Contour, expires_at: datetime
) -> Contour | None:
    require_unexpired(expires_at)
    await session.execute(
        delete(RegistrationPackageUse).where(
            RegistrationPackageUse.expires_at <= datetime.now(UTC)
        )
    )
    inserted = await session.scalar(
        insert(RegistrationPackageUse)
        .values(
            package_digest=digest,
            selected_contour=selected.value,
            expires_at=expires_at,
        )
        .on_conflict_do_nothing(index_elements=[RegistrationPackageUse.package_digest])
        .returning(RegistrationPackageUse.registration_package_use_id)
    )
    # An insert waiting on a competing choice must not continue after expiry.
    require_unexpired(expires_at)
    if inserted is not None:
        return None
    previous = await recorded_contour(session, digest)
    require_unexpired(expires_at)
    if previous is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return previous


async def authorize_handoff(
    session: AsyncSession, body: RegistrationHandoffRequest
) -> RegistrationHandoff:
    token = body.registration_package.get_secret_value()
    selected = body.selected_contour
    claims = verify_package(
        token, body.device_proof, DeviceProofPurpose.HANDOFF, selected
    )
    if claims.entry_contour != current_contour() or selected == claims.entry_contour:
        raise AppError(400, ErrorCode.REGISTRATION_PACKAGE_INVALID)
    if claims.origin is not None:
        raise AppError(400, ErrorCode.REGION_LOCKED)
    digest = package_digest(token)
    previous = await record_package_use(session, digest, selected, claims.expires_at)
    if previous is not None and previous != selected:
        raise contour_conflict(previous)
    return issue_handoff(claims, digest, selected)
