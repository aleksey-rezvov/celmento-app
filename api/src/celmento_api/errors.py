from collections.abc import Sequence
from typing import cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from celmento_api.models.enums import ErrorCode


class AppError(Exception):
    status_code: int
    code: ErrorCode
    details: dict[str, object] | None

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(code.value)
        self.status_code = status_code
        self.code = code
        self.details = details


class Error(BaseModel):
    code: ErrorCode
    message: str
    details: dict[str, object] | None = None


class ValidationErrorDetail(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class HTTPValidationError(BaseModel):
    detail: list[ValidationErrorDetail]


def error_responses(*statuses: int) -> dict[int | str, dict[str, object]]:
    return {
        status: {"model": HTTPValidationError if status == 422 else Error}
        for status in statuses
    }


def invalid_request_value(source: str, field: str) -> RequestValidationError:
    return RequestValidationError([{"loc": (source, field), "type": "value_error"}])


def _request_location(location: object) -> list[str | int]:
    # Validation locations below the request source can contain submitted map keys.
    if not isinstance(location, (list, tuple)) or not location:
        return []
    source = cast(Sequence[object], location)[0]
    if isinstance(source, str) and source in {
        "body",
        "query",
        "path",
        "header",
        "cookie",
    }:
        return [source]
    return []


def install_error_handlers(api: FastAPI) -> None:
    @api.exception_handler(AppError)
    async def app_error(_request: Request, exc: AppError) -> JSONResponse:
        body = Error(
            code=exc.code,
            message=exc.code.value.replace("_", " ").capitalize(),
            details=exc.details,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=body.model_dump(mode="json", exclude_none=True),
        )

    @api.exception_handler(Exception)
    async def unexpected_error(_request: Request, _exc: Exception) -> JSONResponse:
        body = Error(code=ErrorCode.INTERNAL_ERROR, message="Internal error")
        return JSONResponse(
            status_code=500, content=body.model_dump(mode="json", exclude_none=True)
        )

    @api.exception_handler(RequestValidationError)
    async def request_validation_error(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        detail: list[ValidationErrorDetail] = []
        for error in exc.errors():
            error_type: object = error.get("type")
            detail.append(
                ValidationErrorDetail(
                    loc=_request_location(error.get("loc")),
                    msg="Invalid request value",
                    type=error_type
                    if isinstance(error_type, str)
                    else "validation_error",
                )
            )
        body = HTTPValidationError(detail=detail)
        return JSONResponse(status_code=422, content=body.model_dump(mode="json"))
