from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from celmento_api.config import Settings, get_settings
from celmento_api.contour import web_url
from celmento_api.db import engine
from celmento_api.errors import install_error_handlers
from celmento_api.models.enums import Contour
from celmento_api.routers import auth, documents

API_PREFIX: str = "/api/v1"
settings: Settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    try:
        yield
    finally:
        await engine.dispose()


api: FastAPI = FastAPI(
    title="celmēnto API",
    version="0.1.0",
    license_info={"name": "MIT", "identifier": "MIT"},
    servers=[{"url": API_PREFIX}],
    root_path_in_servers=False,
    openapi_tags=[{"name": "auth"}, {"name": "documents"}],
)
api.openapi_version = "3.1.1"
install_error_handlers(api)
api.include_router(auth.router)
api.include_router(documents.router)

app: FastAPI = FastAPI(
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[web_url(Contour.RU), web_url(Contour.WORLD)],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)
app.mount(API_PREFIX, api)
app.mount(
    "/media", StaticFiles(directory=settings.media_dir, check_dir=False), name="media"
)
