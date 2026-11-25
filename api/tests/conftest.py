from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import ClassVar

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine

from celmento_api.config import Settings, get_settings
from celmento_api.main import app
from celmento_api.models.enums import Contour


class TestDatabaseSettings(BaseSettings):
    model_config: ClassVar[SettingsConfigDict] = Settings.model_config
    test_database_url: SecretStr


@pytest.fixture
async def api_client() -> AsyncGenerator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://celmento.test",
    ) as client:
        yield client


@pytest.fixture(params=list(Contour))
def contour_settings(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
) -> Settings:
    contour: object = request.param
    assert isinstance(contour, Contour)
    settings = get_settings().model_copy(update={"contour": contour})
    monkeypatch.setattr("celmento_api.contour.get_settings", lambda: settings)
    return settings


@pytest.fixture
async def database_connection() -> AsyncGenerator[AsyncConnection]:
    settings = TestDatabaseSettings.model_validate({})
    url = make_url(settings.test_database_url.get_secret_value())
    if url.database != "celmento_app_test":
        pytest.fail("CLM_APP_TEST_DATABASE_URL must target celmento_app_test")
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            yield connection
    finally:
        await engine.dispose()


@pytest.fixture
def rollback_session(
    database_connection: AsyncConnection,
) -> Callable[[], AbstractAsyncContextManager[AsyncSession]]:
    @asynccontextmanager
    async def session_scope() -> AsyncGenerator[AsyncSession]:
        transaction = await database_connection.begin()
        try:
            async with AsyncSession(
                bind=database_connection,
                expire_on_commit=False,
                join_transaction_mode="create_savepoint",
            ) as session:
                yield session
        finally:
            await transaction.rollback()

    return session_scope
