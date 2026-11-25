from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.errors import AppError
from celmento_api.models.account import Account
from celmento_api.models.balance import BalanceOperation
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    BalanceOperationKind,
    ClientCardStatus,
    ErrorCode,
    MeetingOutcomeStatus,
    MeetingStatus,
    MeetingType,
    PaymentType,
)
from celmento_api.models.meeting import Meeting, MeetingExpenseCorrection
from celmento_api.schemas.meetings import MeetingOutcomeFields
from celmento_api.services.balance import add_operation
from celmento_api.services.clients import validate_payment_type
from celmento_api.services.schedule import local_day


def visible_charge_choice(meeting: Meeting) -> bool | None:
    if meeting.status != MeetingStatus.NOT_TAKEN_PLACE.value:
        return None
    if meeting.type == MeetingType.MUTUAL_PRACTICE.value or (
        meeting.type == MeetingType.CLIENT_SESSION.value
        and meeting.payment_type != PaymentType.PAID.value
    ):
        return False
    return meeting.charged


def client_charge(meeting: Meeting) -> Decimal:
    if meeting.payment_type == PaymentType.PAID.value and (
        meeting.status == MeetingStatus.COMPLETED.value
        or visible_charge_choice(meeting)
    ):
        if meeting.price is None:
            raise AppError(500, ErrorCode.INTERNAL_ERROR)
        return meeting.price
    return Decimal(0)


type ServiceExpense = tuple[str, Decimal]


def service_expense(meeting: Meeting) -> ServiceExpense | None:
    if meeting.type not in (
        MeetingType.PERSONAL_THERAPY,
        MeetingType.SUPERVISION,
        MeetingType.TRAINING,
    ):
        return None
    if meeting.status != MeetingStatus.COMPLETED and not visible_charge_choice(meeting):
        return None
    if meeting.price is None or meeting.currency is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return meeting.currency, meeting.price


def correct_service_expense(
    session: AsyncSession, meeting: Meeting, previous: ServiceExpense | None
) -> None:
    current = service_expense(meeting)
    if previous == current:
        return
    deltas: dict[str, Decimal] = {}
    if previous is not None:
        currency, amount = previous
        deltas[currency] = -amount
    if current is not None:
        currency, amount = current
        deltas[currency] = deltas.get(currency, Decimal(0)) + amount
    # spec:impl meeting-outcome-recording#recalculate-balance-charge-expense
    session.add_all(
        MeetingExpenseCorrection(
            meeting_id=meeting.meeting_id, currency=currency, amount=delta
        )
        for currency, delta in deltas.items()
        if delta
    )


async def _add_charge_operation(
    session: AsyncSession,
    leader: Account,
    meeting: Meeting,
    card: ClientCard,
    kind: BalanceOperationKind,
    amount: Decimal,
) -> None:
    if meeting.currency is None or meeting.currency_version is None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    await add_operation(
        session,
        card,
        kind,
        amount,
        local_day(meeting.starts_at, leader.time_zone),
        None,
        meeting.meeting_id,
        by_system=True,
        currency_period=(meeting.currency, meeting.currency_version),
    )


async def correct_client_charge(
    session: AsyncSession,
    leader: Account,
    meeting: Meeting,
    card: ClientCard | None,
    previous_charge: Decimal,
) -> None:
    delta = previous_charge - client_charge(meeting)
    if card is not None and delta != 0:
        await _add_charge_operation(
            session, leader, meeting, card, BalanceOperationKind.CORRECTION, delta
        )


