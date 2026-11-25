from asyncio import Barrier, gather, timeout
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid7

import pytest
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from test_account import ORIGIN, PNG, WEBP, AccountStand, account_stand

from celmento_api import storage
from celmento_api.errors import Error
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard as ClientRecord
from celmento_api.models.client_request_receipt import ClientRequestReceipt
from celmento_api.models.enums import (
    ClientCardStatus,
    ClientLinkMethod,
    ClientLinkStatus,
    ClientSource,
    Currency,
    ErrorCode,
    NoticeKey,
    NoticeTab,
    PaymentType,
)
from celmento_api.models.subscription import Subscription
from celmento_api.schemas.account import PlanKind
from celmento_api.schemas.auth import SignInSession
from celmento_api.schemas.clients import ClientCard, ClientList
from celmento_api.schemas.notices import NoticeList
from celmento_api.services import links
from celmento_api.services.account_access import account_date

__all__: list[str] = [
    "CLIENTS",
    "account_stand",
    "bearer",
    "card_from",
    "create_card",
    "list_from",
    "problem",
]

CLIENTS: str = "/api/v1/clients"


def bearer(signed_in: SignInSession) -> dict[str, str]:
    return {"Authorization": f"Bearer {signed_in.token}"}


def problem(response: Response, status: int, code: ErrorCode) -> Error:
    assert response.status_code == status, response.text
    parsed = Error.model_validate_json(response.content)
    assert parsed.code == code
    return parsed


def card_from(response: Response, status: int = 200) -> ClientCard:
    assert response.status_code == status, response.text
    return ClientCard.model_validate_json(response.content)


def list_from(response: Response) -> ClientList:
    assert response.status_code == 200, response.text
    return ClientList.model_validate_json(response.content)


async def create_card(
    stand: AccountStand, leader: SignInSession, data: Mapping[str, object]
) -> ClientCard:
    return card_from(
        await stand.client.post(CLIENTS, json=dict(data), headers=bearer(leader)), 201
    )


