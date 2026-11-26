from uuid import UUID

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import Contour, ErrorCode, RegistrationIntent
from celmento_api.schemas.auth import (
    AccountRegistration,
    FinishOutcome,
    FinishRegistrationResult,
    OriginPage,
    RegistrationFinish,
    RegistrationOrigin,
)
from celmento_api.services.account_hooks import notify_inviter
from celmento_api.services.activation import (
    record_activation,
    require_activation_consents,
)
from celmento_api.services.legal import (
    REGISTRATION_CONSENTS,
    record_acceptances,
    require_consents,
)
from celmento_api.services.links import auto_link_for_account
from celmento_api.services.logins import require_available_login
from celmento_api.services.public_pages import invited_meeting, public_leader
from celmento_api.services.registration_handoff import (
    contour_conflict,
    record_package_use,
    recorded_contour,
)
from celmento_api.services.registration_package import (
    DeviceProofPurpose,
    package_digest,
    verify_handoff,
    verify_package,
)
from celmento_api.services.sessions import issue_session, issue_ticket
from celmento_api.services.sign_in_codes import find_account


async def validate_registration(
    session: AsyncSession,
    registration: AccountRegistration,
    *,
    current_consent_required: bool,
) -> tuple[RegistrationOrigin | None, UUID | None]:
    await require_consents(
        session,
        registration.consents,
        REGISTRATION_CONSENTS,
        timestamp_required=True,
        current_required=current_consent_required,
    )
    origin = registration.origin
    if origin is None:
        return None, None
    if origin.page == OriginPage.MEETING_INVITE:
        if origin.meeting_id is None:
            raise AppError(400, ErrorCode.ORIGIN_INVALID)
        invited = await invited_meeting(session, origin.login, origin.meeting_id)
        if invited is None:
            raise AppError(400, ErrorCode.ORIGIN_INVALID)
        leader, meeting = invited
        return (
            RegistrationOrigin(
                page=origin.page,
                login=leader.login,
                meeting_id=meeting.public_id,
                specialist_first_name=leader.first_name,
            ),
            leader.account_id,
        )
    if origin.meeting_id is not None:
        raise AppError(400, ErrorCode.ORIGIN_INVALID)
    try:
        leader = await public_leader(session, origin.login)
    except AppError as exc:
        if exc.code != ErrorCode.NOT_FOUND:
            raise
        raise AppError(400, ErrorCode.ORIGIN_INVALID) from None
    return RegistrationOrigin(
        page=origin.page, login=leader.login, meeting_id=None
    ), None


async def _require_unused_package(
    session: AsyncSession, digest: str, current: Contour, email: str
) -> None:
    selected = await recorded_contour(session, digest)
    if selected is not None and selected != current:
        raise contour_conflict(selected)
    if await find_account(session, email) is not None:
        raise AppError(409, ErrorCode.ACCOUNT_EXISTS)
    if selected is not None:
        raise contour_conflict(selected)


async def finish_registration(
    session: AsyncSession,
    body: RegistrationFinish,
    origin: str,
) -> FinishRegistrationResult:
    token = body.registration_package.get_secret_value()
    claims = verify_package(token, body.device_proof, DeviceProofPurpose.FINISH)
    digest = package_digest(token)
    current = current_contour()
    local_registration = current == claims.entry_contour
    if not local_registration:
        if body.handoff is None:
            raise AppError(400, ErrorCode.REGISTRATION_PACKAGE_INVALID)
        verify_handoff(body.handoff.get_secret_value(), claims, digest, current)
    await _require_unused_package(session, digest, current, claims.email)
    consents = claims.consents if local_registration else (body.consents or [])
    await require_consents(
        session,
        consents,
        REGISTRATION_CONSENTS,
        timestamp_required=local_registration,
        current_required=not local_registration,
    )
    activation = body.activation
    if claims.intent == RegistrationIntent.LEAD:
        activation = await require_activation_consents(session, activation)
    elif activation is not None:
        raise AppError(400, ErrorCode.ACTIVATION_NOT_OFFERED)
    try:
        login = await require_available_login(session, body.login)
    except AppError:
        await _require_unused_package(session, digest, current, claims.email)
        raise
    # spec:impl registration-finish-screen#reject-reused-registration-package
    previous = await record_package_use(session, digest, current, claims.expires_at)
    if previous is not None:
        await _require_unused_package(session, digest, current, claims.email)
        raise contour_conflict(previous)
    # spec:impl registration-finish-screen#create-in-selected-contour
    account = await session.scalar(
        insert(Account)
        .values(
            email=claims.email,
            first_name=claims.first_name,
            last_name=claims.last_name,
            login=login,
            language=body.language.value,
            time_zone=body.time_zone,
        )
        .on_conflict_do_nothing()
        .returning(Account),
    )
    if account is None:
        if await find_account(session, claims.email) is not None:
            raise AppError(409, ErrorCode.ACCOUNT_EXISTS)
        raise AppError(409, ErrorCode.LOGIN_TAKEN)
    # spec:impl legal-documents#store-selected-contour-consents
    record_acceptances(
        session,
        consents,
        account_id=account.account_id,
        keep_client_time=local_registration,
    )
    if activation is not None:
        await record_activation(session, account, activation)
    # spec:impl meeting-invite-page#link-card-new-account-add
    await auto_link_for_account(session, account)
    await notify_inviter(session, account, claims.inviter_id, body.notify_specialist)
    if local_registration:
        return FinishRegistrationResult(
            outcome=FinishOutcome.SESSION,
            session=await issue_session(session, account, origin),
            ticket=None,
        )
    return FinishRegistrationResult(
        outcome=FinishOutcome.TICKET,
        session=None,
        ticket=await issue_ticket(session, account),
    )
