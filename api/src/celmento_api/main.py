from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from celmento_api.config import API_PREFIX, Settings, get_settings
from celmento_api.contour import web_url
from celmento_api.db import engine
from celmento_api.errors import install_error_handlers
from celmento_api.models.enums import Contour
from celmento_api.routers import (
    account,
    admin,
    auth,
    balance,
    clients,
    documents,
    feedback,
    meetings,
    notes,
    notices,
    plans,
    public,
    records,
    specialists,
)

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
    openapi_tags=[
        {"name": "account"},
        {"name": "admin"},
        {"name": "auth"},
        {"name": "balance"},
        {"name": "clients"},
        {"name": "documents"},
        {"name": "feedback"},
        {"name": "meetings"},
        {"name": "notes"},
        {"name": "notices"},
        {"name": "plans"},
        {"name": "public"},
        {"name": "records"},
        {"name": "specialists"},
    ],
)
api.openapi_version = "3.1.1"
install_error_handlers(api)
api.include_router(account.router)
api.include_router(admin.router)
api.include_router(auth.router)
api.include_router(balance.router)
api.include_router(clients.router)
api.include_router(documents.router)
api.include_router(feedback.router)
api.include_router(meetings.router)
api.include_router(notes.router)
api.include_router(notes.folders_router)
api.include_router(notices.router)
api.include_router(plans.router)
api.include_router(public.router)
api.include_router(records.router)
api.include_router(specialists.router)

app: FastAPI = FastAPI(
    openapi_url=None,
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[web_url(Contour.RU), web_url(Contour.WORLD)],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    expose_headers=["Content-Disposition"],
)
app.mount(API_PREFIX, api)
app.mount(
    "/media", StaticFiles(directory=settings.media_dir, check_dir=False), name="media"
)
