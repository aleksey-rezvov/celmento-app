from asyncio import Barrier, gather, timeout
from base64 import b64decode
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from email.message import EmailMessage
from pathlib import Path
from typing import cast
from uuid import UUID, uuid7

import pytest
from fastapi.staticfiles import StaticFiles
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession
from starlette.routing import Mount

from celmento_api import emails, storage
from celmento_api.config import Settings
from celmento_api.db import Base, get_session
from celmento_api.errors import Error
from celmento_api.main import api, app
from celmento_api.models.account import Account, ReservedLoginWord
from celmento_api.models.enums import (
    AcceptanceKind,
    Currency,
    ErrorCode,
    Language,
    LegalDocumentKind,
    LoginAvailabilityStatus,
    NoticeKey,
    NoticeTab,
    SessionFormat,
    Weekday,
)
from celmento_api.models.feedback import FeedbackMessage
from celmento_api.models.leader import LeaderProfile as LeaderRecord
from celmento_api.models.leader import WorkingDay as WorkingDayRecord
from celmento_api.models.legal import Acceptance, LegalDocumentVersion
from celmento_api.schemas.account import Account as AccountView
from celmento_api.schemas.account import WorkingDay
from celmento_api.schemas.auth import LoginAvailability, SignInSession
from celmento_api.schemas.notices import NoticeList
from celmento_api.seed import seed
from celmento_api.services import accounts
from celmento_api.services.notices import raise_notice
from celmento_api.services.sessions import issue_session

ORIGIN: str = "http://celmento.test:18001"
ACCOUNT: str = "/api/v1/account"
PHOTO: str = f"{ACCOUNT}/photo"
ACTIVATION: str = f"{ACCOUNT}/activation"
FEEDBACK: str = "/api/v1/feedback"
NOTICES: str = "/api/v1/notices"
PNG: bytes = b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+z1k0AAAAASUVORK5CYII="
)
WEBP: bytes = b64decode(
    "UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAIAAgA0JaQAAudPjMAA/vKT7Wdpsf+Gv/59wDDB/AGDhkgAAA=="
)
JPEG: bytes = b64decode(
    "/9j//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcG"
    "BgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABmAAEBAAAAAAAAAAAAAAAAAAAEBwEBAQAAAAAA"
    "AAAAAAAAAAAABAMQAAICAgIDAQAAAAAAAAAAAAIDAQUEBwYAtXY3IREAAgICAQMFAQAAAAAAAAAAAgMB"
    "BAUABiERErR1sXIzNv/AABEIAAIAAgMBEgACEgADEgD/2gAMAwEAAhEDEQA/AKxreho8nXfDnvq65zW8"
    "dpGNazExzYwzr0ERmZLkiIimZIpmZmf2er1j814V6zReOx+05Rx7AK5Nm1rxOMAAyd8QAadcRERssiBG"
    "IX2iIjpER0jWcs/qc97rkPVM0bMLh75lbt42has2Sl9iw+qhz3ubPmxrWsAjYxhzJGZTJEUzMz31KPwV"
    "9A+I3//Z"
)


@dataclass(slots=True)
class AccountStand:
    client: AsyncClient
    engine: AsyncEngine
    schema: str
    settings: Settings

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession]:
        async with AsyncSession(bind=self.engine, expire_on_commit=False) as session:
            await session.execute(text(f'SET LOCAL search_path TO "{self.schema}"'))
            yield session

    async def add_account(self, login: str) -> SignInSession:
        async with self.session() as session:
            account = Account(
                email=f"{login}@example.com",
                first_name="New",
                last_name="Account",
                login=login,
                language=Language.EN.value,
                time_zone="Europe/Belgrade",
            )
            session.add(account)
            await session.flush()
            signed_in = await issue_session(session, account, ORIGIN)
            await session.commit()
            return signed_in

    async def another_session(self, account_id: UUID) -> SignInSession:
        async with self.session() as session:
            account = await session.get(Account, account_id)
            assert account is not None
            signed_in = await issue_session(session, account, ORIGIN)
            await session.commit()
            return signed_in

    async def consents(self) -> list[dict[str, str]]:
        kinds = (
            LegalDocumentKind.SPECIALIST_OFFER.value,
            LegalDocumentKind.DATA_PROCESSING_INSTRUCTION.value,
        )
        async with self.session() as session:
            records = await session.scalars(
                select(LegalDocumentVersion).where(
                    LegalDocumentVersion.document.in_(kinds)
                )
            )
            consents = [
                {"document": row.document, "version": row.version} for row in records
            ]
        assert len(consents) == 2
        return consents

    async def activate(self, signed_in: SignInSession) -> AccountView:
        return _account(
            await self.client.post(
                ACTIVATION,
                json={"age_confirmed": True, "acceptances": await self.consents()},
                headers=_bearer(signed_in),
            )
        )


