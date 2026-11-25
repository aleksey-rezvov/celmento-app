from asyncio import to_thread
from collections.abc import Mapping
from email.headerregistry import Address
from email.message import EmailMessage
from enum import StrEnum
from html import escape
from logging import Logger, getLogger
from pathlib import Path
from smtplib import SMTP, SMTPException

from celmento_api.config import get_settings
from celmento_api.models.enums import Language

TEMPLATES: Path = Path(__file__).resolve().parent / "content" / "emails"
logger: Logger = getLogger(__name__)


class EmailTemplate(StrEnum):
    SIGN_IN_CODE = "sign-in-code"
    BOOKING_CONFIRMATION = "booking-confirmation"
    MEETING_RESCHEDULED = "meeting-rescheduled"
    MEETING_CANCELLED = "meeting-cancelled"


def _make_message(
    recipient: str,
    template: EmailTemplate,
    language: Language,
    params: Mapping[str, str],
) -> EmailMessage:
    # spec:impl transactional-email#render-emails-ru-en-templates
    source = (TEMPLATES / f"{template.value}.{language.value}.md").read_text(
        encoding="utf-8"
    )
    heading, _, content = source.partition("\n\n")
    message = EmailMessage()
    settings = get_settings()
    message["From"] = Address(display_name="celmēnto", addr_spec=settings.email_from)
    message["To"] = recipient
    message["Subject"] = heading.removeprefix("subject: ").format_map(params)
    body = content.format_map(params)
    message.set_content(body.replace("\n# ", "\n"))
    paragraphs: list[str] = []
    for paragraph in body.strip().split("\n\n"):
        if paragraph.startswith("# "):
            paragraphs.append(f"<h1>{escape(paragraph.removeprefix('# '))}</h1>")
        else:
            paragraphs.append(f"<p>{escape(paragraph)}</p>")
    message.add_alternative("\n".join(paragraphs), subtype="html")
    return message


def _deliver(message: EmailMessage) -> None:
    settings = get_settings()
    with SMTP(settings.smtp_host, settings.smtp_port, timeout=5) as smtp:
        smtp.send_message(message)


async def send_email(
    to: str,
    template: EmailTemplate,
    language: Language,
    params: Mapping[str, str],
) -> None:
    message = _make_message(to, template, language, params)
    try:
        await to_thread(_deliver, message)
    except OSError, SMTPException:
        # spec:impl transactional-email#complete-triggering-action-even-email
        logger.warning("Transactional email handoff failed")
