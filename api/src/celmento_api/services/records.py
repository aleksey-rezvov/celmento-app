from calendar import monthrange
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import (
    BigInteger,
    ColumnElement,
    Integer,
    Nullable,
    Select,
    func,
    literal,
    select,
    type_coerce,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from celmento_api.errors import AppError, invalid_request_value
from celmento_api.models.account import Account
from celmento_api.models.balance import BalanceOperation
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    BalanceOperationKind,
    Currency,
    ErrorCode,
    MeetingStatus,
    MeetingType,
    PaymentType,
    RecordsHoursLogType,
    RecordsOperationFilter,
    RecordsOperationKind,
    RecordsPeriodKind,
)
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.money import Money, format_amount
from celmento_api.schemas.records import (
    RecordsBalanceItem,
    RecordsBalanceList,
    RecordsHoursBreakdown,
    RecordsHoursLog,
    RecordsHoursMeeting,
    RecordsOperation,
    RecordsOperationList,
    RecordsPeriod,
    RecordsSummary,
)
from celmento_api.services.balance import balance_summary, card_balance_expression
from celmento_api.services.clients import client_reference
from celmento_api.services.meeting_views import owned_meeting_rows
from celmento_api.services.outcomes import client_charge, service_expense
from celmento_api.services.schedule import date_bounds, local_day

LOG_TYPES: Mapping[RecordsHoursLogType, tuple[MeetingType, ...]] = {
    RecordsHoursLogType.PRACTICE: (
        MeetingType.CLIENT_SESSION,
        MeetingType.MUTUAL_PRACTICE,
    ),
    RecordsHoursLogType.SUPERVISION: (MeetingType.SUPERVISION,),
    RecordsHoursLogType.THERAPY: (MeetingType.PERSONAL_THERAPY,),
    RecordsHoursLogType.TRAINING: (MeetingType.TRAINING,),
}

OPERATION_FILTERS: Mapping[RecordsOperationKind, RecordsOperationFilter] = {
    RecordsOperationKind.SESSION_CHARGE: RecordsOperationFilter.INCOME,
    RecordsOperationKind.MISSED_CHARGE: RecordsOperationFilter.INCOME,
    RecordsOperationKind.PAYMENT: RecordsOperationFilter.RECEIPTS,
    RecordsOperationKind.SERVICE_EXPENSE: RecordsOperationFilter.EXPENSES,
}


def resolve_period(
    kind: RecordsPeriodKind, start: date | None, end: date | None, today: date
) -> RecordsPeriod:
    # spec:impl accounting-summary#interpret-period-year-current-calendar
    match kind:
        case RecordsPeriodKind.ALL:
            start, end = None, None
        case RecordsPeriodKind.YEAR:
            start, end = date(today.year, 1, 1), date(today.year, 12, 31)
        case RecordsPeriodKind.MONTH:
            start = today.replace(day=1)
            end = today.replace(day=monthrange(today.year, today.month)[1])
        case RecordsPeriodKind.WEEK:
            start = today - timedelta(days=today.weekday())
            end = start + timedelta(days=6)
        case RecordsPeriodKind.CUSTOM:
            if start is None:
                raise invalid_request_value("query", "from")
            if end is None or end < start:
                raise invalid_request_value("query", "to")
    return RecordsPeriod.model_validate({"kind": kind, "from": start, "to": end})


def meeting_window(
    period: RecordsPeriod, time_zone: str
) -> tuple[ColumnElement[bool], ...]:
    if period.from_ is None or period.to is None:
        return ()
    # spec:impl accounting-summary#assign-meeting-period-date-start
    # spec:impl time-zone-handling#assign-meeting-day-schedule-start
    lower, upper = date_bounds(period.from_, period.to, ZoneInfo(time_zone))
    return Meeting.starts_at >= lower, Meeting.starts_at < upper


def _payments(leader_id: UUID, period: RecordsPeriod) -> Select[BalanceOperation]:
    # spec:impl accounting-summary#compute-receipts-client-payments-dated
    # spec:impl money-operations-feed#list-client-payment-receipts-row
    statement = (
        select(BalanceOperation)
        .select_from(BalanceOperation)
        .join(ClientCard, ClientCard.client_card_id == BalanceOperation.client_card_id)
        .where(
            ClientCard.leader_account_id == leader_id,
            BalanceOperation.kind == BalanceOperationKind.PAYMENT.value,
        )
    )
    if period.from_ is not None and period.to is not None:
        statement = statement.where(
            BalanceOperation.date >= period.from_,
            BalanceOperation.date <= period.to,
        )
    return statement


