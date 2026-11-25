from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from celmento_api.models.enums import Language

MONTHS: dict[Language, tuple[str, ...]] = {
    Language.EN: (
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ),
    Language.RU: (
        "января",
        "февраля",
        "марта",
        "апреля",
        "мая",
        "июня",
        "июля",
        "августа",
        "сентября",
        "октября",
        "ноября",
        "декабря",
    ),
}
RUSSIAN_CITY_NAMES: dict[str, str] = {
    "Europe/Belgrade": "Белград",
    "Europe/Moscow": "Москва",
}


@dataclass(frozen=True, slots=True)
class EmailDate:
    date: str
    time: str
    city: str
    offset: str


def local_email_date(
    instant: datetime, zone_name: str, language: Language
) -> EmailDate:
    # spec:impl transactional-email#show-date-time-email-recipient
    local = instant.astimezone(ZoneInfo(zone_name))
    city = zone_name.rsplit("/", 1)[-1].replace("_", " ")
    if language == Language.RU:
        city = RUSSIAN_CITY_NAMES.get(zone_name, city)
    offset = local.utcoffset() or timedelta()
    minutes = int(offset.total_seconds() / 60)
    hours, extra_minutes = divmod(abs(minutes), 60)
    sign = "-" if minutes < 0 else "+"
    utc_offset = f"UTC{sign}{hours}"
    if extra_minutes:
        utc_offset += f":{extra_minutes:02}"
    return EmailDate(
        date=f"{local.day} {MONTHS[language][local.month - 1]}",
        time=f"{local:%H:%M}",
        city=city,
        offset=utc_offset,
    )