# spec:test client-card-create#accept-reference-contact-entered-without-format
# spec:test client-card-create#allow-card-name-reference-contacts
# spec:test client-card-create#create-card-save-standalone-card
# spec:test client-card-create#mark-manually-created-card-new-badge
# spec:test client-card-view-edit#accept-reference-contact-screen-6-2
# spec:test client-rate-currency#copy-rate-currency-leader-profile
# spec:test client-rate-currency#keep-card-rate-currency-unchanged
# spec:test client-rate-currency#store-card-payment-type-paid
# spec:test client-rate-currency#make-paid-unavailable-rate-0-require
# spec:test client-list#filter-clients-section-name-reference
# spec:test client-list#match-search-against-self-given-email
# spec:test client-list#order-rows-client-name-default
async def test_card_creation_search_and_private_patch(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("card_owner")
    attendee = await account_stand.add_account("card_attendee")
    stranger = await account_stand.add_account("card_stranger")
    await account_stand.activate(leader)
    await account_stand.activate(stranger)
    headers = bearer(leader)
    problem(await client.get(CLIENTS), 401, ErrorCode.UNAUTHORIZED)
    problem(
        await client.post(
            CLIENTS, json={"name": "No activation"}, headers=bearer(attendee)
        ),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )
    assert (
        await client.patch(
            "/api/v1/account",
            json={"leader": {"default_rate": "1200.25", "default_currency": "EUR"}},
            headers=headers,
        )
    ).status_code == 200

    input_contact = " Odd_% invalid @ "
    first = await create_card(
        account_stand,
        leader,
        {"name": "zeta", "email": input_contact, "phone": " Phone A "},
    )
    assert first.id.version == 7 and first.source == ClientSource.CREATED
    assert first.email == input_contact and first.phone == " Phone A "
    assert first.self_given_email is None and not first.is_new and not first.linked
    assert first.rate == "1200.25" and first.currency == Currency.EUR
    assert first.payment_type == PaymentType.PAID
    assert first.created_at.tzinfo is not None
    repeated_name = await create_card(
        account_stand, leader, {"name": "zeta", "email": input_contact}
    )
    assert repeated_name.id != first.id and repeated_name.email == input_contact

    path = f"{CLIENTS}/{first.id}"
    problem(await client.get(path, headers=bearer(stranger)), 404, ErrorCode.NOT_FOUND)
    problem(
        await client.get(path, headers=bearer(attendee)),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )
    assert (await client.get(f"{CLIENTS}/bad-uuid", headers=headers)).status_code == 422
    for invalid in (
        {"name": "  "},
        {"preferred_channel": "whatsapp"},
        {"self_given_email": "forged@example.com"},
        {"linked_account_id": str(attendee.account.id)},
        {"status": "archived"},
        {"rate": "-0.01"},
        {"rate": "1000000000000000"},
        {"rate": "1.234"},
    ):
        assert (
            await client.patch(path, json=invalid, headers=headers)
        ).status_code == 422
    problem(
        await client.post(CLIENTS, json={"name": "Zero", "rate": "0"}, headers=headers),
        400,
        ErrorCode.PAYMENT_TYPE_REQUIRED,
    )

    updated = card_from(
        await client.patch(
            path,
            json={
                "name": "alpha",
                "phone": None,
                "preferred_channel": "other",
                "other_contact": " Informal referral ",
                "request": "Private request",
                "goals": "Private goals",
                "info": "Private info",
                "hypotheses": "Private observations",
            },
            headers=headers,
        )
    )
    assert updated.name == "alpha" and updated.phone is None
    assert (
        updated.preferred_channel == "other"
        and updated.other_contact == " Informal referral "
    )
    assert updated.request == "Private request" and updated.goals == "Private goals"
    assert (
        updated.info == "Private info" and updated.hypotheses == "Private observations"
    )
    assert updated.email == input_contact and updated.self_given_email is None
    assert (
        await client.patch(path, json={"other_contact": None}, headers=headers)
    ).status_code == 422

    assert (
        await client.patch(
            "/api/v1/account",
            json={"leader": {"default_rate": None, "default_currency": "USD"}},
            headers=headers,
        )
    ).status_code == 200
    persisted = card_from(await client.get(path, headers=headers))
    assert persisted == updated
    assert persisted.rate == "1200.25" and persisted.currency == Currency.EUR
    short_created = await create_card(account_stand, leader, {"name": "Zeta new"})
    assert short_created.rate is None and short_created.currency == Currency.USD
    assert short_created.payment_type == PaymentType.PRO_BONO

    async with account_stand.session() as session:
        archived = ClientRecord(
            leader_account_id=leader.account.id,
            name="Aardvark",
            email=" Archived_%",
            self_given_email="only-booking@example.com",
            currency=Currency.EUR.value,
            payment_type=PaymentType.PRO_BONO.value,
            status=ClientCardStatus.ARCHIVED.value,
            archived_at=datetime.now(UTC),
            source=ClientSource.BOOKED_VIA_LINK.value,
            is_new=True,
        )
        session.add(archived)
        await session.commit()
        archived_id = archived.client_card_id

    matches = list_from(await client.get(CLIENTS, params={"q": "_%"}, headers=headers))
    assert [item.id for item in matches.items] == [
        first.id,
        repeated_name.id,
        archived_id,
    ]
    hidden = list_from(
        await client.get(
            CLIENTS, params={"q": "only-booking@example.com"}, headers=headers
        )
    )
    assert hidden.items == []
    active = list_from(
        await client.get(
            CLIENTS, params={"status": "active", "q": "oDd_%"}, headers=headers
        )
    )
    assert [item.id for item in active.items] == [first.id, repeated_name.id]
    assert active.plan.active_clients == 3
    archived_path = f"{CLIENTS}/{archived_id}"
    archived_card = card_from(await client.get(archived_path, headers=headers))
    assert archived_card.is_new and archived_card.archived_at is not None
    assert not card_from(await client.get(archived_path, headers=headers)).is_new
    problem(
        await client.patch(archived_path, json={"name": "A new name"}, headers=headers),
        409,
        ErrorCode.CLIENT_ARCHIVED,
    )


# spec:test free-plan-client-limit#count-limit-active-client-card
# spec:test free-plan-client-limit#count-archived-cards-limit
# spec:test free-plan-client-limit#lift-limit-entirely-account-active
async def test_concurrent_card_limit_and_idempotent_replay(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("limit_owner")
    other_leader = await account_stand.add_account("limit_other")
    await account_stand.activate(leader)
    await account_stand.activate(other_leader)
    headers = bearer(leader)
    key = str(uuid7())
    keyed = {**headers, "Idempotency-Key": key}
    body = {"name": "First card", "rate": None}
    async with timeout(10):
        replayed = await gather(
            client.post(CLIENTS, json=body, headers=keyed),
            client.post(
                CLIENTS, json={"rate": None, "name": "First card"}, headers=keyed
            ),
        )
    first, replay = (card_from(response, 201) for response in replayed)
    assert replay.id == first.id and first.payment_type == PaymentType.PAID

    second = await create_card(account_stand, leader, {"name": "Second card"})
    link = card_from(
        await client.put(
            f"{CLIENTS}/{second.id}/link",
            json={"login": other_leader.account.login},
            headers=headers,
        )
    )
    assert link.linked
    other = card_from(
        await client.post(
            CLIENTS,
            json={"name": "Independent owner"},
            headers={**bearer(other_leader), "Idempotency-Key": key},
        ),
        201,
    )
    assert other.id != first.id

    async with timeout(10):
        contended = await gather(
            client.post(CLIENTS, json={"name": "Available slot A"}, headers=headers),
            client.post(CLIENTS, json={"name": "Available slot B"}, headers=headers),
        )
    assert sorted(response.status_code for response in contended) == [201, 409]
    problem(
        next(response for response in contended if response.status_code == 409),
        409,
        ErrorCode.CLIENT_LIMIT_REACHED,
    )
    plan = list_from(await client.get(CLIENTS, headers=headers)).plan
    assert (
        plan.kind == PlanKind.FREE
        and plan.active_clients == 3
        and plan.client_limit == 3
    )
    other_plan = list_from(await client.get(CLIENTS, headers=bearer(other_leader))).plan
    assert other_plan.active_clients == 1
    again = card_from(await client.post(CLIENTS, json=body, headers=keyed), 201)
    assert again.id == first.id
    problem(
        await client.post(CLIENTS, json={"name": "Changed input"}, headers=keyed),
        409,
        ErrorCode.CONFLICT,
    )
    assert (
        await client.post(
            CLIENTS, json=body, headers={**headers, "Idempotency-Key": "bad"}
        )
    ).status_code == 422

    async with account_stand.session() as session:
        account = await session.get(Account, leader.account.id)
        assert account is not None
        today = account_date(account)
        session.add(
            Subscription(account_id=account.account_id, until=today, granted_by="test")
        )
        await session.commit()
    fourth = await create_card(account_stand, leader, {"name": "Paid access"})
    plan = list_from(await client.get(CLIENTS, headers=headers)).plan
    assert plan.kind == PlanKind.SUBSCRIPTION and plan.subscription_until == today
    assert plan.active_clients == 4 and plan.client_limit is None

    async with account_stand.session() as session:
        subscription = await session.get(Subscription, leader.account.id)
        assert subscription is not None
        subscription.until = today - timedelta(days=1)
        await session.commit()
    problem(
        await client.post(CLIENTS, json={"name": "Expired access"}, headers=headers),
        409,
        ErrorCode.CLIENT_LIMIT_REACHED,
    )
    expired = list_from(await client.get(CLIENTS, headers=headers)).plan
    assert expired.kind == PlanKind.FREE and expired.active_clients == 4
    assert (
        card_from(await client.get(f"{CLIENTS}/{fourth.id}", headers=headers)).status
        == ClientCardStatus.ACTIVE
    )

    async with account_stand.session() as session:
        for card in (first, fourth):
            row = await session.get(ClientRecord, card.id)
            assert row is not None
            row.status = ClientCardStatus.ARCHIVED.value
            row.archived_at = datetime.now(UTC)
        assert (
            await session.scalar(select(func.count()).select_from(ClientRequestReceipt))
            == 2
        )
        await session.commit()
    replay_archived = card_from(
        await client.post(CLIENTS, json=body, headers=keyed), 201
    )
    assert (
        replay_archived.id == first.id
        and replay_archived.status == ClientCardStatus.ARCHIVED
    )
    assert (
        list_from(await client.get(CLIENTS, headers=headers)).plan.active_clients == 2
    )
    await create_card(account_stand, leader, {"name": "Freed slot"})


# spec:test client-card-profile-link#keep-client-card-account-two
# spec:test client-card-profile-link#keep-link-attendee-changes-login
# spec:test client-card-view-edit#change-break-card-link-reference
async def test_manual_link_claims_are_unique_and_survive_login_change(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("link_owner")
    attendee = await account_stand.add_account("link_attendee")
    await account_stand.activate(leader)
    headers = bearer(leader)
    attendee_headers = bearer(attendee)
    first = await create_card(
        account_stand, leader, {"name": "First card", "email": "private-reference"}
    )
    second = await create_card(account_stand, leader, {"name": "Other card"})
    for login in ("missing_login", leader.account.login.upper()):
        problem(
            await client.put(
                f"{CLIENTS}/{first.id}/link", json={"login": login}, headers=headers
            ),
            404,
            ErrorCode.LINK_LOGIN_NOT_FOUND,
        )
    barrier = Barrier(2)
    duplicate_check = links.find_duplicate_link
    seen = 0

    async def concurrent_duplicate_check(
        session: AsyncSession, leader_id: UUID, card_id: UUID, account_id: UUID
    ) -> ClientRecord | None:
        nonlocal seen
        duplicate = await duplicate_check(session, leader_id, card_id, account_id)
        if seen < 2:
            seen += 1
            await barrier.wait()
        return duplicate

    monkeypatch.setattr(links, "find_duplicate_link", concurrent_duplicate_check)
    body = {"login": attendee.account.login.upper()}
    async with timeout(10):
        responses = await gather(
            client.put(f"{CLIENTS}/{first.id}/link", json=body, headers=headers),
            client.put(f"{CLIENTS}/{second.id}/link", json=body, headers=headers),
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    linked = card_from(
        next(response for response in responses if response.status_code == 200)
    )
    rejected = problem(
        next(response for response in responses if response.status_code == 409),
        409,
        ErrorCode.LINK_DUPLICATE,
    )
    assert rejected.details == {"client_id": str(linked.id), "name": linked.name}
    assert linked.linked and linked.link.method == ClientLinkMethod.LOGIN
    assert (
        linked.link.login == attendee.account.login and linked.self_given_email is None
    )
    assert (
        await client.get(f"{CLIENTS}/{linked.id}", headers=attendee_headers)
    ).status_code == 403

    notices = NoticeList.model_validate_json(
        (await client.get("/api/v1/notices", headers=attendee_headers)).content
    ).items
    assert len(notices) == 1 and notices[0].tab == NoticeTab.PEOPLE
    assert notices[0].key == NoticeKey.LINKED
    assert notices[0].params == {
        "specialist_id": str(leader.account.id),
        "specialist_name": "New Account",
    }
    assert (
        await client.patch(
            "/api/v1/account",
            json={"login": "renamed_attendee", "first_name": "Attendee"},
            headers=attendee_headers,
        )
    ).status_code == 200
    path = f"{CLIENTS}/{linked.id}"
    edited = card_from(
        await client.patch(
            path,
            json={"email": "changed reference", "name": "Leader's name"},
            headers=headers,
        )
    )
    assert edited.name == "Leader's name" and edited.link.login == "renamed_attendee"
    assert edited.link.status == ClientLinkStatus.LINKED
    standalone = card_from(await client.delete(f"{path}/link", headers=headers))
    assert standalone.link.status == ClientLinkStatus.STANDALONE
    assert standalone.name == edited.name and standalone.email == edited.email
    assert (
        NoticeList.model_validate_json(
            (await client.get("/api/v1/notices", headers=attendee_headers)).content
        ).items
        == []
    )
    problem(
        await client.delete(f"{path}/link", headers=headers),
        409,
        ErrorCode.CLIENT_NOT_LINKED,
    )

    async with account_stand.session() as session:
        stored = await session.get(ClientRecord, linked.id)
        assert stored is not None and stored.auto_link_blocked
        assert stored.linked_account_id is None


async def test_client_photo_is_private_versioned_and_owner_only(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    leader = await account_stand.add_account("photo_owner")
    stranger = await account_stand.add_account("photo_stranger")
    attendee = await account_stand.add_account("photo_attendee")
    await account_stand.activate(leader)
    await account_stand.activate(stranger)
    headers = bearer(leader)
    card = await create_card(account_stand, leader, {"name": "Private image"})
    path = f"{CLIENTS}/{card.id}/photo"
    assert (
        await client.put(
            f"{CLIENTS}/{card.id}/link",
            json={"login": attendee.account.login},
            headers=headers,
        )
    ).status_code == 200
    problem(await client.get(path, headers=headers), 404, ErrorCode.NOT_FOUND)
    assert (
        await client.get(path, params={"version": "bad"}, headers=headers)
    ).status_code == 422

    first = card_from(
        await client.put(
            path, files={"file": ("photo.png", PNG, "image/png")}, headers=headers
        )
    )
    url = first.photo_url
    assert url is not None and url.startswith(f"{ORIGIN}{path}?version=")
    problem(await client.get(url), 401, ErrorCode.UNAUTHORIZED)
    problem(
        await client.get(url, headers=bearer(attendee)),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )
    problem(await client.get(url, headers=bearer(stranger)), 404, ErrorCode.NOT_FOUND)
    for address in (url, path):
        photo = await client.get(address, headers=headers)
        assert photo.status_code == 200 and photo.content == PNG
        assert photo.headers["Cache-Control"] == "no-store"
        assert photo.headers["Content-Type"] == "image/png"
    assert (
        list_from(await client.get(CLIENTS, headers=headers)).items[0].photo_url == url
    )
    async with account_stand.session() as session:
        record = await session.get(ClientRecord, card.id)
        assert record is not None and record.photo_key is not None
        old_key = record.photo_key
    assert (storage.client_photo_directory() / old_key).read_bytes() == PNG
    assert (await client.get(f"/media/{old_key}")).status_code == 404

    updated = card_from(
        await client.put(
            path, files={"file": ("photo.webp", WEBP, "image/webp")}, headers=headers
        )
    )
    assert updated.photo_url is not None and updated.photo_url != url
    problem(await client.get(url, headers=headers), 404, ErrorCode.NOT_FOUND)
    assert not (storage.client_photo_directory() / old_key).exists()
    new_file = await client.get(updated.photo_url, headers=headers)
    assert new_file.status_code == 200 and new_file.content == WEBP
    assert new_file.headers["Content-Type"] == "image/webp"
    cleared = card_from(await client.delete(path, headers=headers))
    assert cleared.photo_url is None
    problem(
        await client.get(updated.photo_url, headers=headers), 404, ErrorCode.NOT_FOUND
    )
