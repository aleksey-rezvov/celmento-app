from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi.exceptions import RequestValidationError
from sqlalchemy import DateTime, Integer, Nullable, func, or_, select, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    ClientCardStatus,
    ClientLinkMethod,
    ClientLinkStatus,
    ClientSource,
    ContactChannel,
    Currency,
    ErrorCode,
    MeetingStatus,
    PaymentType,
)
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.clients import ClientCard as ClientCardView
from celmento_api.schemas.clients import (
    ClientCreateFields,
    ClientLink,
    ClientList,
    ClientListItem,
    ClientRef,
    ClientUpdateFields,
)
from celmento_api.schemas.money import format_amount
from celmento_api.services.accounts import DEFAULT_CURRENCY, leader_record
from celmento_api.services.balance import (
    balance_summary,
    card_balance_expression,
    current_amount,
)
from celmento_api.services.limit import ensure_card_can_become_active
from celmento_api.services.plan_status import plan_status
from celmento_api.services.schedule import apply_client_currency_to_future_meetings
from celmento_api.storage import client_photo_url


def client_reference(
    card: ClientCard, origin: str, linked_zone: str | None
) -> ClientRef:
    # spec:impl time-zone-handling#take-other-party-zone-only-linked
    return ClientRef(
        id=card.client_card_id,
        name=card.name,
        photo_url=client_photo_url(card.client_card_id, card.photo_key, origin),
        archived=card.status == ClientCardStatus.ARCHIVED.value,
        linked=card.linked_account_id is not None,
        time_zone=linked_zone,
    )


