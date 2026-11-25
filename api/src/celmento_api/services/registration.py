from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import AcceptanceKind, ErrorCode, RegistrationIntent
from celmento_api.models.legal import Acceptance
from celmento_api.schemas.auth import (
    AccountRegistration,
    FinishOutcome,
    FinishRegistrationResult,
    OriginPage,
    RegistrationFinish,
    RegistrationOrigin,
)
from celmento_api.services.legal import (
    ACTIVATION_CONSENTS,
    REGISTRATION_CONSENTS,
    record_acceptances,
    require_consents,
)
from celmento_api.services.logins import require_available_login
from celmento_api.services.registration_package import (
    DeviceProofPurpose,
    verify_package,
)
from celmento_api.services.sessions import issue_session, issue_ticket
from celmento_api.services.sign_in_codes import find_account


async def validate_registration(
    session: AsyncSession,
    registration: AccountRegistration,
) -> RegistrationOrigin | None:
    await require_consents(
        session,
        registration.consents,
        REGISTRATION_CONSENTS,
        timestamp_required=True,
    )
    origin = registration.origin
    if origin is None:
        return None
    if origin.page != OriginPage.PUBLIC_BOOKING or origin.meeting_id is not None:
        raise AppError(400, ErrorCode.ORIGIN_INVALID)
    leader = await session.scalar(
        select(Account).where(
            Account.login == origin.login.lower(), Account.activated_at.is_not(None)
        ),
    )
    if leader is None:
        raise AppError(400, ErrorCode.ORIGIN_INVALID)
    return RegistrationOrigin(page=origin.page, login=leader.login, meeting_id=None)


async def finish_registration(
    session: AsyncSession,
    body: RegistrationFinish,
) -> FinishRegistrationResult:
    claims = verify_package(
        body.registration_package.get_secret_value(),
        body.device_proof,
        DeviceProofPurpose.FINISH,
    )
    if await find_account(session, claims.email) is not None:
        raise AppError(409, ErrorCode.ACCOUNT_EXISTS)
    current = current_contour()
    local_registration = current == claims.entry_contour
    consents = claims.consents if local_registration else (body.consents or [])
    await require_consents(
        session,
        consents,
        REGISTRATION_CONSENTS,
        timestamp_required=local_registration,
    )
    now = datetime.now(UTC)
    activation = body.activation
    if claims.intent == RegistrationIntent.LEAD:
        if activation is None or not activation.age_confirmed:
            raise AppError(400, ErrorCode.CONSENT_REQUIRED)
        await require_consents(
            session, activation.acceptances, ACTIVATION_CONSENTS, current_required=True
        )
    elif activation is not None:
        raise AppError(400, ErrorCode.ACTIVATION_NOT_OFFERED)
    login = await require_available_login(session, body.login)
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
            activated_at=now if activation is not None else None,
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
        record_acceptances(
            session, activation.acceptances, account_id=account.account_id
        )
        # spec:impl legal-documents#store-account-activation-18-confirmation
        session.add(
            Acceptance(
                account_id=account.account_id,
                kind=AcceptanceKind.AGE_CONFIRMATION,
                accepted_at=now,
            ),
        )
    if local_registration:
        return FinishRegistrationResult(
            outcome=FinishOutcome.SESSION,
            session=await issue_session(session, account),
            ticket=None,
        )
    return FinishRegistrationResult(
        outcome=FinishOutcome.TICKET,
        session=None,
        ticket=await issue_ticket(session, account),
    )
