from asyncio import Event, TaskGroup, timeout
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from uuid import UUID, uuid7

import pytest
from httpx import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from test_account import ACCOUNT, FEEDBACK, AccountStand, account_stand
from test_auth_registration import AuthStand, auth_stand
from test_clients_api import CLIENTS, bearer, create_card, problem
from test_meeting_notifications import mail_outbox, notices_for
from test_meetings_api import MEETINGS, meeting_from, post_meeting
from test_meetings_ledger import client_form
from test_public_bookings import FrozenTime
from test_records_api import add_payment, records_summary
from test_specialists_api import validation_problem

from celmento_api.admin_keys import issue_key, revoke_key
from celmento_api.models.admin import AdminKey
from celmento_api.models.enums import (
    AdminAction,
    Contour,
    ErrorCode,
    NoticeKey,
    NoticeTab,
)
from celmento_api.routers import admin as admin_router
from celmento_api.schemas.account import Account as AccountView
from celmento_api.schemas.account import PlanKind
from celmento_api.schemas.admin import (
    AdminAccountLookup,
    AdminFeedbackList,
    AdminGrantedSubscription,
    AdminJournalList,
)
from celmento_api.services import account_access
from celmento_api.services.limit import FREE_PLAN_LIMIT

__all__: list[str] = ["account_stand", "auth_stand", "mail_outbox"]

ADMIN: str = "/api/v1/admin"
LOOKUP: str = f"{ADMIN}/accounts/lookup"
JOURNAL: str = f"{ADMIN}/journal"
ADMIN_FEEDBACK: str = f"{ADMIN}/feedback"
RESERVED: str = f"{ADMIN}/reserved-login-words"


def admin_result[Output: BaseModel](
    response: Response, model: type[Output], status: int = 200
) -> Output:
    assert response.status_code == status, response.text
    return model.model_validate_json(response.content)


async def admin_access(
    stand: AccountStand | AuthStand, label: str = "Contour administrator"
) -> tuple[UUID, dict[str, str]]:
    async with stand.session() as session:
        key, credential = await issue_key(session, label)
        key_id = key.admin_key_id
        await session.commit()
    return key_id, {"X-Admin-Key": credential}


# spec:test admin-ai-assistant#issue-separate-administrator-key-contour
# spec:test admin-ai-assistant#let-product-owner-revoke-administrator
# spec:test admin-ai-assistant#stop-performing-action-key-revoked
# spec:test admin-ai-assistant#show-journal-key-contour-administrator
# spec:test admin-ai-assistant#return-data-other-contour-combine
# spec:test admin-content-and-access#limit-action-spec-accounts-content
# spec:test admin-content-and-access#grant-subscription-change-content-update
async def test_admin_keys_and_journal_are_contour_local_and_survive_revoke(
    auth_stand: AuthStand,
) -> None:
    stand = auth_stand
    client = stand.client
    email = "admin-lookup-subject@example.com"
    params = {"email": email.upper()}
    stand.switch(Contour.RU)
    await stand.add_account(email, "ru_lookup")
    ru_key_id, ru_headers = await admin_access(stand)
    ru = admin_result(
        await client.get(LOOKUP, headers=ru_headers, params=params), AdminAccountLookup
    )
    assert not ru.activated and ru.plan.active_clients == 0

    stand.switch(Contour.WORLD)
    await stand.add_account(email, "world_lookup")
    _, world_headers = await admin_access(stand)
    problem(
        await client.get(LOOKUP, headers=ru_headers, params=params),
        401,
        ErrorCode.UNAUTHORIZED,
    )
    world = admin_result(
        await client.get(LOOKUP, headers=world_headers, params=params),
        AdminAccountLookup,
    )
    assert world.email == ru.email == email and world.id != ru.id
    problem(
        await client.put(
            f"{ADMIN}/accounts/{ru.id}/subscription",
            headers=world_headers,
            json={"until": "2099-01-01"},
        ),
        404,
        ErrorCode.NOT_FOUND,
    )
    journal = admin_result(
        await client.get(JOURNAL, headers=world_headers), AdminJournalList
    )
    assert [(entry.action, entry.object_id) for entry in journal.items] == [
        (AdminAction.LOOKUP_ACCOUNT, str(world.id))
    ]
    stand.switch(Contour.RU)
    async with stand.session() as session:
        old = await session.get(AdminKey, ru_key_id)
        assert old is not None and old.admin_key_id.version == 7
        if old.key_hash == ru_headers["X-Admin-Key"]:
            pytest.fail("An administrator key was stored raw")
        assert len(old.key_hash) == 64
        assert await revoke_key(session, ru_key_id)
        await session.commit()
    problem(await client.get(JOURNAL, headers=ru_headers), 401, ErrorCode.UNAUTHORIZED)
    _, replacement = await admin_access(stand, "Replacement administrator")
    previous = await client.get(JOURNAL, headers=replacement)
    entries = admin_result(previous, AdminJournalList).items
    assert [(entry.action, entry.object_id) for entry in entries] == [
        (AdminAction.LOOKUP_ACCOUNT, str(ru.id))
    ]
    assert entries[0].before is None and entries[0].after is None
    assert email not in previous.text and str(world.id) not in previous.text
    if ru_headers["X-Admin-Key"] in previous.text:
        pytest.fail("A credential was returned in the journal")