@pytest.fixture
async def account_stand(
    database_connection: AsyncConnection,
    contour_settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[AccountStand]:
    schema = f"profile_{uuid7().hex}"
    async with database_connection.begin():
        await database_connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        await database_connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        await database_connection.run_sync(Base.metadata.create_all)

    media_mount = next(
        route
        for route in app.routes
        if isinstance(route, Mount) and route.path == "/media"
    )
    static_app = cast(object, media_mount.app)
    assert isinstance(static_app, StaticFiles)
    media_settings = contour_settings.model_copy(update={"media_dir": tmp_path})
    monkeypatch.setattr(storage, "get_settings", lambda: media_settings)
    monkeypatch.setattr(static_app, "directory", tmp_path)
    monkeypatch.setattr(static_app, "all_directories", [str(tmp_path)])
    monkeypatch.setattr(static_app, "config_checked", False)

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=ORIGIN
        ) as client:
            stand = AccountStand(
                client, database_connection.engine, schema, contour_settings
            )
            async with stand.session() as session:
                await seed(session, draft_documents=True)

            async def scoped_session() -> AsyncGenerator[AsyncSession]:
                async with stand.session() as session:
                    yield session

            api.dependency_overrides[get_session] = scoped_session
            try:
                yield stand
            finally:
                api.dependency_overrides.pop(get_session, None)
    finally:
        async with database_connection.begin():
            await database_connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def _bearer(signed_in: SignInSession) -> dict[str, str]:
    return {"Authorization": f"Bearer {signed_in.token}"}


def _account(response: Response) -> AccountView:
    assert response.status_code == 200
    return AccountView.model_validate_json(response.content)


def _error(response: Response, status: int, code: ErrorCode) -> Error:
    assert response.status_code == status
    error = Error.model_validate_json(response.content)
    assert error.code == code
    return error


def _day_body(day: WorkingDay) -> dict[str, str | bool]:
    return {
        "weekday": day.weekday.value,
        "working": day.working,
        "start": day.start,
        "end": day.end,
    }


