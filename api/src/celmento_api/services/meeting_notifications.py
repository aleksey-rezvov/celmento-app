from datetime import UTC, datetime
from logging import Logger, getLogger
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.contour import current_contour, web_url
from celmento_api.emails import EmailTemplate, PreparedEmail
from celmento_api.models.account import Account
from celmento_api.models.client_card import ClientCard
from celmento_api.models.enums import Language, MeetingPlace, NoticeKey, NoticeTab
from celmento_api.models.meeting import Meeting
from celmento_api.services.accounts import leader_contact, leader_record
from celmento_api.services.notices import raise_notice

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
logger: Logger = getLogger(__name__)


def _date_and_time(
    instant: datetime, zone: ZoneInfo, language: Language
) -> tuple[str, str]:
    # spec:impl transactional-email#show-date-time-email-recipient
    local = instant.astimezone(zone)
    return f"{local.day} {MONTHS[language][local.month - 1]}", f"{local:%H:%M}"


async def prepare_meeting_notification(
    session: AsyncSession,
    leader: Account,
    card: ClientCard,
    meeting: Meeting,
    *,
    previous_starts_at: datetime | None = None,
) -> PreparedEmail | None:
    # spec:impl client-meeting-notifications#compose-notification-rescheduled
    specialist_name = " ".join(f"{leader.first_name} {leader.last_name}".split())
    notice_params = {
        "starts_at": meeting.starts_at.astimezone(UTC).isoformat(),
        "specialist_name": specialist_name,
    }
    if previous_starts_at is None:
        # spec:impl client-meeting-notifications#use-cancelled-meeting-date-time
        key = NoticeKey.CANCELLED
        template = EmailTemplate.MEETING_CANCELLED
    else:
        # spec:impl client-meeting-notifications#use-rescheduled-previous-new-date
        key = NoticeKey.RESCHEDULED
        template = EmailTemplate.MEETING_RESCHEDULED
        notice_params["previous_starts_at"] = previous_starts_at.astimezone(
            UTC
        ).isoformat()

    linked_id = card.linked_account_id
    # spec:impl client-meeting-notifications#show-notification-bar-meetings-tab
    # spec:impl in-app-notice-bar#produce-bars-rescheduled-cancelled
    if linked_id is not None:
        await raise_notice(session, linked_id, NoticeTab.MEETINGS, key, notice_params)

    # spec:impl client-meeting-notifications#use-channels-card-self-given-email
    # spec:impl client-meeting-notifications#send-notification-email
    # spec:impl client-meeting-notifications#send-email-linked-attendee-account
    # spec:impl client-meeting-notifications#send-anything-reference-contacts-leader
    # spec:impl client-meeting-notifications#send-anything-client-card-self-given
    # spec:impl transactional-email#address-reschedule-cancellation-notices
    recipient = card.self_given_email
    if recipient is None:
        return None

    language_code = card.guest_language or leader.language
    zone_name = card.guest_time_zone or leader.time_zone
    if linked_id is not None:
        linked = (
            await session.execute(
                select(Account.language, Account.time_zone).where(
                    Account.account_id == linked_id
                )
            )
        ).one_or_none()
        if linked is not None:
            language_code, linked_zone = linked
            if card.guest_time_zone is None:
                zone_name = linked_zone

    language = Language(language_code)
    zone = ZoneInfo(zone_name)
    city = zone_name.rsplit("/", 1)[-1].replace("_", " ")
    if language == Language.RU:
        city = RUSSIAN_CITY_NAMES.get(zone_name, city)

    profile = await leader_record(session, leader.account_id)
    contact = leader_contact(leader, profile, profile.main_channel)
    query = urlencode({"email": recipient})
    email_params = {
        "city": city,
        "specialist_name": specialist_name,
        "specialist_contact": (contact or "").strip(),
        "open_app_url": f"{web_url(current_contour())}/login?{query}",
    }
    try:
        # spec:impl client-meeting-notifications#fill-date-time-placeholders-recipient
        date, time = _date_and_time(meeting.starts_at, zone, language)
        if previous_starts_at is None:
            email_params.update(date=date, time=time)
        else:
            old_date, old_time = _date_and_time(previous_starts_at, zone, language)
            email_params.update(
                old_date=old_date,
                old_time=old_time,
                new_date=date,
                new_time=time,
                meeting_link=(meeting.meeting_link or "")
                if meeting.place == MeetingPlace.ONLINE.value
                else "",
            )
    except OverflowError:
        logger.warning("Transactional email time outside supported range")
        return None
    return PreparedEmail(recipient, template, language, email_params)