async def test_revocation_waits_for_an_authenticated_read_to_commit(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    stand = account_stand
    target = await stand.add_account("revocation_subject")
    key_id, headers = await admin_access(stand)
    read_started, permit_read, revoke_started = Event(), Event(), Event()
    lookup_account = admin_router.lookup_account
    backend_pid: int | None = None

    async def pause_lookup(
        session: AsyncSession, email: str
    ) -> AdminAccountLookup | None:
        read_started.set()
        await permit_read.wait()
        return await lookup_account(session, email)

    async def revoke() -> None:
        nonlocal backend_pid
        async with stand.session() as session:
            value: object = await session.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(value, int)
            backend_pid = value
            revoke_started.set()
            assert await revoke_key(session, key_id)
            await session.commit()

    monkeypatch.setattr(admin_router, "lookup_account", pause_lookup)
    async with timeout(10), TaskGroup() as tasks:
        read = tasks.create_task(
            stand.client.get(
                LOOKUP, headers=headers, params={"email": target.account.email}
            )
        )
        await read_started.wait()
        pending = tasks.create_task(revoke())
        await revoke_started.wait()
        assert backend_pid is not None
        async with stand.session() as probe:
            while True:
                blocked: object = await probe.scalar(
                    text("SELECT cardinality(pg_blocking_pids(:pid))"),
                    {"pid": backend_pid},
                )
                if isinstance(blocked, int) and blocked > 0:
                    break
                assert not pending.done(), "Revocation bypassed the active key lock"
        permit_read.set()
    assert admin_result(read.result(), AdminAccountLookup).id == target.account.id
    problem(
        await stand.client.get(JOURNAL, headers=headers), 401, ErrorCode.UNAUTHORIZED
    )
    _, fresh = await admin_access(stand)
    recorded = admin_result(
        await stand.client.get(JOURNAL, headers=fresh), AdminJournalList
    )
    assert [entry.action for entry in recorded.items] == [AdminAction.LOOKUP_ACCOUNT]


# spec:test admin-content-and-access#find-account-email-request-show
# spec:test admin-content-and-access#grant-subscription-account-until-date
# spec:test admin-content-and-access#record-granted-subscription-account-end
# spec:test admin-content-and-access#replace-end-date-newly-named
# spec:test admin-content-and-access#notify-account-automatically-after-grant
# spec:test admin-content-and-access#end-granted-subscription-after-end
# spec:test admin-content-and-access#change-clients-meetings-hours-amounts
# spec:test in-app-notice-bar#produce-bar-access-granted-profile-tab
async def test_grant_uses_owner_plan_lock_journals_and_profile_notification(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stand = account_stand
    owner = await stand.add_account("admin_grant_subject")
    await stand.activate(owner)
    client, user = stand.client, bearer(owner)
    _, admin = await admin_access(stand, "Test owner")
    clock = datetime(2025, 12, 30, 15, tzinfo=UTC)
    monkeypatch.setattr(account_access, "datetime", FrozenTime(clock))
    cards = [
        await create_card(stand, owner, {"name": f"Cap card {index}", "rate": "55"})
        for index in range(FREE_PLAN_LIMIT)
    ]
    completed = await post_meeting(
        stand,
        owner,
        client_form(
            cards[0].id,
            datetime(2025, 12, 12, 9, tzinfo=UTC),
            outcome={"status": "completed", "actual_duration_minutes": 45},
        ),
    )
    await add_payment(stand, owner, cards[0].id, "200", "2025-12-12")
    meeting_before = meeting_from(
        await client.get(f"{MEETINGS}/{completed.id}", headers=user)
    )
    records_before = await records_summary(stand, owner)
    before = await client.get(
        LOOKUP, headers=admin, params={"email": owner.account.email.upper()}
    )
    summary = admin_result(before, AdminAccountLookup)
    assert (
        summary.plan.kind == PlanKind.FREE
        and summary.plan.active_clients == FREE_PLAN_LIMIT
    )
    assert set(summary.model_dump()) == {
        "id",
        "email",
        "created_at",
        "activated",
        "plan",
    }
    problem(
        await client.get(LOOKUP, headers=user, params={"email": owner.account.email}),
        401,
        ErrorCode.UNAUTHORIZED,
    )
    problem(
        await client.get(
            LOOKUP, headers=admin, params={"email": "missing@example.com"}
        ),
        404,
        ErrorCode.NOT_FOUND,
    )
    action = f"{ADMIN}/accounts/{owner.account.id}/subscription"
    validation_problem(
        await client.put(action, headers=admin, json={"until": "2025-12-30"}),
        "body",
        "value_error",
    )
    assert await notices_for(stand, owner) == []
    first = admin_result(
        await client.put(action, headers=admin, json={"until": "2025-12-31"}),
        AdminGrantedSubscription,
    )
    assert first.account_id == owner.account.id and first.granted_by == "Test owner"
    assert first.source == "admin" and first.until == date(2025, 12, 31)
    assert first.granted_at.tzinfo is not None
    extra = await create_card(stand, owner, {"name": "Fourth client"})
    assert extra.archived_at is None
    renewal = admin_result(
        await client.put(action, headers=admin, json={"until": "2026-01-02"}),
        AdminGrantedSubscription,
    )
    assert renewal.until == date(2026, 1, 2) and renewal.granted_at >= first.granted_at
    notices = await notices_for(stand, owner)
    assert [(notice.key, notice.tab, notice.params) for notice in notices] == [
        (NoticeKey.ACCESS_GRANTED, NoticeTab.PROFILE, {"date": "2026-01-02"}),
        (NoticeKey.ACCESS_GRANTED, NoticeTab.PROFILE, {"date": "2025-12-31"}),
    ]
    profile = admin_result(await client.get(ACCOUNT, headers=user), AccountView).leader
    assert profile is not None and profile.plan.subscription_until == renewal.until
    monkeypatch.setattr(
        account_access, "datetime", FrozenTime(clock + timedelta(days=4))
    )
    expired = admin_result(await client.get(ACCOUNT, headers=user), AccountView).leader
    assert expired is not None and expired.plan.kind == PlanKind.FREE
    assert expired.plan.active_clients == FREE_PLAN_LIMIT + 1
    problem(
        await client.post(CLIENTS, headers=user, json={"name": "Still at cap"}),
        409,
        ErrorCode.CLIENT_LIMIT_REACHED,
    )
    assert await records_summary(stand, owner) == records_before
    assert (
        meeting_from(await client.get(f"{MEETINGS}/{completed.id}", headers=user))
        == meeting_before
    )
    assert mail_outbox == []
    entries = admin_result(
        await client.get(JOURNAL, headers=admin), AdminJournalList
    ).items
    grants = [
        entry for entry in entries if entry.action == AdminAction.GRANT_SUBSCRIPTION
    ]
    assert [(entry.before, entry.after) for entry in grants] == [
        (first.model_dump(mode="json"), renewal.model_dump(mode="json")),
        (None, first.model_dump(mode="json")),
    ]


# spec:test admin-feedback-stats#show-period-administrator-names-feedback
# spec:test admin-feedback-stats#show-account-email-feedback-author
# spec:test admin-feedback-stats#treat-feedback-message-not-marked
# spec:test admin-feedback-stats#mark-feedback-messages-administrator
# spec:test admin-ai-assistant#record-action-read-change-alike
async def test_feedback_batch_is_all_or_nothing_and_journal_never_copies_messages(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    author = await stand.add_account("feedback_author")
    client, user = stand.client, bearer(author)
    _, admin = await admin_access(stand)
    for index in range(11):
        sent = await client.post(
            FEEDBACK,
            headers=user,
            json={"text": f"Synthetic feedback {index}", "screen": "profile"},
        )
        assert sent.status_code == 204
        if index == 0:
            await stand.activate(author)
    listing = await client.get(ADMIN_FEEDBACK, headers=admin, params={"new_only": True})
    new = admin_result(listing, AdminFeedbackList)
    assert len(new.items) == 11
    assert all(row.activated and not row.processed for row in new.items[:-1])
    assert not new.items[-1].activated and author.account.email not in listing.text
    assert all("email" not in item.model_fields_set for item in new.items)
    day = new.items[0].created_at.date().isoformat()
    addressed = admin_result(
        await client.get(
            ADMIN_FEEDBACK,
            headers=admin,
            params={"from": day, "to": day, "include_email": True},
        ),
        AdminFeedbackList,
    )
    assert addressed.items and all(
        item.email == author.account.email for item in addressed.items
    )
    none = admin_result(
        await client.get(ADMIN_FEEDBACK, headers=admin, params={"to": "2020-12-31"}),
        AdminFeedbackList,
    )
    assert none.items == []
    validation_problem(
        await client.get(
            ADMIN_FEEDBACK,
            headers=admin,
            params={"from": "2025-03-02", "to": "2025-03-01"},
        ),
        "query",
        "value_error",
    )
    marked = f"{ADMIN_FEEDBACK}/mark-processed"
    ids = [str(item.id) for item in new.items]
    missing = str(uuid7())
    failed = problem(
        await client.post(marked, headers=admin, json={"ids": [*ids, missing]}),
        404,
        ErrorCode.NOT_FOUND,
    )
    assert failed.details == {"unknown_ids": [missing]}
    assert (
        admin_result(
            await client.get(ADMIN_FEEDBACK, headers=admin, params={"new_only": True}),
            AdminFeedbackList,
        )
        == new
    )
    validation_problem(
        await client.post(marked, headers=admin, json={"ids": [ids[0], ids[0]]}),
        "body",
        "value_error",
    )
    processed = admin_result(
        await client.post(marked, headers=admin, json={"ids": ids}), AdminFeedbackList
    )
    assert [str(item.id) for item in processed.items] == ids
    assert all(item.processed and item.email is None for item in processed.items)
    assert (
        admin_result(
            await client.get(ADMIN_FEEDBACK, headers=admin, params={"new_only": True}),
            AdminFeedbackList,
        ).items
        == []
    )
    journal_response = await client.get(JOURNAL, headers=admin)
    journal = admin_result(journal_response, AdminJournalList)
    changes = [
        entry
        for entry in journal.items
        if entry.action == AdminAction.MARK_FEEDBACK_PROCESSED
    ]
    assert {entry.object_id for entry in changes} == set(ids)
    assert all(
        entry.before == {"processed": False} and entry.after == {"processed": True}
        for entry in changes
    )
    assert (
        author.account.email not in journal_response.text
        and "Synthetic feedback" not in journal_response.text
    )
    after = admin_result(await client.get(JOURNAL, headers=admin), AdminJournalList)
    assert after.items[0].action == AdminAction.LIST_JOURNAL