# spec:test account-profile#keep-one-record-personal-data
# spec:test account-profile#prefill-first-last-name-registration
# spec:test account-profile#keep-account-signed-app-launches
# spec:test account-profile#delete-change-server-data-sign-out
# spec:test booking-link-login#change-login-name-other-account
# spec:test interface-language#keep-language-account-change-effect
async def test_profile_changes_are_visible_to_existing_and_new_sessions(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    signed_in = await account_stand.add_account("editor")
    headers = _bearer(signed_in)
    original = signed_in.account
    _error(await client.get(ACCOUNT), 401, ErrorCode.UNAUTHORIZED)
    assert _account(await client.get(ACCOUNT, headers=headers)) == original
    assert original.contour == account_stand.settings.contour
    assert original.leader is None and original.photo_url is None

    for invalid in (
        {"first_name": "   "},
        {"last_name": "X" * 101},
        {"first_name": None},
        {"time_zone": "Not/A_Zone"},
        {"email": "another@example.com"},
        {"contour": "ru"},
        {"activated": True},
        {"leader": None},
    ):
        assert (
            await client.patch(ACCOUNT, json=invalid, headers=headers)
        ).status_code == 422
    _error(
        await client.patch(ACCOUNT, json={"leader": {}}, headers=headers),
        403,
        ErrorCode.ACTIVATION_REQUIRED,
    )

    saved = _account(
        await client.patch(
            ACCOUNT,
            json={
                "first_name": "Edited",
                "last_name": "Name",
                "phone": "+381111222",
                "telegram": "editor_chat",
                "whatsapp": "+381333444",
                "language": "ru",
                "time_zone": "Europe/Moscow",
            },
            headers=headers,
        )
    )
    assert (saved.first_name, saved.last_name) == ("Edited", "Name")
    assert (saved.phone, saved.telegram, saved.whatsapp) == (
        "+381111222",
        "editor_chat",
        "+381333444",
    )
    assert saved.language == Language.RU and saved.time_zone == "Europe/Moscow"
    assert saved.login == original.login
    assert saved.email == original.email and saved.contour == original.contour
    assert saved.id == original.id

    two = await account_stand.another_session(saved.id)
    partial = _account(
        await client.patch(ACCOUNT, json={"phone": None}, headers=_bearer(two))
    )
    assert partial.phone is None
    assert partial.telegram == saved.telegram and partial.time_zone == saved.time_zone
    assert (
        await client.post("/api/v1/auth/sign-out", headers=headers)
    ).status_code == 204
    _error(await client.get(ACCOUNT, headers=headers), 401, ErrorCode.UNAUTHORIZED)
    assert _account(await client.get(ACCOUNT, headers=_bearer(two))) == partial
    assert (await account_stand.another_session(saved.id)).account == partial

    async with account_stand.session() as session:
        assert await session.scalar(select(func.count()).select_from(Account)) == 1


# spec:test client-leading-activation#turn-activation-person-confirms
# spec:test client-leading-activation#offer-control-request-turns-activation
# spec:test legal-documents#store-account-activation-18-confirmation
# spec:test account-profile#show-contacts-fields-phone-telegram
# spec:test default-rate-currency#leave-price-empty-new-leader
# spec:test working-hours-booking-rules#give-new-leader-monday-friday
async def test_activation_validates_current_consents_and_applies_once(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    signed_in = await account_stand.add_account("activate")
    headers = _bearer(signed_in)
    consents = await account_stand.consents()
    confirmed = {"age_confirmed": True, "acceptances": consents}
    for invalid in (
        {**confirmed, "age_confirmed": False},
        {**confirmed, "acceptances": consents[:1]},
        {**confirmed, "acceptances": [consents[0], consents[0]]},
        {
            **confirmed,
            "acceptances": [{**consents[0], "version": "retired"}, consents[1]],
        },
    ):
        _error(
            await client.post(ACTIVATION, json=invalid, headers=headers),
            400,
            ErrorCode.CONSENT_REQUIRED,
        )
    assert _account(await client.get(ACCOUNT, headers=headers)) == signed_in.account

    async with timeout(5):
        responses = await gather(
            client.post(ACTIVATION, json=confirmed, headers=headers),
            client.post(ACTIVATION, json=confirmed, headers=headers),
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    _error(
        next(response for response in responses if response.status_code == 409),
        409,
        ErrorCode.ALREADY_ACTIVATED,
    )
    activated = _account(
        next(response for response in responses if response.status_code == 200)
    )
    assert activated.activated and activated.activated_at is not None
    assert {item.kind for item in activated.acceptances} == {
        AcceptanceKind.AGE_CONFIRMATION,
        AcceptanceKind.SPECIALIST_OFFER,
        AcceptanceKind.DATA_PROCESSING_INSTRUCTION,
    }
    assert len(activated.acceptances) == 3
    assert {item.accepted_at for item in activated.acceptances} == {
        activated.activated_at
    }
    assert {
        item.kind.value: item.version
        for item in activated.acceptances
        if item.version is not None
    } == {item["document"]: item["version"] for item in consents}

    profile = activated.leader
    assert profile is not None
    assert profile.contact_email == activated.email
    assert profile.about == "" and profile.links == [] and profile.main_channel is None
    assert profile.default_rate is None and profile.default_currency == Currency.RUB
    assert (
        profile.session_duration_minutes == 60
        and profile.session_format == SessionFormat.ONLINE
    )
    assert profile.booking_url == activated.address_url
    assert profile.plan.active_clients == 0 and profile.plan.client_limit == 3
    assert [day.weekday for day in profile.working_hours] == list(Weekday)
    assert [day.working for day in profile.working_hours] == [True] * 5 + [False] * 2
    assert {(day.start, day.end) for day in profile.working_hours} == {
        ("10:00", "18:00")
    }
    assert _account(await client.get(ACCOUNT, headers=headers)) == activated
    async with account_stand.session() as session:
        row = await session.get(LeaderRecord, activated.id)
        assert row is not None
        assert (
            row.session_duration_minutes,
            row.session_format,
            row.default_currency,
        ) == (None, None, None)
        assert (
            await session.scalar(select(func.count()).select_from(WorkingDayRecord))
            == 0
        )
        assert await session.scalar(select(func.count()).select_from(Acceptance)) == 3


# spec:test account-profile#offer-about-field-specialization
# spec:test account-profile#limit-about-text-1000-characters-show
# spec:test default-rate-currency#let-leader-save-profile-work
# spec:test working-hours-booking-rules#allow-one-interval-day-start
# spec:test working-hours-booking-rules#block-save-show
# spec:test working-hours-booking-rules#allow-more-one-working-interval
async def test_leader_updates_store_overrides_and_restore_defaults(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    signed_in = await account_stand.add_account("leader")
    headers = _bearer(signed_in)
    initial = await account_stand.activate(signed_in)
    assert initial.leader is not None
    defaults = [_day_body(day) for day in initial.leader.working_hours]
    off = [{**day, "working": False} for day in defaults]
    profile_fields = {
        "specializations": ["coach", "other"],
        "specialization_other": "Training",
        "about": "а" * 1000,
        "contact_email": "public@example.com",
        "main_channel": "email",
        "links": [f"https://example.com/channel/{number}" for number in range(5)],
        "session_duration_minutes": 45,
        "session_format": "both",
        "default_meeting_link": "https://example.com/call",
        "default_rate": "1234.50",
        "default_currency": "EUR",
        "working_hours": off,
    }
    saved = _account(
        await client.patch(ACCOUNT, json={"leader": profile_fields}, headers=headers)
    )
    assert saved.leader is not None
    assert len(saved.leader.about) == 1000
    assert saved.leader.specializations == ["coach", "other"]
    assert saved.leader.specialization_other == "Training"
    assert saved.leader.main_channel == "email" and len(saved.leader.links) == 5
    assert (
        saved.leader.default_rate == "1234.5"
        and saved.leader.default_currency == Currency.EUR
    )
    assert saved.leader.session_duration_minutes == 45 and not any(
        day.working for day in saved.leader.working_hours
    )
    async with account_stand.session() as session:
        rows = await session.scalars(select(WorkingDayRecord.weekday))
        assert set(rows) == {day.value for day in list(Weekday)[:5]}

    for bad in (
        {"about": "а" * 1001},
        {"specializations": ["coach", "coach"]},
        {"links": ["https://example.com"] * 6},
        {"links": ["invalid-url"]},
        {"default_rate": "-0.01"},
        {"default_rate": "1000000000000000"},
        {"default_rate": "5.501"},
        {"default_currency": "GBP"},
        {"session_duration_minutes": 50},
        {"session_duration_minutes": None},
        {"working_hours": defaults[:6]},
    ):
        assert (
            await client.patch(ACCOUNT, json={"leader": bad}, headers=headers)
        ).status_code == 422

    for bad_days in (
        [{**defaults[0], "start": "10:10"}, *defaults[1:]],
        [{**defaults[0], "end": "09:00"}, *defaults[1:]],
        [defaults[0], defaults[0], *defaults[2:]],
    ):
        error = _error(
            await client.patch(
                ACCOUNT,
                json={
                    "first_name": "Should not persist",
                    "leader": {"working_hours": bad_days},
                },
                headers=headers,
            ),
            400,
            ErrorCode.WORKING_HOURS_INVALID,
        )
        assert error.details == {"weekday": "mon"}
    assert _account(await client.get(ACCOUNT, headers=headers)) == saved

    edited = [{**defaults[0], "start": "10:15"}, *defaults[1:]]
    switched = _account(
        await client.patch(
            ACCOUNT,
            json={
                "phone": "+381111222",
                "leader": {
                    "working_hours": edited,
                    "session_format": "in_person",
                    "contact_email": None,
                    "main_channel": "phone",
                },
            },
            headers=headers,
        )
    )
    assert switched.leader is not None
    assert switched.leader.working_hours[0].start == "10:15"
    assert switched.leader.session_format == SessionFormat.IN_PERSON
    assert switched.leader.default_meeting_link == "https://example.com/call"
    assert switched.leader.main_channel == "phone"
    async with account_stand.session() as session:
        record = await session.get(WorkingDayRecord, (saved.id, "mon"))
        assert record is not None and record.start_time == time(10, 15)
        assert (
            await session.scalar(select(func.count()).select_from(WorkingDayRecord))
            == 1
        )

    restored = _account(
        await client.patch(
            ACCOUNT,
            json={
                "phone": None,
                "leader": {
                    "session_duration_minutes": 60,
                    "session_format": "online",
                    "default_currency": "RUB",
                    "default_rate": None,
                    "working_hours": defaults,
                },
            },
            headers=headers,
        )
    )
    assert restored.leader is not None
    assert (
        restored.leader.main_channel is None and restored.leader.contact_email is None
    )
    assert (
        restored.leader.default_rate is None
        and restored.leader.default_currency == Currency.RUB
    )
    assert (
        restored.leader.session_duration_minutes == 60
        and restored.leader.session_format == SessionFormat.ONLINE
    )
    assert restored.leader.working_hours == initial.leader.working_hours
    async with account_stand.session() as session:
        row = await session.get(LeaderRecord, saved.id)
        assert row is not None
        assert (
            row.session_duration_minutes,
            row.session_format,
            row.default_currency,
        ) == (None, None, None)
        assert (
            await session.scalar(select(func.count()).select_from(WorkingDayRecord))
            == 0
        )


# spec:test booking-link-login#check-login-typed-show-field
# spec:test booking-link-login#check-availability-typed-accounts
# spec:test booking-link-login#treat-anna-rezvova-login-show-login
# spec:test booking-link-login#show-login-forbidden-login-equals
# spec:test booking-link-login#save-login-violates-rule-taken
# spec:test booking-link-login#limit-how-often-login-changed
async def test_login_verdicts_case_insensitive_changes_and_released_names(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    first = await account_stand.add_account("first_login")
    second = await account_stand.add_account("second_login")
    headers = _bearer(first)
    for login, status in (
        ("xy", LoginAvailabilityStatus.RULE_LENGTH),
        ("naïve", LoginAvailabilityStatus.RULE_CHARS),
        ("1valid", LoginAvailabilityStatus.RULE_START),
        ("valid_", LoginAvailabilityStatus.RULE_END),
        ("under__score", LoginAvailabilityStatus.RULE_DOUBLE),
        ("SeCoNd_Login", LoginAvailabilityStatus.TAKEN),
        ("SUPPORT", LoginAvailabilityStatus.RESERVED),
        ("SUPPORT_HELP", LoginAvailabilityStatus.AVAILABLE),
        ("First_Login", LoginAvailabilityStatus.AVAILABLE),
    ):
        response = await client.get(
            f"{ACCOUNT}/login-availability", params={"login": login}, headers=headers
        )
        assert response.status_code == 200
        verdict = LoginAvailability.model_validate_json(response.content)
        assert verdict.login == login.lower()
        assert verdict.status == status

    invalid = _error(
        await client.patch(ACCOUNT, json={"login": "bad_ending_"}, headers=headers),
        400,
        ErrorCode.LOGIN_INVALID,
    )
    assert invalid.details == {"rule": "rule_end"}
    _error(
        await client.patch(ACCOUNT, json={"login": "support"}, headers=headers),
        400,
        ErrorCode.LOGIN_RESERVED,
    )
    _error(
        await client.patch(ACCOUNT, json={"login": "SECOND_LOGIN"}, headers=headers),
        409,
        ErrorCode.LOGIN_TAKEN,
    )
    assert (
        _account(await client.get(ACCOUNT, headers=headers)).login
        == first.account.login
    )

    async with account_stand.session() as session:
        session.add(
            ReservedLoginWord(
                reserved_login_word_id=first.account.login, source="admin"
            )
        )
        await session.commit()
    current = _account(
        await client.patch(ACCOUNT, json={"login": "FIRST_LOGIN"}, headers=headers)
    )
    assert current.login == first.account.login
    for login in ("New_Login", "Next_Login"):
        current = _account(
            await client.patch(ACCOUNT, json={"login": login}, headers=headers)
        )
        assert current.login == login.lower()
        assert current.address_url.endswith(f"/{login.lower()}")
        assert current.id == first.account.id
    released = _account(
        await client.patch(
            ACCOUNT, json={"login": "NEW_LOGIN"}, headers=_bearer(second)
        )
    )
    assert released.login == "new_login"


async def test_concurrent_login_claims_keep_one_update(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = await account_stand.add_account("login_first")
    second = await account_stand.add_account("login_second")
    ready = Barrier(2)
    require_available = accounts.require_available_login

    async def synchronized_check(
        session: AsyncSession, login: str, exclude_account_id: UUID | None = None
    ) -> str:
        result = await require_available(session, login, exclude_account_id)
        await ready.wait()
        return result

    monkeypatch.setattr(accounts, "require_available_login", synchronized_check)
    async with timeout(5):
        responses = await gather(
            account_stand.client.patch(
                ACCOUNT, json={"login": "Contended"}, headers=_bearer(first)
            ),
            account_stand.client.patch(
                ACCOUNT, json={"login": "CONTENDED"}, headers=_bearer(second)
            ),
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    _error(
        next(response for response in responses if response.status_code == 409),
        409,
        ErrorCode.LOGIN_TAKEN,
    )
    async with account_stand.session() as session:
        logins = set(await session.scalars(select(Account.login)))
        assert logins in (
            {"contended", first.account.login},
            {"contended", second.account.login},
        )


# spec:test account-profile#let-account-add-photo-gallery
async def test_photo_upload_replacement_and_removal_are_visible_over_http(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    signed_in = await account_stand.add_account("photouser")
    headers = _bearer(signed_in)
    upload = {"file": ("gallery.png", PNG, "image/png")}
    _error(await client.put(PHOTO, files=upload), 401, ErrorCode.UNAUTHORIZED)
    assert (await client.put(PHOTO, headers=headers)).status_code == 422
    assert (
        await client.put(
            PHOTO,
            headers=headers,
            files={"file": ("wrong.png", b"not an image", "image/png")},
        )
    ).status_code == 422
    assert (
        await client.put(
            PHOTO, headers=headers, files={"file": ("wrong.jpg", PNG, "image/jpeg")}
        )
    ).status_code == 422
    assert (
        await client.put(
            PHOTO,
            headers=headers,
            files={
                "file": ("big.png", b"0" * (storage.MAX_PHOTO_BYTES + 1), "image/png")
            },
        )
    ).status_code == 422
    assert (
        await client.put(
            PHOTO,
            headers=headers,
            files={**upload, "caption": ("note.txt", b"extra", "text/plain")},
        )
    ).status_code == 422
    assert _account(await client.get(ACCOUNT, headers=headers)).photo_url is None

    first = _account(await client.put(PHOTO, headers=headers, files=upload))
    first_url = first.photo_url
    assert first_url is not None and first_url.startswith(f"{ORIGIN}/media/")
    assert first_url.endswith(".png") and "gallery" not in first_url
    media = await client.get(first_url)
    assert media.status_code == 200 and media.content == PNG
    assert media.headers["content-type"] == "image/png"

    last_url = first_url
    for extension, content, media_type in (
        ("webp", WEBP, "image/webp"),
        ("jpg", JPEG, "image/jpeg"),
    ):
        updated = _account(
            await client.put(
                PHOTO,
                headers=headers,
                files={"file": ("other", content, media_type)},
            )
        )
        new_url = updated.photo_url
        assert new_url is not None and new_url.endswith(f".{extension}")
        assert (await client.get(last_url)).status_code == 404
        media = await client.get(new_url)
        assert media.status_code == 200 and media.content == content
        assert media.headers["content-type"] == media_type
        last_url = new_url

    assert _account(await client.get(ACCOUNT, headers=headers)).photo_url == last_url
    assert (await account_stand.another_session(first.id)).account.photo_url == last_url
    assert _account(await client.delete(PHOTO, headers=headers)).photo_url is None
    assert (await client.get(last_url)).status_code == 404
    assert _account(await client.delete(PHOTO, headers=headers)).photo_url is None


# spec:test in-app-notice-bar#store-bars-account-undismissed-bar
# spec:test in-app-notice-bar#keep-bar-until-account-dismisses
# spec:test in-app-notice-bar#stack-several-bars-tab-newest
# spec:test in-app-notice-bar#show-bar-account-other-one
async def test_notices_stay_with_their_account_until_dismissed(
    account_stand: AccountStand,
) -> None:
    client = account_stand.client
    first = await account_stand.add_account("notice_owner")
    second = await account_stand.add_account("notice_other")
    another = await account_stand.another_session(first.account.id)
    async with account_stand.session() as session:
        old = await raise_notice(
            session,
            first.account.id,
            NoticeTab.PEOPLE,
            NoticeKey.ARCHIVED_CLIENT_TRIED,
            {"name": "Older"},
        )
        recent = await raise_notice(
            session,
            first.account.id,
            NoticeTab.PEOPLE,
            NoticeKey.INVITE_REGISTERED,
            {"name": "Recent", "login": "recent"},
        )
        other = await raise_notice(
            session,
            second.account.id,
            NoticeTab.PROFILE,
            NoticeKey.ACCESS_GRANTED,
            {"date": "2026-12-31"},
        )
        old.created_at = datetime.now(UTC) - timedelta(days=1)
        await session.commit()

    _error(await client.get(NOTICES), 401, ErrorCode.UNAUTHORIZED)
    for signed_in in (first, another):
        response = await client.get(NOTICES, headers=_bearer(signed_in))
        assert response.status_code == 200
        items = NoticeList.model_validate_json(response.content).items
        assert [item.id for item in items] == [recent.notice_id, old.notice_id]
        assert items[0].key == NoticeKey.INVITE_REGISTERED
        assert items[0].params == {"name": "Recent", "login": "recent"}

    second_items = NoticeList.model_validate_json(
        (await client.get(NOTICES, headers=_bearer(second))).content
    ).items
    assert [item.id for item in second_items] == [other.notice_id]
    target = f"{NOTICES}/{recent.notice_id}"
    _error(
        await client.delete(target, headers=_bearer(second)), 404, ErrorCode.NOT_FOUND
    )
    invalid = await client.delete(f"{NOTICES}/invalid-uuid", headers=_bearer(first))
    assert invalid.status_code == 422
    dismissed = await client.delete(target, headers=_bearer(another))
    assert dismissed.status_code == 204 and dismissed.content == b""
    _error(
        await client.delete(target, headers=_bearer(first)), 404, ErrorCode.NOT_FOUND
    )
    remaining = NoticeList.model_validate_json(
        (await client.get(NOTICES, headers=_bearer(first))).content
    ).items
    assert [item.id for item in remaining] == [old.notice_id]


# spec:test product-feedback#store-send-text-account-email
# spec:test product-feedback#accept-number-messages-account-storing
# spec:test product-feedback#attach-other-user-data-message
# spec:test product-feedback#deliver-feedback-email-channel-other
async def test_feedback_stores_identity_activation_and_text_without_email(
    account_stand: AccountStand,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    outbox: list[EmailMessage] = []
    monkeypatch.setattr(emails, "_deliver", outbox.append)
    client = account_stand.client
    signed_in = await account_stand.add_account("feedback_user")
    headers = _bearer(signed_in)
    body = {"text": "Feedback\nSecond line", "screen": "profile"}
    _error(await client.post(FEEDBACK, json=body), 401, ErrorCode.UNAUTHORIZED)
    for invalid in (
        {**body, "text": ""},
        {**body, "text": "a" * 5001},
        {**body, "screen": "meetings"},
        {**body, "email": "not-the-sender@example.com"},
        {**body, "attached_note": "unrelated"},
    ):
        assert (
            await client.post(FEEDBACK, json=invalid, headers=headers)
        ).status_code == 422

    first = await client.post(FEEDBACK, json=body, headers=headers)
    assert first.status_code == 204 and first.content == b""
    leader = await account_stand.activate(signed_in)
    assert (await client.post(FEEDBACK, json=body, headers=headers)).status_code == 204
    assert outbox == []
    async with account_stand.session() as session:
        feedback = (
            await session.execute(
                select(FeedbackMessage, Account.email)
                .join(Account, FeedbackMessage.account_id == Account.account_id)
                .order_by(
                    FeedbackMessage.created_at, FeedbackMessage.feedback_message_id
                )
            )
        ).all()
    assert len(feedback) == 2
    assert [message.activated for message, _ in feedback] == [False, True]
    assert leader.activated_at is not None
    assert feedback[0][0].created_at <= leader.activated_at <= feedback[1][0].created_at
    for message, address in feedback:
        assert message.feedback_message_id.version == 7
        assert address == signed_in.account.email
        assert message.screen == "profile" and message.text == body["text"]
        assert message.processed_at is None
