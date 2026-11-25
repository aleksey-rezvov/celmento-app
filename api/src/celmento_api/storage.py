from asyncio import CancelledError, create_task, shield, to_thread
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from logging import Logger, getLogger
from pathlib import Path
from re import Pattern, compile
from uuid import UUID, uuid7

from fastapi import Request, UploadFile
from fastapi.exceptions import RequestValidationError

from celmento_api.config import API_PREFIX, get_settings

MAX_PHOTO_BYTES: int = 5 * 1024 * 1024
PHOTO_KEY: Pattern[str] = compile(r"[0-9a-f-]{36}\.(jpg|png|webp)")
PNG_HEADER: bytes = b"\x89PNG\r\n\x1a\n"
PNG_END: bytes = b"\x00\x00\x00\x00IEND\xaeB\x60\x82"
PHOTO_CONTENT_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
logger: Logger = getLogger(__name__)


def media_origin(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def photo_url(key: str | None, origin: str) -> str | None:
    if key is None:
        return None
    _validate_key(key)
    return f"{origin}/media/{key}"


def client_photo_directory() -> Path:
    public_directory = get_settings().media_dir
    return public_directory.with_name(f"{public_directory.name}-clients")


def client_photo_version(key: str) -> UUID:
    _validate_key(key)
    return UUID(key.partition(".")[0])


def client_photo_url(client_id: UUID, key: str | None, origin: str) -> str | None:
    if key is None:
        return None
    version = client_photo_version(key)
    return f"{origin}{API_PREFIX}/clients/{client_id}/photo?version={version}"


async def read_client_photo(key: str) -> tuple[bytes, str]:
    path = _path(key, client_photo_directory())
    return await to_thread(path.read_bytes), PHOTO_CONTENT_TYPES[path.suffix]


def _validate_key(key: str) -> None:
    if PHOTO_KEY.fullmatch(key) is None:
        raise ValueError("Invalid stored photo key")


def _path(key: str, directory: Path | None) -> Path:
    _validate_key(key)
    return (directory if directory is not None else get_settings().media_dir) / key


def _image_extension(content: bytes, content_type: str | None) -> str:
    if (
        content_type == "image/jpeg"
        and len(content) > 5
        and content.startswith(b"\xff\xd8\xff")
        and content.endswith(b"\xff\xd9")
    ):
        return "jpg"
    if (
        content_type == "image/png"
        and len(content) > len(PNG_HEADER) + len(PNG_END)
        and content.startswith(PNG_HEADER)
        and content.endswith(PNG_END)
    ):
        return "png"
    if (
        content_type == "image/webp"
        and len(content) >= 20
        and content.startswith(b"RIFF")
        and content[8:12] == b"WEBP"
        and int.from_bytes(content[4:8], "little") == len(content) - 8
    ):
        return "webp"
    raise RequestValidationError([{"loc": ("body", "file"), "type": "image_invalid"}])


def _write_photo(path: Path, content: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    photo = path.open("xb")
    try:
        with photo:
            photo.write(content)
    except OSError:
        path.unlink(missing_ok=True)
        raise


async def save_photo(upload: UploadFile, directory: Path | None = None) -> str:
    content = await upload.read(MAX_PHOTO_BYTES + 1)
    if len(content) > MAX_PHOTO_BYTES:
        raise RequestValidationError(
            [{"loc": ("body", "file"), "type": "image_too_large"}]
        )
    extension = _image_extension(content, upload.content_type)
    key = f"{uuid7()}.{extension}"
    write = create_task(to_thread(_write_photo, _path(key, directory), content))
    try:
        await shield(write)
    except CancelledError:
        try:
            await write
        finally:
            await discard_photo(key, directory)
        raise
    return key


async def discard_photo(key: str | None, directory: Path | None = None) -> None:
    if key is None:
        return
    try:
        await to_thread(_path(key, directory).unlink, missing_ok=True)
    except OSError:
        logger.warning("Could not remove an unreferenced photo")


@asynccontextmanager
async def staged_photo(
    upload: UploadFile, directory: Path | None = None
) -> AsyncGenerator[str]:
    key = await save_photo(upload, directory)
    try:
        yield key
    except BaseException:
        await discard_photo(key, directory)
        raise
