import csv
from dataclasses import dataclass
from datetime import date
from functools import cache
from io import StringIO
from pathlib import Path
from unicodedata import category, normalize
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only

from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import (
    Language,
    MeetingType,
    PaymentType,
    RecordsHoursExportFormat,
    RecordsHoursLogType,
)
from celmento_api.models.meeting import Meeting
from celmento_api.schemas.money import format_amount
from celmento_api.schemas.records import RecordsPeriod
from celmento_api.services.records import (
    completed_log_meetings,
    counted_minutes,
    decimal_hours,
    meeting_window,
)
from celmento_api.services.schedule import local_day

CONTENT: Path = Path(__file__).resolve().parents[1] / "content"
ICF_COLUMNS: tuple[str, ...] = (
    "Client Name",
    "Contact Information",
    "Individual/Group",
    "Number in Group",
    "Start Date",
    "End Date",
    "Paid Hours",
    "Pro-bono Hours",
)


class ExportLabels(BaseModel):
    practice_columns: tuple[str, ...]
    service_columns: tuple[str, ...]
    individual: str
    payment: dict[PaymentType, str]


@cache
def _labels(language: Language) -> ExportLabels:
    return ExportLabels.model_validate_json(
        (CONTENT / f"records-export.{language.value}.json").read_text(encoding="utf-8")
    )


@dataclass
class _ClientHours:
    name: str
    contact: str
    first: date
    last: date
    paid_minutes: int = 0
    pro_bono_minutes: int = 0


def _cell(text: str) -> str:
    leading = next(
        (ch for ch in text if not ch.isspace() and category(ch) not in {"Cc", "Cf"}),
        "",
    )
    # spec:impl records-hours-export#spreadsheet-safe
    if text.startswith(("\t", "\r", "\n")) or normalize("NFKC", leading) in {
        "=",
        "+",
        "-",
        "@",
    }:
        return "'" + text
    return text


def _contact(card: ClientCard) -> str:
    # spec:impl records-hours-export#icf-client-contact-and-archive
    return card.self_given_email or card.email or card.phone or ""


def _add_client_hours(
    clients: dict[UUID, _ClientHours],
    card: ClientCard,
    day: date,
    minutes: int,
    payment: PaymentType | None,
) -> None:
    entry = clients.get(card.client_card_id)
    if entry is None:
        entry = _ClientHours(card.name, _contact(card), day, day)
        clients[card.client_card_id] = entry
    # spec:impl records-hours-export#icf-layout-aggregation
    entry.first = min(entry.first, day)
    entry.last = max(entry.last, day)
    if payment == PaymentType.PRO_BONO:
        entry.pro_bono_minutes += minutes
    elif payment in (PaymentType.PAID, PaymentType.BARTER):
        entry.paid_minutes += minutes


def _practice_row(
    meeting: Meeting,
    card: ClientCard | None,
    day: date,
    minutes: int,
    labels: ExportLabels,
) -> tuple[str, ...]:
    payment = (
        PaymentType(meeting.payment_type)
        if meeting.payment_type is not None
        else PaymentType.PRO_BONO
    )
    # spec:impl records-hours-export#sessions-layout
    return (
        day.isoformat(),
        card.name if card is not None else meeting.with_whom or "",
        _contact(card) if card is not None else "",
        labels.individual,
        "1",
        str(decimal_hours(minutes)),
        labels.payment[payment],
        format_amount(meeting.price) if meeting.price is not None else "",
        meeting.currency or "",
    )


def _service_row(
    meeting: Meeting, day: date, minutes: int, number: int
) -> tuple[str, ...]:
    # spec:impl records-hours-export#other-logs-layout
    return (
        str(number),
        day.isoformat(),
        meeting.topic or "",
        str(decimal_hours(minutes)),
        meeting.meeting_link or "",
        format_amount(meeting.price) if meeting.price is not None else "",
        meeting.currency or "",
        meeting.with_whom or "",
    )


async def hours_export_csv(
    session: AsyncSession,
    leader: Account,
    period: RecordsPeriod,
    log: RecordsHoursLogType,
    export_format: RecordsHoursExportFormat,
) -> bytes:
    # spec:impl records-hours-export#period-completed-ownership
    # spec:impl records-hours-export#private-fields-excluded
    rows = await session.stream(
        completed_log_meetings(leader.account_id, log)
        .add_columns(counted_minutes())
        .where(*meeting_window(period, leader.time_zone))
        .options(
            load_only(
                Meeting.type,
                Meeting.starts_at,
                Meeting.payment_type,
                Meeting.with_whom,
                Meeting.price,
                Meeting.currency,
                Meeting.topic,
                Meeting.meeting_link,
                raiseload=True,
            ),
            load_only(
                ClientCard.name,
                ClientCard.email,
                ClientCard.self_given_email,
                ClientCard.phone,
                raiseload=True,
            ),
        )
        .order_by(Meeting.starts_at.desc(), Meeting.meeting_id.desc())
    )
    with StringIO(newline="") as file:
        writer = csv.writer(file)
        if export_format == RecordsHoursExportFormat.ICF:
            writer.writerow(ICF_COLUMNS)
            clients: dict[UUID, _ClientHours] = {}
            async for meeting, card, _, minutes in rows:
                if (
                    meeting.type == MeetingType.CLIENT_SESSION.value
                    and card is not None
                ):
                    _add_client_hours(
                        clients,
                        card,
                        local_day(meeting.starts_at, leader.time_zone),
                        minutes,
                        PaymentType(meeting.payment_type)
                        if meeting.payment_type is not None
                        else None,
                    )
            for entry in clients.values():
                writer.writerow(
                    (
                        _cell(entry.name),
                        _cell(entry.contact),
                        "Individual",
                        "1",
                        entry.first.isoformat(),
                        entry.last.isoformat(),
                        str(decimal_hours(entry.paid_minutes)),
                        str(decimal_hours(entry.pro_bono_minutes)),
                    )
                )
        else:
            labels = _labels(Language(leader.language))
            is_practice = log == RecordsHoursLogType.PRACTICE
            writer.writerow(
                labels.practice_columns if is_practice else labels.service_columns
            )
            number = 0
            async for meeting, card, _, minutes in rows:
                day = local_day(meeting.starts_at, leader.time_zone)
                number += 1
                values = (
                    _practice_row(meeting, card, day, minutes, labels)
                    if is_practice
                    else _service_row(meeting, day, minutes, number)
                )
                writer.writerow(_cell(value) for value in values)
        return file.getvalue().encode("utf-8-sig")
