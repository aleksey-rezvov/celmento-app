from collections.abc import Callable
from contextlib import AbstractAsyncContextManager

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from celmento_api.config import Settings
from celmento_api.contour import address_url, current_contour
from celmento_api.errors import (
    AppError,
    Error,
    HTTPValidationError,
    install_error_handlers,
)
from celmento_api.models.enums import Contour, ErrorCode


def test_address_uses_the_current_contour(contour_settings: Settings) -> None:
    assert current_contour() == contour_settings.contour
    origin = (
        contour_settings.web_url_ru
        if contour_settings.contour == Contour.RU
        else contour_settings.web_url_world
    )
    assert address_url("example") == f"{origin.rstrip('/')}/example"


async def test_session_rolls_back_even_after_application_commit(
    database_connection: AsyncConnection,
    rollback_session: Callable[[], AbstractAsyncContextManager[AsyncSession]],
) -> None:
    async with rollback_session() as session:
        assert (
            await session.scalar(text("SELECT current_database()"))
            == "celmento_app_test"
        )
        await session.execute(
            text("CREATE TEMP TABLE celmento_transaction_probe (number int)")
        )
        await session.execute(
            text("INSERT INTO celmento_transaction_probe VALUES (42)")
        )
        await session.commit()
        assert (
            await session.scalar(text("SELECT number FROM celmento_transaction_probe"))
            == 42
        )

    temporary_table = await database_connection.scalar(
        text("SELECT to_regclass('pg_temp.celmento_transaction_probe')"),
    )
    assert temporary_table is None


async def test_request_validation_omits_submitted_keys_and_values() -> None:
    test_api = FastAPI()
    install_error_handlers(test_api)

    @test_api.post("/validation-probe")
    def validation_probe(data: dict[str, int]) -> None:
        raise AssertionError(f"Unexpected valid input: {len(data)} fields")

    key = "submitted-map-key"
    value = "submitted-secret-value"
    async with AsyncClient(
        transport=ASGITransport(app=test_api),
        base_url="http://celmento.test",
    ) as client:
        response = await client.post("/validation-probe", json={key: value})

    assert response.status_code == 422
    assert key not in response.text
    assert value not in response.text
    error = HTTPValidationError.model_validate_json(response.content)
    assert len(error.detail) == 1
    assert error.detail[0].loc == ["body"]
    assert error.detail[0].type == "int_parsing"


async def test_business_error_returns_the_contract_shape() -> None:
    test_api = FastAPI()
    install_error_handlers(test_api)

    @test_api.get("/business-error-probe")
    def business_error_probe() -> None:
        raise AppError(409, ErrorCode.CONFLICT, {"field": "login"})

    async with AsyncClient(
        transport=ASGITransport(app=test_api),
        base_url="http://celmento.test",
    ) as client:
        response = await client.get("/business-error-probe")

    assert response.status_code == 409
    error = Error.model_validate_json(response.content)
    assert error.code == ErrorCode.CONFLICT
    assert error.message == "Conflict"
    assert error.details == {"field": "login"}
