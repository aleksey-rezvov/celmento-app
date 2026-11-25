from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from celmento_api.auth import Database, current_session
from celmento_api.errors import AppError, error_responses
from celmento_api.models.account import AccountSession
from celmento_api.models.enums import ErrorCode, LoginAvailabilityStatus
from celmento_api.schemas.auth import (
    AccountRegistration,
    AccountRegistrationResult,
    CodeRequestOutcome,
    FinishRegistrationResult,
    LoginAvailability,
    RegistrationFinish,
    RegistrationLoginCheck,
    RegistrationPackageRef,
    SignInCodeRequest,
    SignInCodeRequestResult,
    SignInCodeVerification,
    SignInCodeVerificationResult,
    SignInSession,
    SignInTicketExchange,
    VerificationOutcome,
)
from celmento_api.services.logins import login_status, propose_login
from celmento_api.services.registration import (
    finish_registration,
    validate_registration,
)
from celmento_api.services.registration_package import (
    DeviceProofPurpose,
    issue_package,
    verify_package,
)
from celmento_api.services.sessions import exchange_ticket, issue_session
from celmento_api.services.sign_in_codes import (
    claim_code,
    find_account,
    normalize_email,
    send_code,
)
from celmento_api.storage import media_origin

router: APIRouter = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/code/request",
    operation_id="requestSignInCode",
    summary="Request a sign-in code",
    response_model=SignInCodeRequestResult,
    responses=error_responses(400, 422, 429, 500),
)
async def request_code(
    body: SignInCodeRequest, session: Database
) -> SignInCodeRequestResult:
    email = normalize_email(body.email)
    account = await find_account(session, email)
    if account is None:
        # spec:impl email-code-sign-in#route-unknown-email-to-registration
        return SignInCodeRequestResult(
            outcome=CodeRequestOutcome.REGISTRATION_REQUIRED, first_name=None
        )
    # spec:impl email-code-sign-in#send-six-digit-code
    await send_code(email, body.language)
    return SignInCodeRequestResult(
        outcome=CodeRequestOutcome.CODE_SENT, first_name=account.first_name
    )


@router.post(
    "/register",
    operation_id="registerAccount",
    summary="Request a registration code",
    response_model=AccountRegistrationResult,
    responses=error_responses(400, 422, 429, 500),
)
async def register(
    body: AccountRegistration, session: Database
) -> AccountRegistrationResult:
    email = normalize_email(body.email)
    account = await find_account(session, email)
    if account is None:
        await validate_registration(session, body)
    # spec:impl account-registration#defer-personal-data-until-finish
    # spec:impl account-registration#send-code-on-registration
    await send_code(email, body.language)
    # spec:impl account-registration#handle-reused-email
    return AccountRegistrationResult(
        account_exists=account is not None,
        first_name=account.first_name if account is not None else None,
    )


@router.post(
    "/code/verify",
    operation_id="verifySignInCode",
    summary="Verify the latest sign-in code",
    response_model=SignInCodeVerificationResult,
    responses=error_responses(400, 422, 429, 500),
)
async def verify(
    request: Request, body: SignInCodeVerification, session: Database
) -> SignInCodeVerificationResult:
    email = normalize_email(body.email)
    with claim_code(email, body.code.get_secret_value()):
        account = await find_account(session, email)
        if account is not None:
            result = SignInCodeVerificationResult(
                outcome=VerificationOutcome.SIGNED_IN,
                session=await issue_session(session, account, media_origin(request)),
                registration_package=None,
            )
            await session.commit()
            return result
        registration = body.registration
        if registration is None or normalize_email(registration.email) != email:
            raise AppError(400, ErrorCode.REGISTRATION_REQUIRED)
        if body.registration_device_key is None:
            raise AppError(400, ErrorCode.REGISTRATION_PACKAGE_INVALID)
        origin = await validate_registration(session, registration)
        # spec:impl registration-finish-screen#defer-account-until-finish
        return SignInCodeVerificationResult(
            outcome=VerificationOutcome.REGISTRATION_CONFIRMED,
            session=None,
            registration_package=issue_package(
                email, registration, origin, body.registration_device_key
            ),
        )


@router.post(
    "/registration/login-proposal",
    operation_id="proposeRegistrationLogin",
    summary="Propose an available registration login",
    response_model=LoginAvailability,
    responses=error_responses(400, 422, 500),
)
async def proposed_login(
    body: RegistrationPackageRef, session: Database
) -> LoginAvailability:
    claims = verify_package(
        body.registration_package.get_secret_value(),
        body.device_proof,
        DeviceProofPurpose.LOGIN_PROPOSAL,
    )
    login = await propose_login(session, claims.email)
    return LoginAvailability(login=login, status=LoginAvailabilityStatus.AVAILABLE)


@router.post(
    "/registration/login-availability",
    operation_id="checkRegistrationLogin",
    summary="Check the availability of a typed registration login",
    response_model=LoginAvailability,
    responses=error_responses(400, 422, 500),
)
async def check_login(
    body: RegistrationLoginCheck, session: Database
) -> LoginAvailability:
    verify_package(
        body.registration_package.get_secret_value(),
        body.device_proof,
        DeviceProofPurpose.LOGIN_AVAILABILITY,
    )
    return LoginAvailability(
        login=body.login.lower(), status=await login_status(session, body.login)
    )


@router.post(
    "/registration/finish",
    operation_id="finishRegistration",
    summary="Finish registration in the selected contour",
    status_code=201,
    response_model=FinishRegistrationResult,
    responses=error_responses(400, 409, 422, 500),
)
async def finish(
    request: Request, body: RegistrationFinish, session: Database
) -> FinishRegistrationResult:
    result = await finish_registration(session, body, media_origin(request))
    await session.commit()
    return result


@router.post(
    "/tickets/exchange",
    operation_id="exchangeSignInTicket",
    summary="Exchange a one-time sign-in ticket",
    response_model=SignInSession,
    responses=error_responses(400, 422, 500),
)
async def exchange(
    request: Request, body: SignInTicketExchange, session: Database
) -> SignInSession:
    signed_in = await exchange_ticket(
        session, body.ticket.get_secret_value(), media_origin(request)
    )
    await session.commit()
    return signed_in


@router.post(
    "/sign-out",
    operation_id="signOut",
    summary="Sign out from the current session",
    status_code=204,
    response_class=Response,
    response_model=None,
    responses=error_responses(401, 500),
)
async def sign_out(
    record: Annotated[AccountSession, Depends(current_session)],
    session: Database,
) -> Response:
    # spec:impl account-profile#delete-change-server-data-sign-out
    record.revoked_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=204)
