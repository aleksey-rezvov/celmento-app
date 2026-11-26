from asyncio import Barrier, gather, timeout
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage

import pytest
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from test_account import ACCOUNT, ACTIVATION, ORIGIN, AccountStand, account_stand
from test_auth_registration import ACTIVATION as ACTIVATION_DOCUMENTS
from test_auth_registration import AuthStand, auth_stand
from test_clients_api import CLIENTS, bearer, card_from, create_card, problem
from test_meeting_notifications import mail_outbox, notices_for
from test_meetings_api import MEETINGS, meeting_from, post_meeting
from test_meetings_ledger import client_form
from test_public_bookings import (
    BOOKING_NOW,
    BOOKINGS,
    FrozenTime,
    booking_form,
    freeze_booking_time,
)
from test_records_api import add_payment, records_summary
from test_specialists_api import archive_card, link_card, validation_problem

from celmento_api.models.account import Account
from celmento_api.models.enums import (
    Contour,
    Currency,
    ErrorCode,
    NoticeKey,
    PriceLevel,
    SubscriptionRequestSource,
    SubscriptionTerm,
)
from celmento_api.models.plan import StatsEvent, StatsEventKind
from celmento_api.models.plan import SubscriptionRequest as SubscriptionRequestRecord
from celmento_api.models.subscription import Subscription
from celmento_api.routers import plans as plans_router
from celmento_api.schemas.account import Account as AccountView
from celmento_api.schemas.account import PlanKind, PlanStatus
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.money import Money
from celmento_api.schemas.plans import (
    PlansOverview,
    SubscriptionRequest,
    SubscriptionRequestCreate,
)
from celmento_api.services import account_access
from celmento_api.services.limit import FREE_PLAN_LIMIT
from celmento_api.services.sessions import issue_session

__all__: list[str] = ["account_stand", "auth_stand", "mail_outbox"]

PLANS: str = "/api/v1/plans"
LIMIT_HITS: str = f"{PLANS}/limit-hits"
REQUESTS: str = "/api/v1/subscription-requests"


def _plans(response: Response) -> PlansOverview:
    assert response.status_code == 200, response.text
    return PlansOverview.model_validate_json(response.content)


def _plan(response: Response) -> PlanStatus:
    assert response.status_code == 200, response.text
    return PlanStatus.model_validate_json(response.content)


def _request(response: Response) -> SubscriptionRequest:
    assert response.status_code == 201, response.text
    return SubscriptionRequest.model_validate_json(response.content)


async def _events(stand: AccountStand) -> list[StatsEvent]:
    async with stand.session() as session:
        return list(
            await session.scalars(
                select(StatsEvent).order_by(StatsEvent.stats_event_id)
            )
        )


# spec:test subscription-plans-request#price-subscription-base-level-790-month
# spec:test subscription-plans-request#choose-price-currency-account-contour
# spec:test subscription-plans-request#show-prices-dollars-currency-other
# spec:test subscription-plans-request#tie-subscription-currency-device-country
async def test_plans_use_contour_currency_and_count_only_successful_screen_reads(
    account_stand: AccountStand,
) -> None:
    stand = account_stand
    lead = await stand.add_account("plans_price_account")
    client, headers = stand.client, bearer(lead)
    body = {"term": "month", "source": "profile"}
    for auth, status, code in (
        ({}, 401, ErrorCode.UNAUTHORIZED),
        (headers, 403, ErrorCode.ACTIVATION_REQUIRED),
    ):
        problem(await client.get(PLANS, headers=auth), status, code)
        problem(await client.post(LIMIT_HITS, headers=auth), status, code)
        problem(await client.post(REQUESTS, headers=auth, json=body), status, code)
    assert await _events(stand) == []
    await stand.activate(lead)
    updated = await client.patch(
        ACCOUNT,
        headers=headers,
        json={
            "language": "ru",
            "time_zone": "Asia/Tokyo",
            "leader": {"default_currency": "USD"},
        },
    )
    assert updated.status_code == 200, updated.text
    plan_before = _plan(await client.post(LIMIT_HITS, headers=headers))
    assert (
        plan_before.kind == PlanKind.FREE
        and plan_before.client_limit == FREE_PLAN_LIMIT
    )
    assert await _events(stand) == []
    request = await client.get(PLANS, headers={**headers, "Accept-Language": "ja"})
    first = _plans(request)
    assert request.headers["Cache-Control"] == "no-store"
    assert first.plan == plan_before and first.plan.active_clients == 0
    assert first.request is None and first.prices.level == PriceLevel.BASE
    currency, month, year = (
        (Currency.RUB, "790", "6300")
        if stand.settings.contour == Contour.RU
        else (Currency.EUR, "8.90", "71")
    )
    assert [(row.term, row.price) for row in first.prices.items] == [
        (SubscriptionTerm.MONTH, Money(amount=month, currency=currency)),
        (SubscriptionTerm.YEAR, Money(amount=year, currency=currency)),
    ]
    assert _plans(await client.get(PLANS, headers=headers)) == first
    assert (await client.get(ACCOUNT, headers=headers)).status_code == 200
    assert (await client.get(CLIENTS, headers=headers)).status_code == 200
    events = await _events(stand)
    assert len(events) == 2
    assert {row.kind for row in events} == {StatsEventKind.PLANS_OPENED.value}
    assert all(
        row.account_id == lead.account.id and row.stats_event_id.version == 7
        for row in events
    )


