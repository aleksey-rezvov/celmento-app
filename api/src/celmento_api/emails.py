from asyncio import to_thread
from collections.abc import Mapping
from dataclasses import dataclass, field
from email.headerregistry import Address
from email.message import EmailMessage
from enum import StrEnum
from html import escape
from logging import Logger, getLogger
from pathlib import Path
from re import Pattern
from re import compile as compile_pattern
from smtplib import SMTP, SMTPException
from urllib.parse import urlsplit

from celmento_api.config import get_settings
from celmento_api.models.enums import Language

TEMPLATES: Path = Path(__file__).resolve().parent / "content" / "emails"
ACTION_LINE: Pattern[str] = compile_pattern(r"\[([^\]\n]+)\]\(\{([a-z_]+)\}\)")
OPTIONAL_BULLET: Pattern[str] = compile_pattern(r"- [^{\n]+: \{([a-z_]+)\}")
logger: Logger = getLogger(__name__)


class EmailTemplate(StrEnum):
    SIGN_IN_CODE = "sign-in-code"
    BOOKING_CONFIRMATION = "booking-confirmation"
    MEETING_RESCHEDULED = "meeting-rescheduled"
    MEETING_CANCELLED = "meeting-cancelled"


@dataclass(frozen=True, slots=True)
class PreparedEmail:
    recipient: str = field(repr=False)
    template: EmailTemplate
    language: Language
    params: Mapping[str, str] = field(repr=False)

    async def send(self) -> None:
        await send_email(self.recipient, self.template, self.language, self.params)


def _render_body(content: str, params: Mapping[str, str]) -> tuple[str, str]:
    text: list[str] = []
    html: list[str] = []
    for paragraph in content.strip().split("\n\n"):
        # Parse links from the trusted template before inserting user-supplied values.
        action = ACTION_LINE.fullmatch(paragraph)
        if action is not None:
            label = action.group(1)
            url = params[action.group(2)]
            target = urlsplit(url)
            if target.scheme not in ("https", "http") or not target.hostname:
                error = "Invalid transactional email action URL"
                raise ValueError(error)
            text.append(f"{label}: {url}")
            html.append(f'<p><a href="{escape(url)}">{escape(label)}</a></p>')
            continue

        lines: list[str] = []
        for line in paragraph.splitlines():
            bullet = OPTIONAL_BULLET.fullmatch(line)
            if bullet is not None and not params[bullet.group(1)]:
                continue
            lines.append(line)
        if not lines:
            continue

        is_heading = paragraph.startswith("# ")
        tag = "h1" if is_heading else "p"
        rendered = "\n".join(lines).removeprefix("# ").format_map(params)
        text.append(rendered)
        markup = escape(rendered).replace("\n", "<br>\n")
        html.append(f"<{tag}>{markup}</{tag}>")
    return "\n\n".join(text), "\n".join(html)


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
    text, html = _render_body(content, params)
    message.set_content(text)
    message.add_alternative(html, subtype="html")
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
    try:
        message = _make_message(to, template, language, params)
        await to_thread(_deliver, message)
    except KeyError, OSError, SMTPException, ValueError:
        # spec:impl transactional-email#complete-triggering-action-even-email
        logger.warning("Transactional email handoff failed")
