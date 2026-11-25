from datetime import date
from decimal import Decimal
from fractions import Fraction
from uuid import UUID

from sqlalchemy import Numeric, func, select, type_coerce
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.selectable import ScalarSelect

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.balance import BalanceOperation
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    BalanceOperationKind,
    ClientCardStatus,
    Currency,
    ErrorCode,
    PaymentType,
)
from celmento_api.schemas.balance import BalanceOperation as BalanceOperationView
from celmento_api.schemas.balance import BalanceSummary, ClientBalance
from celmento_api.schemas.money import Money, format_amount
from celmento_api.services.account_access import account_date


def card_balance_expression() -> ScalarSelect[Decimal]:
    # spec:impl client-balance-payments#compute-client-balance-payments-plus
    # spec:impl client-rate-currency#convert-amounts-currencies-add-up
    return (
        select(
            type_coerce(
                func.coalesce(func.sum(BalanceOperation.amount), Decimal(0)), Numeric()
            )
        )
        .where(
            BalanceOperation.client_card_id == ClientCard.client_card_id,
            BalanceOperation.currency == ClientCard.currency,
        )
        .correlate(ClientCard)
        .scalar_subquery()
    )


async def current_amount(session: AsyncSession, card: ClientCard) -> Decimal:
    amount = await session.scalar(
        select(card_balance_expression())
        .select_from(ClientCard)
        .where(ClientCard.client_card_id == card.client_card_id)
    )
    return amount if amount is not None else Decimal(0)


def balance_summary(card: ClientCard, amount: Decimal) -> BalanceSummary:
    rate = card.rate
    sessions_left, unpaid_sessions = None, None
    if (
        rate is not None
        and rate > 0
        and amount != 0
        and card.payment_type == PaymentType.PAID.value
    ):
        # spec:impl client-balance-payments#compute-session-count-balance-divided
        count = str(Fraction(abs(amount)) // Fraction(rate))
        if amount > 0:
            sessions_left = count
        else:
            unpaid_sessions = count
    return BalanceSummary(
        balance=Money(amount=format_amount(amount), currency=Currency(card.currency)),
        sessions_left=sessions_left,
        unpaid_sessions=unpaid_sessions,
    )


def can_edit_payment(card: ClientCard, operation: BalanceOperation) -> bool:
    return (
        card.status == ClientCardStatus.ACTIVE.value
        and operation.kind == BalanceOperationKind.PAYMENT.value
        and not operation.created_by_system
        and operation.currency == card.currency
        and operation.currency_version == card.currency_version
    )


async def read_client_balance(session: AsyncSession, card: ClientCard) -> ClientBalance:
    # spec:impl client-balance-payments#open-screen-6-4-history-listing
    operations = await session.scalars(
        select(BalanceOperation)
        .where(BalanceOperation.client_card_id == card.client_card_id)
        .order_by(
            BalanceOperation.date.desc(),
            BalanceOperation.created_at.desc(),
            BalanceOperation.balance_operation_id.desc(),
        )
    )
    return ClientBalance(
        balance=balance_summary(card, await current_amount(session, card)),
        items=[
            BalanceOperationView(
                id=row.balance_operation_id,
                kind=BalanceOperationKind(row.kind),
                amount=Money(
                    amount=format_amount(row.amount), currency=Currency(row.currency)
                ),
                date=row.date,
                comment=row.comment,
                meeting_id=row.meeting_id,
                created_by_system=row.created_by_system,
                editable=can_edit_payment(card, row),
                created_at=row.created_at,
            )
            for row in operations
        ],
    )


async def add_operation(
    session: AsyncSession,
    card: ClientCard,
    kind: BalanceOperationKind,
    amount: Decimal,
    on: date,
    comment: str | None,
    meeting_id: UUID | None,
    by_system: bool,
) -> BalanceOperation:
    operation = BalanceOperation(
        client_card_id=card.client_card_id,
        kind=kind.value,
        amount=amount,
        currency=card.currency,
        currency_version=card.currency_version,
        date=on,
        comment=comment,
        meeting_id=meeting_id,
        created_by_system=by_system,
    )
    session.add(operation)
    await session.flush()
    return operation


def validate_payment(amount: Decimal, on: date, leader: Account) -> None:
    if amount <= 0 or on > account_date(leader):
        raise AppError(400, ErrorCode.PAYMENT_INVALID)


async def editable_payment(
    session: AsyncSession, card: ClientCard, payment_id: UUID
) -> BalanceOperation:
    # spec:impl client-balance-payments#allow-editing-deleting-session-missed
    payment = await session.scalar(
        select(BalanceOperation).where(
            BalanceOperation.balance_operation_id == payment_id,
            BalanceOperation.client_card_id == card.client_card_id,
            BalanceOperation.kind == BalanceOperationKind.PAYMENT.value,
            BalanceOperation.created_by_system.is_(False),
        )
    )
    if payment is None:
        raise AppError(404, ErrorCode.NOT_FOUND)
    if not can_edit_payment(card, payment):
        # spec:impl client-balance-payments#allow-editing-deleting-payment-recorded
        raise AppError(409, ErrorCode.CONFLICT)
    return payment
