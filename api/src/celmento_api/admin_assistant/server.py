from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from ipaddress import ip_address
from pathlib import Path
from typing import ClassVar

from httpx import AsyncBaseTransport, AsyncClient
from mcp.server import MCPServer
from pydantic import AnyHttpUrl, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from celmento_api.admin_assistant.api import AdminAPI
from celmento_api.admin_assistant.confirmation import Confirmations
from celmento_api.admin_assistant.tools import AdminAssistant, register_tools
from celmento_api.config import API_PREFIX


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


class AdminAssistantSettings(BaseSettings):
    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_prefix="CLM_APP_", hide_input_in_errors=True
    )

    admin_api_url: AnyHttpUrl
    admin_key: SecretStr

    @field_validator("admin_api_url")
    @classmethod
    def validate_admin_api_url(cls, value: AnyHttpUrl) -> AnyHttpUrl:
        if (
            (value.path or "").rstrip("/") not in ("", API_PREFIX)
            or value.username is not None
            or value.password is not None
            or value.query is not None
            or value.fragment is not None
        ):
            raise ValueError("Expected an administration API origin or its /api/v1 URL")
        if value.scheme != "https" and not _is_loopback(value.host or ""):
            raise ValueError("The administration API requires HTTPS outside loopback")
        return value

    @field_validator("admin_key")
    @classmethod
    def validate_admin_key(cls, value: SecretStr) -> SecretStr:
        key = value.get_secret_value()
        if (
            not key
            or not key.isascii()
            or not key.isprintable()
            or any(character.isspace() for character in key)
        ):
            raise ValueError("Expected an administrator key")
        return value

    @property
    def api_base_url(self) -> str:
        url = str(self.admin_api_url).rstrip("/")
        return f"{url}/" if url.endswith(API_PREFIX) else f"{url}{API_PREFIX}/"


def create_server(
    settings: AdminAssistantSettings, *, transport: AsyncBaseTransport | None = None
) -> MCPServer:
    @asynccontextmanager
    async def lifespan(_server: MCPServer) -> AsyncGenerator[AdminAssistant]:
        # spec:impl admin-ai-assistant#perform-administrative-action-ai
        # spec:impl admin-ai-assistant#return-data-other-contour-combine
        async with AsyncClient(
            base_url=settings.api_base_url,
            headers={"X-Admin-Key": settings.admin_key.get_secret_value()},
            timeout=10.0,
            trust_env=False,
            transport=transport,
        ) as client:
            yield AdminAssistant(api=AdminAPI(client), confirmations=Confirmations())

    # spec:impl admin-ai-assistant#answer-request-specific-user-private
    # spec:impl admin-ai-assistant#answer-request-delete-user-account
    server = MCPServer(
        "celmēnto administration",
        instructions=Path(__file__)
        .with_name("instructions.md")
        .read_text(encoding="utf-8"),
        lifespan=lifespan,
        log_level="WARNING",
    )
    register_tools(server)
    return server


def main() -> None:
    try:
        settings = AdminAssistantSettings.model_validate({})
    except ValidationError:
        raise SystemExit(
            "Set CLM_APP_ADMIN_API_URL and CLM_APP_ADMIN_KEY for one contour."
        ) from None
    create_server(settings).run(transport="stdio")
