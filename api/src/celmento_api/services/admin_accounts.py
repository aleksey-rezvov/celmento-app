from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError, invalid_request_value
from celmento_api.models.account import Account
from celmento_api.models.admin import AdminKey
from celmento_api.models.enums import (
    AdminAction,
    AdminJournalObjectType,
    ErrorCode,
    NoticeKey,
    NoticeTab,
)
from celmento_api.models.subscription import Subscription
from celmento_api.schemas.admin import AdminAccountLookup, AdminGrantedSubscription
from celmento_api.services.account_access import account_date
from celmento_api.services.journal import append_journal
from celmento_api.services.notices import raise_notice
from celmento_api.services.plan_status import plan_status
from celmento_api.services.sign_in_codes import normalize_email


async def lookup_account(
    session: AsyncSession, email: str
) -> AdminAccountLookup | None:
    try:
        normalized = normalize_email(email)
    except AppError:
        raise invalid_request_value("query", "email") from None
    account = await session.scalar(select(Account).where(Account.email == normalized))
    if account is None:
        return None
    # spec:impl admin-content-and-access#find-account-email-request-show
    # spec:impl admin-ai-assistant#limit-data-reachable-actions-f11
    return AdminAccountLookup(
        id=account.account_id,
        email=account.email,
        created_at=account.created_at,
        activated=account.activated_at is not None,
        plan=await plan_status(session, account),
    )


def _subscription_view(row: Subscription) -> AdminGrantedSubscription:
    return AdminGrantedSubscription(
        account_id=row.account_id,
        until=row.until,
        granted_by=row.granted_by,
        granted_at=row.granted_at,
        source="admin",
    )


async def grant_subscription(
    session: AsyncSession, key: AdminKey, account_id: UUID, until: date
) -> AdminGrantedSubscription:
    account = await session.scalar(
        select(Account)
        .where(Account.account_id == account_id)
        .with_for_update(key_share=True)
    )
    if account is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    if until <= account_date(account):
        raise invalid_request_value("body", "until")
    row = await session.get(Subscription, account_id)
    before = (
        _subscription_view(row).model_dump(mode="json") if row is not None else None
    )
    now = datetime.now(UTC)
    # spec:impl admin-content-and-access#grant-subscription-account-until-date
    # spec:impl admin-content-and-access#record-granted-subscription-account-end
    # spec:impl subscription-plans-request#treat-subscription-granted-administrator
    if row is None:
        row = Subscription(
            account_id=account_id, until=until, granted_by=key.label, granted_at=now
        )
        session.add(row)
    else:
        # spec:impl admin-content-and-access#replace-end-date-newly-named
        row.until = until
        row.granted_by = key.label
        row.granted_at = now
    result = _subscription_view(row)
    # spec:impl admin-content-and-access#notify-account-automatically-after-grant
    # spec:impl in-app-notice-bar#produce-bars-access-granted-profile-tab
    await raise_notice(
        session,
        account_id,
        NoticeTab.PROFILE,
        NoticeKey.ACCESS_GRANTED,
        {"date": until.isoformat()},
    )
    append_journal(
        session,
        key,
        AdminAction.GRANT_SUBSCRIPTION,
        AdminJournalObjectType.SUBSCRIPTION,
        object_id=str(account_id),
        params={"until": until.isoformat()},
        before=before,
        after=result.model_dump(mode="json"),
    )
    return result