async def owned_client(
    session: AsyncSession, leader_id: UUID, client_id: UUID, *, lock: bool = False
) -> ClientCard:
    # spec:impl client-card-profile-link#keep-client-card-account-two
    query = select(ClientCard).where(
        ClientCard.leader_account_id == leader_id,
        ClientCard.client_card_id == client_id,
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    card = await session.scalar(query)
    if card is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    return card


async def active_client_for_update(
    session: AsyncSession, leader_id: UUID, client_id: UUID
) -> ClientCard:
    card = await owned_client(session, leader_id, client_id, lock=True)
    # spec:impl client-balance-payments#allow-adding-editing-deleting-payment
    if card.status == ClientCardStatus.ARCHIVED.value:
        raise AppError(409, ErrorCode.CLIENT_ARCHIVED)
    return card


async def list_client_cards(
    session: AsyncSession,
    leader: Account,
    origin: str,
    status: ClientCardStatus | None,
    q: str | None,
) -> ClientList:
    completed = (
        select(func.count())
        .select_from(Meeting)
        .where(
            Meeting.client_card_id == ClientCard.client_card_id,
            Meeting.leader_account_id == ClientCard.leader_account_id,
            Meeting.status == MeetingStatus.COMPLETED.value,
        )
        .correlate(ClientCard)
        .scalar_subquery()
    )
    last_started = (
        select(
            Nullable(type_coerce(func.max(Meeting.starts_at), DateTime(timezone=True)))
        )
        .where(
            Meeting.client_card_id == ClientCard.client_card_id,
            Meeting.leader_account_id == ClientCard.leader_account_id,
            Meeting.starts_at <= datetime.now(UTC),
        )
        .correlate(ClientCard)
        .scalar_subquery()
    )
    query = select(
        ClientCard, card_balance_expression(), completed, last_started
    ).where(ClientCard.leader_account_id == leader.account_id)
    if status is not None:
        query = query.where(ClientCard.status == status.value)
    if q is not None:
        # spec:impl client-list#filter-clients-section-name-reference
        # spec:impl client-list#match-search-against-self-given-email
        query = query.where(
            or_(
                ClientCard.name.icontains(q, autoescape=True),
                ClientCard.phone.icontains(q, autoescape=True),
                ClientCard.email.icontains(q, autoescape=True),
                ClientCard.telegram.icontains(q, autoescape=True),
                ClientCard.whatsapp.icontains(q, autoescape=True),
            )
        )
    # spec:impl client-list#order-rows-client-name-default
    rows = await session.execute(
        query.order_by(
            ClientCard.status, func.lower(ClientCard.name), ClientCard.client_card_id
        )
    )
    items = [
        ClientListItem(
            id=card.client_card_id,
            name=card.name,
            photo_url=client_photo_url(card.client_card_id, card.photo_key, origin),
            status=ClientCardStatus(card.status),
            archived_at=card.archived_at,
            linked=card.linked_account_id is not None,
            is_new=card.is_new,
            completed_sessions=completed_sessions,
            last_meeting_at=last_meeting_at,
            balance=balance_summary(card, amount),
        )
        for card, amount, completed_sessions, last_meeting_at in rows
    ]
    return ClientList(items=items, plan=await plan_status(session, leader))


async def _link_view(session: AsyncSession, card: ClientCard) -> ClientLink:
    if card.linked_account_id is not None and card.link_method is not None:
        # spec:impl client-card-profile-link#keep-link-attendee-changes-login
        login = await session.scalar(
            select(Account.login).where(Account.account_id == card.linked_account_id)
        )
        return ClientLink(
            status=ClientLinkStatus.LINKED,
            method=ClientLinkMethod(card.link_method),
            login=login,
        )
    return ClientLink(
        status=ClientLinkStatus.UNLINKED_BY_CLIENT
        if card.unlinked_by_client_at is not None
        else ClientLinkStatus.STANDALONE,
        method=None,
        login=None,
    )


async def client_view(
    session: AsyncSession, card: ClientCard, origin: str
) -> ClientCardView:
    completed, minutes = (
        await session.execute(
            select(
                func.count(),
                type_coerce(
                    func.coalesce(func.sum(Meeting.actual_duration_minutes), 0),
                    Integer(),
                ),
            ).where(
                Meeting.client_card_id == card.client_card_id,
                Meeting.leader_account_id == card.leader_account_id,
                Meeting.status == MeetingStatus.COMPLETED.value,
            )
        )
    ).one()
    hours = (Decimal(minutes) / Decimal(60)).quantize(
        Decimal("0.1"), rounding=ROUND_HALF_UP
    )
    return ClientCardView(
        id=card.client_card_id,
        name=card.name,
        photo_url=client_photo_url(card.client_card_id, card.photo_key, origin),
        phone=card.phone,
        email=card.email,
        telegram=card.telegram,
        whatsapp=card.whatsapp,
        other_contact=card.other_contact,
        preferred_channel=ContactChannel(card.preferred_channel)
        if card.preferred_channel is not None
        else None,
        self_given_email=card.self_given_email,
        link=await _link_view(session, card),
        rate=format_amount(card.rate) if card.rate is not None else None,
        currency=Currency(card.currency),
        payment_type=PaymentType(card.payment_type),
        request=card.request,
        goals=card.goals,
        info=card.info,
        hypotheses=card.hypotheses,
        status=ClientCardStatus(card.status),
        archived_at=card.archived_at,
        linked=card.linked_account_id is not None,
        is_new=card.is_new,
        source=ClientSource(card.source),
        completed_sessions=completed,
        completed_hours=float(hours),
        balance=balance_summary(card, await current_amount(session, card)),
        created_at=card.created_at,
    )


def validate_payment_type(rate: Decimal | None, payment_type: PaymentType) -> None:
    # spec:impl client-rate-currency#make-paid-unavailable-rate-0-require
    if rate == 0 and payment_type == PaymentType.PAID:
        raise AppError(400, ErrorCode.PAYMENT_TYPE_REQUIRED)


async def create_client_card(
    session: AsyncSession, leader: Account, body: ClientCreateFields
) -> ClientCard:
    await ensure_card_can_become_active(session, leader)
    profile = await leader_record(session, leader.account_id)
    # spec:impl client-rate-currency#copy-rate-currency-leader-profile
    # spec:impl client-rate-currency#keep-card-rate-currency-unchanged
    rate = profile.default_rate
    if "rate" in body:
        supplied_rate = body["rate"]
        rate = Decimal(supplied_rate) if supplied_rate is not None else None
    currency = body.get(
        "currency", Currency(profile.default_currency or DEFAULT_CURRENCY)
    )
    # spec:impl client-rate-currency#store-card-payment-type-paid
    default_payment_type = (
        PaymentType.PRO_BONO if "rate" not in body and not rate else PaymentType.PAID
    )
    payment_type = body.get("payment_type", default_payment_type)
    validate_payment_type(rate, payment_type)
    # spec:impl client-card-create#accept-reference-contact-entered-without-format
    # spec:impl client-card-create#allow-card-name-reference-contacts
    # spec:impl client-card-create#create-card-save-standalone-card
    # spec:impl client-card-create#mark-manually-created-card-new-badge
    card = ClientCard(
        leader_account_id=leader.account_id,
        name=body["name"],
        phone=body.get("phone"),
        email=body.get("email"),
        telegram=body.get("telegram"),
        whatsapp=body.get("whatsapp"),
        rate=rate,
        currency=currency.value,
        payment_type=payment_type.value,
        source=ClientSource.CREATED.value,
    )
    session.add(card)
    await session.flush()
    return card


async def update_client_card(
    session: AsyncSession, card: ClientCard, body: ClientUpdateFields
) -> None:
    rate = card.rate
    if "rate" in body:
        supplied_rate = body["rate"]
        rate = Decimal(supplied_rate) if supplied_rate is not None else None
    currency = body.get("currency", Currency(card.currency))
    payment_type = body.get("payment_type", PaymentType(card.payment_type))
    validate_payment_type(rate, payment_type)
    currency_changed = currency.value != card.currency
    if currency_changed:
        # spec:impl client-rate-currency#allow-changing-currency-screen-6-2
        if await current_amount(session, card) != 0:
            raise AppError(409, ErrorCode.BALANCE_NOT_ZERO)
        if body.get("rate") is None:
            raise AppError(400, ErrorCode.RATE_REQUIRED)
        card.currency_version += 1
    card.rate = rate
    card.currency = currency.value
    card.payment_type = payment_type.value

    card.name = body.get("name", card.name)
    # spec:impl client-card-view-edit#accept-reference-contact-screen-6-2
    # spec:impl client-card-view-edit#change-break-card-link-reference
    card.phone = body.get("phone", card.phone)
    card.email = body.get("email", card.email)
    card.telegram = body.get("telegram", card.telegram)
    card.whatsapp = body.get("whatsapp", card.whatsapp)
    card.other_contact = body.get("other_contact", card.other_contact)
    preferred = body.get(
        "preferred_channel",
        ContactChannel(card.preferred_channel)
        if card.preferred_channel is not None
        else None,
    )
    if preferred is not None:
        contacts: dict[ContactChannel, str | None] = {
            ContactChannel.PHONE: card.phone,
            ContactChannel.EMAIL: card.email,
            ContactChannel.TELEGRAM: card.telegram,
            ContactChannel.WHATSAPP: card.whatsapp,
            ContactChannel.OTHER: card.other_contact,
        }
        contact = contacts[preferred]
        if contact is None or not contact.strip():
            raise RequestValidationError(
                [{"loc": ("body", "preferred_channel"), "type": "contact_not_filled"}]
            )
    card.preferred_channel = preferred.value if preferred is not None else None
    card.request = body.get("request", card.request)
    card.goals = body.get("goals", card.goals)
    card.info = body.get("info", card.info)
    card.hypotheses = body.get("hypotheses", card.hypotheses)
    if currency_changed:
        await apply_client_currency_to_future_meetings(session, card, datetime.now(UTC))