# spec:test subscription-plans-request#store-request-account-contour-account
# spec:test subscription-plans-request#take-payment-show-payment-form
# spec:test subscription-plans-request#replace-want-request-sent-showing
async def test_concurrent_subscription_request_keeps_one_owner_receipt_without_granting_access(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stand = account_stand
    lead = await stand.add_account("plans_request_account")
    other = await stand.add_account("plans_other_account")
    await stand.activate(lead)
    await stand.activate(other)
    another = await stand.another_session(lead.account.id)
    client, headers = stand.client, bearer(lead)
    before = await client.get(ACCOUNT, headers=headers)
    assert before.status_code == 200
    payloads = (
        {"term": "month", "source": "limit_screen"},
        {"term": "year", "source": "profile"},
    )
    validation_problem(
        await client.post(
            REQUESTS, headers=headers, json={**payloads[0], "currency": "USD"}
        ),
        "body",
        "extra_forbidden",
    )
    rendezvous = Barrier(2)
    create_request = plans_router.create_request

    async def submit_together(
        session: AsyncSession, leader: Account, body: SubscriptionRequestCreate
    ) -> SubscriptionRequest:
        await rendezvous.wait()
        return await create_request(session, leader, body)

    with monkeypatch.context() as patch:
        patch.setattr(plans_router, "create_request", submit_together)
        async with timeout(10):
            responses = await gather(
                *(
                    client.post(REQUESTS, headers=bearer(actor), json=payload)
                    for actor, payload in zip((lead, another), payloads, strict=True)
                )
            )
    assert sorted(item.status_code for item in responses) == [201, 409]
    winner = next(
        index for index, response in enumerate(responses) if response.status_code == 201
    )
    saved = _request(responses[winner])
    assert saved.term == SubscriptionTerm(payloads[winner]["term"])
    assert saved.source == SubscriptionRequestSource(payloads[winner]["source"])
    assert saved.level == PriceLevel.BASE and saved.created_at.tzinfo is not None
    expected_currency = (
        Currency.RUB if stand.settings.contour == Contour.RU else Currency.EUR
    )
    assert saved.currency == expected_currency
    for failed in (
        responses[1 - winner],
        await client.post(REQUESTS, headers=headers, json=payloads[1 - winner]),
    ):
        conflict = problem(failed, 409, ErrorCode.SUBSCRIPTION_REQUEST_EXISTS)
        assert conflict.details is not None
        assert SubscriptionRequest.model_validate(conflict.details["request"]) == saved
    after = await client.get(ACCOUNT, headers=bearer((lead, another)[1 - winner]))
    assert after.status_code == 200
    original = AccountView.model_validate_json(before.content)
    assert (
        original.leader is not None
        and original.leader.subscription_requested_at is None
    )
    expected_profile = original.leader.model_copy(
        update={"subscription_requested_at": saved.created_at}
    )
    assert AccountView.model_validate_json(after.content) == original.model_copy(
        update={"leader": expected_profile}
    )
    assert mail_outbox == [] and await _events(stand) == []
    refreshed = _plans(await client.get(PLANS, headers=headers))
    assert refreshed.request == saved and refreshed.plan.kind == PlanKind.FREE
    assert _plans(await client.get(PLANS, headers=bearer(other))).request is None
    async with stand.session() as session:
        records = list(await session.scalars(select(SubscriptionRequestRecord)))
        assert len(records) == 1 and records[0].account_id == lead.account.id
        assert records[0].subscription_request_id.version == 7
        assert records[0].created_at == saved.created_at
        assert not await session.scalar(select(func.count()).select_from(Subscription))


async def _contour_leader(stand: AuthStand, contour: Contour) -> SignInSession:
    stand.switch(contour)
    email = "separate-plans@example.com"
    await stand.add_account(email, "separate_plans")
    async with stand.session() as session:
        account = await session.scalar(select(Account).where(Account.email == email))
        assert account is not None
        signed_in = await issue_session(session, account, ORIGIN)
        await session.commit()
    activated = await stand.client.post(
        ACTIVATION,
        headers=bearer(signed_in),
        json={
            "age_confirmed": True,
            "acceptances": await stand.consents(ACTIVATION_DOCUMENTS),
        },
    )
    assert activated.status_code == 200, activated.text
    return signed_in


# spec:test subscription-plans-request#extend-request-subscription-account
async def test_same_email_plans_and_requests_are_independent_between_contours(
    auth_stand: AuthStand,
) -> None:
    stand = auth_stand
    ru = await _contour_leader(stand, Contour.RU)
    world = await _contour_leader(stand, Contour.WORLD)
    assert ru.account.email == world.account.email and ru.account.id != world.account.id
    stand.switch(Contour.RU)
    client = stand.client
    ru_request = _request(
        await client.post(
            REQUESTS,
            headers=bearer(ru),
            json={"term": "month", "source": "profile"},
        )
    )
    assert ru_request.currency == Currency.RUB
    until = date(2099, 1, 1)
    async with stand.session() as session:
        session.add(
            Subscription(
                account_id=ru.account.id, until=until, granted_by="test administrator"
            )
        )
        await session.commit()
    assert (
        _plans(await client.get(PLANS, headers=bearer(ru))).plan.subscription_until
        == until
    )
    stand.switch(Contour.WORLD)
    problem(await client.get(PLANS, headers=bearer(ru)), 401, ErrorCode.UNAUTHORIZED)
    world_initial = _plans(await client.get(PLANS, headers=bearer(world)))
    assert world_initial.request is None and world_initial.plan.kind == PlanKind.FREE
    world_account = await client.get(ACCOUNT, headers=bearer(world))
    assert world_account.status_code == 200
    world_profile = AccountView.model_validate_json(world_account.content).leader
    assert world_profile is not None and world_profile.subscription_requested_at is None
    world_request = _request(
        await client.post(
            REQUESTS,
            headers=bearer(world),
            json={"term": "year", "source": "limit_screen"},
        )
    )
    assert (
        world_request.currency == Currency.EUR
        and world_request.term == SubscriptionTerm.YEAR
    )
    assert (
        _plans(await client.get(PLANS, headers=bearer(world))).request == world_request
    )
    stand.switch(Contour.RU)
    ru_view = _plans(await client.get(PLANS, headers=bearer(ru)))
    assert ru_view.request == ru_request and ru_view.plan.subscription_until == until
    ru_account = await client.get(ACCOUNT, headers=bearer(ru))
    assert ru_account.status_code == 200
    ru_profile = AccountView.model_validate_json(ru_account.content).leader
    assert ru_profile is not None
    assert ru_profile.subscription_requested_at == ru_request.created_at


# spec:test free-plan-client-limit#allow-client-card-become-active
# spec:test free-plan-client-limit#make-creating-restoring-new-client
# spec:test free-plan-client-limit#check-limit-before-action-make
# spec:test free-plan-client-limit#count-restrict-relations-account
async def test_limit_screen_rechecks_cap_and_only_counts_confirmed_leader_openings(
    account_stand: AccountStand,
    mail_outbox: list[EmailMessage],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stand = account_stand
    lead = await stand.add_account("cap_owner_account")
    attendee = await stand.add_account("cap_linked_attendee")
    other = await stand.add_account("cap_other_specialist")
    for actor in (lead, other):
        await stand.activate(actor)
    client, headers = stand.client, bearer(lead)
    peer = await create_card(stand, other, {"name": "Owner is an attendee here"})
    await link_card(stand, other, peer.id, lead)
    assert _plan(await client.post(LIMIT_HITS, headers=headers)).active_clients == 0
    assert await _events(stand) == []
    first = await create_card(stand, lead, {"name": "First linked client"})
    await link_card(stand, lead, first.id, attendee)
    for index in range(FREE_PLAN_LIMIT - 1):
        await create_card(stand, lead, {"name": f"Standalone {index}"})
    cap = _plan(await client.post(LIMIT_HITS, headers=headers))
    assert cap.active_clients == cap.client_limit == FREE_PLAN_LIMIT
    assert [row.kind for row in await _events(stand)] == [
        StatsEventKind.LIMIT_HIT.value
    ]
    problem(
        await client.post(CLIENTS, headers=headers, json={"name": "Would exceed cap"}),
        409,
        ErrorCode.CLIENT_LIMIT_REACHED,
    )
    await archive_card(stand, lead, first.id)
    current = _plan(await client.post(LIMIT_HITS, headers=headers))
    assert current.active_clients == FREE_PLAN_LIMIT - 1
    replacement = await create_card(stand, lead, {"name": "Replacement"})
    await link_card(stand, lead, replacement.id, other)
    restore = f"{CLIENTS}/{first.id}/restore"
    problem(
        await client.post(restore, headers=headers), 409, ErrorCode.CLIENT_LIMIT_REACHED
    )

    freeze_booking_time(monkeypatch)
    body = await booking_form(
        stand,
        lead,
        BOOKING_NOW + timedelta(hours=3),
        email="first-time-guest@example.com",
    )
    problem(await client.post(BOOKINGS, json=body), 409, ErrorCode.BOOKING_UNAVAILABLE)
    assert NoticeKey.LIMIT_NEW_CLIENT in {
        notice.key for notice in await notices_for(stand, lead)
    }
    assert mail_outbox == []
    assert [row.kind for row in await _events(stand)] == [
        StatsEventKind.LIMIT_HIT.value
    ]
    assert _plan(await client.post(LIMIT_HITS, headers=headers)) == cap
    await archive_card(stand, lead, replacement.id)
    restored = card_from(await client.post(restore, headers=headers))
    assert restored.id == first.id and restored.linked and restored.archived_at is None
    view = _plans(await client.get(PLANS, headers=headers))
    assert view.plan == cap
    events = await _events(stand)
    assert Counter(row.kind for row in events) == {
        StatsEventKind.LIMIT_HIT.value: 2,
        StatsEventKind.PLANS_OPENED.value: 1,
    }
    assert {row.account_id for row in events} == {lead.account.id}


# spec:test free-plan-client-limit#lift-limit-entirely-account-active
# spec:test free-plan-client-limit#apply-free-plan-limit-after
# spec:test free-plan-client-limit#archive-delete-change-client-card
# spec:test subscription-plans-request#treat-subscription-granted-administrator
# spec:test subscription-plans-request#return-plan-section-plan-free-current
async def test_granted_plan_includes_end_date_and_expiry_preserves_cards_and_records(
    account_stand: AccountStand,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stand = account_stand
    lead = await stand.add_account("plans_expiry_account")
    await stand.activate(lead)
    client, headers = stand.client, bearer(lead)
    until = date(2025, 12, 31)
    instant = datetime(2025, 12, 31, 22, 30, tzinfo=UTC)
    monkeypatch.setattr(account_access, "datetime", FrozenTime(instant))
    async with stand.session() as session:
        session.add(
            Subscription(
                account_id=lead.account.id, until=until, granted_by="test administrator"
            )
        )
        await session.commit()
    cards = [
        await create_card(
            stand, lead, {"name": f"Subscription card {index}", "rate": "100.25"}
        )
        for index in range(FREE_PLAN_LIMIT + 1)
    ]
    meeting = await post_meeting(
        stand,
        lead,
        client_form(
            cards[0].id,
            datetime(2025, 12, 1, 9, tzinfo=UTC),
            outcome={"status": "completed", "actual_duration_minutes": 55},
        ),
    )
    await add_payment(stand, lead, cards[0].id, "150", "2025-12-01")
    records = await records_summary(stand, lead)
    active = _plan(await client.post(LIMIT_HITS, headers=headers))
    assert active.kind == PlanKind.SUBSCRIPTION and active.subscription_until == until
    assert active.client_limit is None and active.active_clients == FREE_PLAN_LIMIT + 1
    assert await _events(stand) == []
    visible = _plans(await client.get(PLANS, headers=headers))
    assert visible.plan == active and visible.request is None

    monkeypatch.setattr(
        account_access, "datetime", FrozenTime(instant + timedelta(hours=2))
    )
    expired = _plan(await client.post(LIMIT_HITS, headers=headers))
    assert expired.kind == PlanKind.FREE and expired.subscription_until is None
    assert expired.client_limit == FREE_PLAN_LIMIT and expired.active_clients == len(
        cards
    )
    profile = await client.get(ACCOUNT, headers=headers)
    assert profile.status_code == 200
    leader_view = AccountView.model_validate_json(profile.content).leader
    assert leader_view is not None and leader_view.plan == expired
    problem(
        await client.post(CLIENTS, headers=headers, json={"name": "Still blocked"}),
        409,
        ErrorCode.CLIENT_LIMIT_REACHED,
    )
    events = await _events(stand)
    assert [item.kind for item in events] == [
        StatsEventKind.PLANS_OPENED.value,
        StatsEventKind.LIMIT_HIT.value,
    ]
    assert (
        meeting_from(
            await client.get(f"{MEETINGS}/{meeting.id}", headers=headers)
        ).actual_duration_minutes
        == 55
    )
    assert await records_summary(stand, lead) == records
    for card in cards:
        stored = card_from(await client.get(f"{CLIENTS}/{card.id}", headers=headers))
        assert (
            stored.name == card.name
            and stored.rate == card.rate
            and stored.archived_at is None
        )
    async with stand.session() as session:
        grant = await session.get(Subscription, lead.account.id)
        assert grant is not None and grant.until == until
