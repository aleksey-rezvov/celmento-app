from functools import cache
from pathlib import Path
from typing import ClassVar

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from celmento_api.models.enums import Contour

REPOSITORY_ROOT: Path = Path(__file__).resolve().parents[3]
API_PREFIX: str = "/api/v1"


class Settings(BaseSettings):
    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_file=REPOSITORY_ROOT / ".env",
        env_file_encoding="utf-8",
        env_prefix="CLM_APP_",
        extra="ignore",
        hide_input_in_errors=True,
    )

    database_url: SecretStr
    contour: Contour
    web_url_ru: str
    web_url_world: str
    session_secret: SecretStr
    registration_private_key: SecretStr
    registration_public_key_ru: str
    registration_public_key_world: str
    email_api_key: SecretStr = SecretStr("")
    email_from: str
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    media_dir: Path

    @field_validator("media_dir")
    @classmethod
    def resolve_media_dir(cls, value: Path) -> Path:
        return REPOSITORY_ROOT / value


@cache
def get_settings() -> Settings:
    return Settings.model_validate({})
