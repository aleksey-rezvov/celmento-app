from datetime import UTC, datetime

from celmento_api.contour import current_contour
from celmento_api.models.account import Account
from celmento_api.models.enums import Contour, Language, MeetingPlace
from celmento_api.models.meeting import Meeting
from celmento_api.services.schedule import planned_end

LINE_BYTES: int = 75
SEP: str = "\r\n"


def _time(instant: datetime) -> str:
    utc = instant.astimezone(UTC)
    return f"{utc.year:04d}{utc:%m%dT%H%M%SZ}"


def _text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    chunks: list[str] = []
    current: list[str] = []
    count = 0
    for char in line:
        size = len(char.encode("utf-8"))
        if count + size > LINE_BYTES:
            chunks.append("".join(current))
            current = [" "]
            count = 1
        current.append(char)
        count += size
    chunks.append("".join(current))
    return SEP.join(chunks)


def calendar_event(meeting: Meeting, leader: Account, language: Language) -> str:
    name = f"{leader.first_name} {leader.last_name}"
    summary = f"Встреча с {name}" if language == Language.RU else f"Session with {name}"
    domain = "celmento.ru" if current_contour() == Contour.RU else "celmento.com"
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//celmēnto//Session calendar//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:{meeting.meeting_id}@{domain}",
        f"DTSTAMP:{_time(meeting.updated_at)}",
        f"DTSTART:{_time(meeting.starts_at)}",
        f"DTEND:{_time(planned_end(meeting))}",
        f"SUMMARY:{_text(summary)}",
    ]
    if meeting.place == MeetingPlace.ONLINE.value and meeting.meeting_link is not None:
        lines.append(f"DESCRIPTION:{_text(meeting.meeting_link)}")
    if meeting.place == MeetingPlace.IN_PERSON.value and meeting.address is not None:
        lines.append(f"LOCATION:{_text(meeting.address)}")
    lines.extend(("END:VEVENT", "END:VCALENDAR"))
    return SEP.join(_fold(line) for line in lines) + SEP