def counted_minutes() -> ColumnElement[int]:
    # spec:impl meeting-outcome-recording#count-actual-duration-hours-log
    # spec:impl hours-log#count-client-session-supervision-therapy
    # spec:impl hours-log#count-completed-mutual-practice-meeting
    # spec:impl hours-log#count-part-mutual-practice-meeting
    return type_coerce(
        func.coalesce(Meeting.actual_duration_minutes, 0),
        Integer(),
    )


def decimal_hours(minutes: int) -> Decimal:
    return (Decimal(minutes) / 60).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _hours(minutes: int) -> float:
    return float(decimal_hours(minutes))


def _meeting_money(
    meeting: Meeting,
) -> tuple[RecordsOperationKind, Currency, Decimal] | None:
    # spec:impl accounting-summary#compute-income-amounts-charged-client
    # spec:impl accounting-summary#count-client-session-payment-type
    charge = client_charge(meeting)
    if charge:
        if meeting.currency is None:
            raise AppError(500, ErrorCode.INTERNAL_ERROR)
        # spec:impl money-operations-feed#list-client-session-payment-type-paid-completed
        # spec:impl money-operations-feed#list-client-session-payment-type-paid
        kind = (
            RecordsOperationKind.SESSION_CHARGE
            if meeting.status == MeetingStatus.COMPLETED.value
            else RecordsOperationKind.MISSED_CHARGE
        )
        return kind, Currency(meeting.currency), charge
    # spec:impl accounting-summary#compute-expenses-prices-personal-therapy
    # spec:impl accounting-summary#count-mutual-practice-meeting-money
    expense = service_expense(meeting)
    # spec:impl money-operations-feed#list-personal-therapy-supervision
    if expense is not None:
        currency, amount = expense
        return RecordsOperationKind.SERVICE_EXPENSE, Currency(currency), -amount
    return None


def _add_amount(
    amounts: dict[Currency, Decimal], currency: Currency, amount: Decimal
) -> None:
    amounts[currency] = amounts.get(currency, Decimal(0)) + amount


def _money_totals(amounts: Mapping[Currency, Decimal]) -> list[Money]:
    # spec:impl accounting-summary#compute-money-indicator-separately
    # spec:impl accounting-summary#sum-convert-amounts-different-currencies
    return [
        Money(currency=currency, amount=format_amount(amounts[currency]))
        for currency in Currency
        if currency in amounts
    ]


async def _nonzero_balances(
    session: AsyncSession, leader_id: UUID, today: date
) -> list[tuple[ClientCard, Decimal, str | None]]:
    rows = await session.execute(
        select(ClientCard, card_balance_expression(today), Nullable(Account.time_zone))
        .select_from(ClientCard)
        .outerjoin(Account, Account.account_id == ClientCard.linked_account_id)
        .where(ClientCard.leader_account_id == leader_id)
    )
    return [(card, amount, zone) for card, amount, zone in rows if amount]