async def record_outcome(
    session: AsyncSession,
    leader: Account,
    meeting: Meeting,
    card: ClientCard | None,
    outcome: MeetingOutcomeFields,
    now: datetime,
) -> None:
    if meeting.starts_at > now:
        raise AppError(409, ErrorCode.MEETING_NOT_STARTED)
    if card is not None and card.status == ClientCardStatus.ARCHIVED.value:
        # spec:impl meeting-outcome-recording#allow-changing-outcome-meeting-client
        raise AppError(409, ErrorCode.MEETING_CLIENT_ARCHIVED)

    previous_status = meeting.status
    previous_charge = client_charge(meeting)
    previous_expense = (
        service_expense(meeting)
        if outcome["status"] == MeetingOutcomeStatus.COMPLETED and "price" in outcome
        else None
    )
    own_practice = meeting.type == MeetingType.MUTUAL_PRACTICE.value
    if outcome["status"] == MeetingOutcomeStatus.COMPLETED:
        price = meeting.price
        if not own_practice and "price" in outcome:
            price = Decimal(outcome["price"])
        if card is not None and meeting.payment_type is not None:
            payment = outcome.get("payment_type", PaymentType(meeting.payment_type))
            validate_payment_type(price, payment)
            meeting.payment_type = payment.value
            # spec:impl client-list#remove-new-badge-soon-client-first
            card.is_new = False
        meeting.price = price
        meeting.actual_duration_minutes = outcome.get(
            "actual_duration_minutes",
            meeting.my_duration_minutes or meeting.duration_minutes,
        )
        meeting.charged = None
        meeting.status = MeetingStatus.COMPLETED.value
    else:
        needs_decision = not own_practice and (
            card is None or meeting.payment_type == PaymentType.PAID.value
        )
        if needs_decision and "charged" not in outcome:
            raise AppError(400, ErrorCode.OUTCOME_CHOICE_REQUIRED)
        meeting.charged = outcome.get("charged", False) if needs_decision else False
        meeting.actual_duration_minutes = None
        meeting.status = MeetingStatus.NOT_TAKEN_PLACE.value
    meeting.updated_at = now

    if card is None:
        if previous_expense is not None:
            correct_service_expense(session, meeting, previous_expense)
        return

    charge = client_charge(meeting)
    if previous_status == meeting.status and (
        meeting.status != MeetingStatus.NOT_TAKEN_PLACE.value
        or (previous_charge == 0) == (charge == 0)
    ):
        await correct_client_charge(session, leader, meeting, card, previous_charge)
        return

    if previous_charge > 0:
        await _add_charge_operation(
            session,
            leader,
            meeting,
            card,
            BalanceOperationKind.REFUND_TO_BALANCE,
            previous_charge,
        )
    if charge > 0:
        kind = (
            BalanceOperationKind.SESSION_CHARGE
            if meeting.status == MeetingStatus.COMPLETED.value
            else BalanceOperationKind.MISSED_CHARGE
        )
        await _add_charge_operation(session, leader, meeting, card, kind, -charge)


async def _relabel_kept_charge(
    session: AsyncSession, meeting: Meeting, meeting_day: date
) -> None:
    operations = await session.scalars(
        select(BalanceOperation)
        .where(BalanceOperation.meeting_id == meeting.meeting_id)
        .order_by(BalanceOperation.created_at, BalanceOperation.balance_operation_id)
    )
    running = Decimal(0)
    first_charge: BalanceOperation | None = None
    for operation in operations:
        if running == 0 and operation.amount < 0:
            first_charge = operation
        running += operation.amount
        if running == 0:
            first_charge = None
    if first_charge is None or running != -client_charge(meeting):
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    # spec:impl meeting-reschedule-cancel-delete#keep-charge-balance-history-leader
    first_charge.kind = BalanceOperationKind.DELETED_MEETING_CHARGE.value
    first_charge.date = meeting_day


async def delete_meeting(
    session: AsyncSession,
    leader: Account,
    meeting: Meeting,
    card: ClientCard | None,
    refund: bool | None,
) -> None:
    charge = client_charge(meeting)
    if charge > 0:
        if refund is None:
            raise AppError(400, ErrorCode.REFUND_CHOICE_REQUIRED)
        if refund and card is not None:
            # spec:impl meeting-reschedule-cancel-delete#return-charged-amount-client-balance
            await _add_charge_operation(
                session,
                leader,
                meeting,
                card,
                BalanceOperationKind.REFUND_TO_BALANCE,
                charge,
            )
        else:
            await _relabel_kept_charge(
                session, meeting, local_day(meeting.starts_at, leader.time_zone)
            )
    # spec:impl meeting-reschedule-cancel-delete#let-scheduled-meeting-time-passed
    # spec:impl meeting-reschedule-cancel-delete#introduce-rescheduled-cancelled-status
    await session.delete(meeting)
