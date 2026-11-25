from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.enums import AcceptanceKind, ErrorCode
from celmento_api.models.leader import LeaderProfile
from celmento_api.models.legal import Acceptance
from celmento_api.schemas.auth import AccountActivation
from celmento_api.services.account_access import lock_account
from celmento_api.services.legal import (
    ACTIVATION_CONSENTS,
    record_acceptances,
    require_consents,
)
from celmento_api.services.preseeded_notes import create_for


async def require_activation_consents(
    session: AsyncSession, body: AccountActivation | None
) -> AccountActivation:
    if body is None or not body.age_confirmed:
        raise AppError(400, ErrorCode.CONSENT_REQUIRED)
    await require_consents(
        session, body.acceptances, ACTIVATION_CONSENTS, current_required=True
    )
    return body


async def record_activation(
    session: AsyncSession, account: Account, confirmed: AccountActivation
) -> None:
    now = datetime.now(UTC)
    # spec:impl client-leading-activation#turn-activation-person-confirms
    account.activated_at = now
    # spec:impl legal-documents#store-account-activation-18-confirmation
    record_acceptances(
        session, confirmed.acceptances, account_id=account.account_id, accepted_at=now
    )
    session.add(
        Acceptance(
            account_id=account.account_id,
            kind=AcceptanceKind.AGE_CONFIRMATION.value,
            accepted_at=now,
        )
    )
    # spec:impl account-profile#show-contacts-fields-phone-telegram
    # spec:impl default-rate-currency#leave-price-empty-new-leader
    profile = LeaderProfile(account_id=account.account_id, contact_email=account.email)
    session.add(profile)
    # spec:impl client-leading-activation#create-preseeded-notes-moment-activation
    # spec:impl preseeded-notes#create-preseeded-set-moment-activation
    await create_for(session, account, profile)


async def activate(
    session: AsyncSession, account: Account, body: AccountActivation
) -> Account:
    account = await lock_account(session, account.account_id)
    if account.activated_at is not None:
        # spec:impl client-leading-activation#offer-control-request-turns-activation
        raise AppError(409, ErrorCode.ALREADY_ACTIVATED)
    confirmed = await require_activation_consents(session, body)
    await record_activation(session, account, confirmed)
    return account