async def summary(
    session: AsyncSession, leader: Account, period: RecordsPeriod, today: date
) -> RecordsSummary:
    by_filter: dict[RecordsOperationFilter, dict[Currency, Decimal]] = {
        group: {}
        for group in RecordsOperationFilter
        if group != RecordsOperationFilter.ALL
    }
    minutes_by_type: dict[MeetingType, int] = dict.fromkeys(MeetingType, 0)
    practice = LOG_TYPES[RecordsHoursLogType.PRACTICE]
    completed_sessions = 0
    # spec:impl attended-meetings#count-attended-meetings-account-pending
    # spec:impl accounting-summary#count-attended-meetings-leader-attendee
    stored_outcomes = select(Meeting).where(
        Meeting.leader_account_id == leader.account_id,
        Meeting.status != MeetingStatus.SCHEDULED.value,
    )
    outcomes = await session.stream(
        stored_outcomes.add_columns(counted_minutes())
        .where(*meeting_window(period, leader.time_zone))
        .options(
            load_only(
                Meeting.type,
                Meeting.status,
                Meeting.payment_type,
                Meeting.charged,
                Meeting.price,
                Meeting.currency,
                raiseload=True,
            )
        )
    )
    has_outcomes = False
    async for meeting, minutes in outcomes:
        has_outcomes = True
        operation = _meeting_money(meeting)
        if operation is not None:
            kind, currency, amount = operation
            _add_amount(by_filter[OPERATION_FILTERS[kind]], currency, amount)
        if meeting.status == MeetingStatus.COMPLETED.value:
            meeting_type = MeetingType(meeting.type)
            minutes_by_type[meeting_type] += minutes
            completed_sessions += int(meeting_type in practice)
    if not has_outcomes and period.kind != RecordsPeriodKind.ALL:
        has_outcomes = bool(await session.scalar(select(stored_outcomes.exists())))

    receipt_amounts = by_filter[RecordsOperationFilter.RECEIPTS]
    payments = await session.stream(
        _payments(leader.account_id, period).with_only_columns(
            BalanceOperation.currency, BalanceOperation.amount
        )
    )
    async for currency, amount in payments:
        _add_amount(receipt_amounts, Currency(currency), amount)

    prepaid: dict[Currency, Decimal] = {}
    debts: dict[Currency, Decimal] = {}
    # spec:impl accounting-summary#show-prepaid-debts-tile-sum-positive
    # spec:impl accounting-summary#keep-hours-amounts-archived-clients
    # spec:impl client-archive-restore#leave-hours-log-balance-amount
    # spec:impl meeting-outcome-recording#keep-outcome-hours-money-records
    for card, amount, _ in await _nonzero_balances(session, leader.account_id, today):
        _add_amount(prepaid if amount > 0 else debts, Currency(card.currency), amount)

    supervision = minutes_by_type[MeetingType.SUPERVISION]
    therapy = minutes_by_type[MeetingType.PERSONAL_THERAPY]
    training = minutes_by_type[MeetingType.TRAINING]
    # spec:impl accounting-summary#reflect-recorded-changed-outcome-edited
    return RecordsSummary(
        period=period,
        has_outcomes=has_outcomes,
        income=_money_totals(by_filter[RecordsOperationFilter.INCOME]),
        receipts=_money_totals(receipt_amounts),
        expenses=_money_totals(by_filter[RecordsOperationFilter.EXPENSES]),
        prepaid=_money_totals(prepaid),
        debts=_money_totals(debts),
        practice_hours=_hours(sum(minutes_by_type[kind] for kind in practice)),
        completed_sessions=completed_sessions,
        growth_hours=_hours(supervision + therapy + training),
        supervision_hours=_hours(supervision),
        personal_therapy_hours=_hours(therapy),
        training_hours=_hours(training),
    )


async def operations(
    session: AsyncSession,
    leader: Account,
    period: RecordsPeriod,
    group: RecordsOperationFilter,
    origin: str,
) -> RecordsOperationList:
    items: list[tuple[datetime, RecordsOperation]] = []
    if group != RecordsOperationFilter.RECEIPTS:
        # spec:impl money-operations-feed#keep-rows-archived-clients
        # spec:impl money-operations-feed#list-scheduled-meetings-awaiting-outcome
        # spec:impl money-operations-feed#list-client-sessions-payment-type
        rows = await session.stream(
            owned_meeting_rows(leader.account_id).where(
                Meeting.status != MeetingStatus.SCHEDULED.value,
                *meeting_window(period, leader.time_zone),
            )
        )
        async for meeting, card, zone in rows:
            # spec:impl money-operations-feed#show-meeting-row-amount-currently
            # spec:impl money-operations-feed#remove-meeting-row-soon-outcome
            # spec:impl money-operations-feed#match-per-currency-sum-rows-filter
            entry = _meeting_money(meeting)
            if entry is None:
                continue
            kind, currency, amount = entry
            if group != RecordsOperationFilter.ALL and OPERATION_FILTERS[kind] != group:
                continue
            items.append(
                (
                    meeting.starts_at,
                    RecordsOperation(
                        id=meeting.meeting_id,
                        kind=kind,
                        amount=Money(amount=format_amount(amount), currency=currency),
                        date=local_day(meeting.starts_at, leader.time_zone),
                        meeting_id=meeting.meeting_id,
                        client=client_reference(card, origin, zone)
                        if card is not None
                        else None,
                        meeting_type=MeetingType(meeting.type),
                        with_whom=meeting.with_whom,
                    ),
                )
            )
    if group in (RecordsOperationFilter.ALL, RecordsOperationFilter.RECEIPTS):
        payments = await session.stream(
            _payments(leader.account_id, period)
            .add_columns(ClientCard, Nullable(Account.time_zone))
            .outerjoin(Account, Account.account_id == ClientCard.linked_account_id)
        )
        async for payment, card, zone in payments:
            items.append(
                (
                    payment.created_at,
                    RecordsOperation(
                        id=payment.balance_operation_id,
                        kind=RecordsOperationKind.PAYMENT,
                        amount=Money(
                            amount=format_amount(payment.amount),
                            currency=Currency(payment.currency),
                        ),
                        date=payment.date,
                        meeting_id=None,
                        client=client_reference(card, origin, zone),
                        meeting_type=None,
                        with_whom=None,
                    ),
                )
            )
    items.sort(key=lambda row: (row[1].date, row[0], row[1].id), reverse=True)
    return RecordsOperationList(items=[item for _, item in items])


