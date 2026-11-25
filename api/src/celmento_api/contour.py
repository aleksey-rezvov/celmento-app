from urllib.parse import quote

from celmento_api.config import API_PREFIX, get_settings
from celmento_api.models.enums import Contour


def current_contour() -> Contour:
    return get_settings().contour


def web_url(contour: Contour) -> str:
    settings = get_settings()
    origin = settings.web_url_ru if contour == Contour.RU else settings.web_url_world
    return origin.rstrip("/")


def address_url(login: str) -> str:
    return f"{web_url(current_contour())}/{quote(login, safe='')}"


def public_api_base_url() -> str:
    settings = get_settings()
    configured = settings.public_api_url
    if configured is None:
        return f"{web_url(settings.contour)}{API_PREFIX}"
    return f"{str(configured).rstrip('/').removesuffix(API_PREFIX)}{API_PREFIX}"
