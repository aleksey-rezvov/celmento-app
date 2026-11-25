from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import ClientLinkMethod, ErrorCode, NoticeKey, NoticeTab
from celmento_api.models.notice import Notice
from celmento_api.services.notices import raise_notice
from celmento_api.services.sign_in_codes import normalize_email


async def lock_self_given_email(session: AsyncSession, normal_email: str) -> None:
    # Booking takes this lock before selecting or writing a card for the email.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:subject, 0))"),
        {"subject": f"client-self-given-email:{normal_email}"},
    )


async def find_duplicate_link(
    session: AsyncSession, leader_id: UUID, card_id: UUID, account_id: UUID
) -> ClientCard | None:
    return await session.scalar(
        select(ClientCard).where(
            ClientCard.leader_account_id == leader_id,
            ClientCard.client_card_id != card_id,
            ClientCard.linked_account_id == account_id,
        )
    )


async def _connect(
    session: AsyncSession, card: ClientCard, target_id: UUID, method: ClientLinkMethod
) -> ClientCard | None:
    leader_id, card_id = card.leader_account_id, card.client_card_id
    duplicate = await find_duplicate_link(session, leader_id, card_id, target_id)
    if duplicate is not None:
        return duplicate
    try:
        async with session.begin_nested():
            card.linked_account_id = target_id
            card.link_method = method.value
            card.unlinked_by_client_at = None
            await session.flush()
    except IntegrityError as exc:
        if getattr(exc.orig, "sqlstate", None) != "23505":
            raise
        duplicate = await find_duplicate_link(session, leader_id, card_id, target_id)
        if duplicate is None:
            raise
        return duplicate
    return None


async def auto_link_for_account(session: AsyncSession, account: Account) -> int:
    email = normalize_email(account.email)
    await lock_self_given_email(session, email)
    # spec:impl client-card-profile-link#make-auto-link-account-created
    # spec:impl client-card-profile-link#match-self-given-email-against-account
    # spec:impl client-card-profile-link#link-card-reference-contacts-name
    # spec:impl client-card-profile-link#auto-link-card-account-linked
    cards = await session.scalars(
        select(ClientCard)
        .where(
            ClientCard.self_given_email == email,
            ClientCard.leader_account_id != account.account_id,
            ClientCard.linked_account_id.is_(None),
            ClientCard.auto_link_blocked.is_(False),
        )
        .order_by(
            ClientCard.leader_account_id,
            ClientCard.created_at,
            ClientCard.client_card_id,
        )
        .with_for_update()
    )
    count = 0
    for card in cards:
        if (
            await _connect(session, card, account.account_id, ClientLinkMethod.AUTO)
            is None
        ):
            count += 1
    return count


async def auto_link_card(session: AsyncSession, card: ClientCard) -> bool:
    if (
        card.self_given_email is None
        or card.linked_account_id is not None
        or card.auto_link_blocked
    ):
        return False
    email = normalize_email(card.self_given_email)
    await lock_self_given_email(session, email)
    target_id = await session.scalar(
        select(Account.account_id).where(Account.email == email)
    )
    if target_id is None or target_id == card.leader_account_id:
        return False
    return await _connect(session, card, target_id, ClientLinkMethod.AUTO) is None


async def link_by_login(
    session: AsyncSession, card: ClientCard, leader: Account, login: str
) -> None:
    if card.linked_account_id is not None:
        raise AppError(409, ErrorCode.CONFLICT)
    target_id = (
        await session.scalar(
            select(Account.account_id).where(Account.login == login.lower())
        )
        if login.isascii()
        else None
    )
    if target_id is None or target_id == leader.account_id:
        # spec:impl client-card-profile-link#show-link-not-found-keep-saving
        raise AppError(404, ErrorCode.LINK_LOGIN_NOT_FOUND)
    # spec:impl client-card-profile-link#make-login-link-leader-enters
    duplicate = await _connect(session, card, target_id, ClientLinkMethod.LOGIN)
    if duplicate is not None:
        # spec:impl client-card-profile-link#show-link-duplicate-name-other-card
        raise AppError(
            409,
            ErrorCode.LINK_DUPLICATE,
            {"client_id": str(duplicate.client_card_id), "name": duplicate.name},
        )
    await raise_notice(
        session,
        target_id,
        NoticeTab.PEOPLE,
        NoticeKey.LINKED,
        {
            "specialist_name": f"{leader.first_name} {leader.last_name}",
            "specialist_id": str(leader.account_id),
        },
    )


async def unlink(session: AsyncSession, card: ClientCard, by_client: bool) -> None:
    target_id = card.linked_account_id
    if target_id is None:
        raise AppError(409, ErrorCode.CLIENT_NOT_LINKED)
    # spec:impl client-card-profile-link#break-link-after-leader-confirms
    card.linked_account_id = None
    card.link_method = None
    card.unlinked_by_client_at = datetime.now(UTC) if by_client else None
    card.auto_link_blocked = True
    await session.execute(
        update(Notice)
        .where(
            Notice.account_id == target_id,
            Notice.key == NoticeKey.LINKED.value,
            Notice.params.contains({"specialist_id": str(card.leader_account_id)}),
            Notice.dismissed_at.is_(None),
        )
        .values(dismissed_at=datetime.now(UTC))
    )