def completed_log_meetings(
    leader_id: UUID, log: RecordsHoursLogType
) -> Select[Meeting, ClientCard | None, str | None]:
    # spec:impl hours-log#fill-practice-log-client-sessions
    # spec:impl hours-log#count-meeting-not-taken-place-status
    # spec:impl meeting-outcome-recording#count-not-taken-place-meeting-hours-log
    # spec:impl hours-log#count-attended-meetings-leader-attendee
    # spec:impl hours-log#keep-hours-archived-clients-totals
    # spec:impl hours-log#change-hours-counted-client-archived
    return owned_meeting_rows(leader_id).where(
        Meeting.status == MeetingStatus.COMPLETED.value,
        Meeting.type.in_([kind.value for kind in LOG_TYPES[log]]),
    )


async def hours_log(
    session: AsyncSession,
    leader: Account,
    period: RecordsPeriod,
    log: RecordsHoursLogType,
    origin: str,
) -> RecordsHoursLog:
    meetings = completed_log_meetings(leader.account_id, log)
    minutes_expression = counted_minutes()
    # spec:impl hours-log#show-total-large-type-log
    all_time_total = (
        meetings.with_only_columns(
            type_coerce(func.coalesce(func.sum(minutes_expression), 0), BigInteger())
        )
        .correlate(None)
        .scalar_subquery()
    )
    all_time = period.kind == RecordsPeriodKind.ALL
    rows = await session.stream(
        meetings.add_columns(
            minutes_expression, literal(0) if all_time else all_time_total
        )
        .where(*meeting_window(period, leader.time_zone))
        .order_by(Meeting.starts_at.desc(), Meeting.meeting_id.desc())
    )
    items: list[RecordsHoursMeeting] = []
    period_minutes = paid = total = 0
    is_practice = log == RecordsHoursLogType.PRACTICE
    async for meeting, card, zone, minutes, total in rows:
        period_minutes += minutes
        payment_type = (
            PaymentType(meeting.payment_type)
            if meeting.payment_type is not None
            else None
        )
        # spec:impl hours-log#count-client-session-payment-type
        # spec:impl hours-log#count-completed-mutual-practice-meeting-pro-bono
        if payment_type in (PaymentType.PAID, PaymentType.BARTER):
            paid += minutes
        # spec:impl hours-log#count-completed-meeting-longer-24-hours
        items.append(
            RecordsHoursMeeting(
                id=meeting.meeting_id,
                date=local_day(meeting.starts_at, leader.time_zone),
                meeting_type=MeetingType(meeting.type),
                client=client_reference(card, origin, zone)
                if card is not None
                else None,
                with_whom=meeting.with_whom,
                hours=_hours(minutes),
                payment_type=payment_type,
            )
        )
    if all_time:
        total = period_minutes
    elif not items:
        total = await session.scalar(select(all_time_total)) or 0
    # spec:impl hours-log#update-totals-breakdown-list-immediately
    return RecordsHoursLog(
        total_hours=_hours(total),
        period_hours=_hours(period_minutes),
        breakdown=RecordsHoursBreakdown(
            paid=_hours(paid) if is_practice else None,
            pro_bono=_hours(period_minutes - paid) if is_practice else None,
            individual=_hours(period_minutes),
        ),
        items=items,
    )


async def balances(
    session: AsyncSession, leader: Account, today: date, origin: str
) -> RecordsBalanceList:
    rows = await _nonzero_balances(session, leader.account_id, today)
    # spec:impl accounting-summary#open-prepaid-debts-tile-screen-title
    rows.sort(
        key=lambda row: (
            row[1] > 0,
            -abs(row[1]),
            row[0].name.casefold(),
            row[0].client_card_id,
        )
    )
    return RecordsBalanceList(
        items=[
            RecordsBalanceItem(
                client=client_reference(card, origin, zone),
                balance=balance_summary(card, amount),
            )
            for card, amount, zone in rows
        ]
    )
