from asyncio import CancelledError, Event, create_task, timeout
from base64 import b64encode, urlsafe_b64encode
from collections.abc import AsyncGenerator, Callable, Mapping
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from re import search
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from celmento_api import emails
from celmento_api.config import get_settings
from celmento_api.db import Base, get_session
from celmento_api.errors import AppError, Error
from celmento_api.main import api, app
from celmento_api.models.account import Account, AccountSession, SignInTicket
from celmento_api.models.enums import Contour, ErrorCode, Language, LegalDocumentKind
from celmento_api.models.legal import Acceptance, LegalDocumentVersion
from celmento_api.routers import auth as auth_router
from celmento_api.schemas.auth import (
    AccountRegistrationResult,
    CodeRequestOutcome,
    FinishOutcome,
    FinishRegistrationResult,
    LoginAvailability,
    RegistrationPackage,
    SignInCodeRequestResult,
    SignInCodeVerificationResult,
    SignInSession,
    VerificationOutcome,
)
from celmento_api.schemas.documents import LegalDocument
from celmento_api.seed import seed
from celmento_api.services import sign_in_codes
from celmento_api.services.sessions import issue_ticket

TERMS: tuple[LegalDocumentKind, ...] = (
    LegalDocumentKind.TERMS_OF_USE,
    LegalDocumentKind.PERSONAL_DATA_CONSENT,
)
ACTIVATION: tuple[LegalDocumentKind, ...] = (
    LegalDocumentKind.SPECIALIST_OFFER,
    LegalDocumentKind.DATA_PROCESSING_INSTRUCTION,
)


@dataclass(slots=True)
class Clock:
    now: float = 0


@dataclass(slots=True)
class AuthStand:
    client: AsyncClient
    connection: AsyncConnection
    schemas: dict[Contour, str]
    switch: Callable[[Contour], None]
    clock: Clock
    outbox: list[EmailMessage]
    device: ec.EllipticCurvePrivateKey

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession]:
        async with AsyncSession(
            bind=self.connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        ) as session:
            schema = self.schemas[get_settings().contour]
            await session.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            yield session

    async def post(self, operation: str, body: Mapping[str, object]) -> Response:
        return await self.client.post(f"/api/v1/auth/{operation}", json=dict(body))

    async def counts(self) -> tuple[int, int, int, int]:
        async with self.session() as session:
            account_count = await session.scalar(
                select(func.count()).select_from(Account)
            )
            acceptance_count = await session.scalar(
                select(func.count()).select_from(Acceptance)
            )
            session_count = await session.scalar(
                select(func.count()).select_from(AccountSession)
            )
            ticket_count = await session.scalar(
                select(func.count()).select_from(SignInTicket)
            )
        return (
            account_count or 0,
            acceptance_count or 0,
            session_count or 0,
            ticket_count or 0,
        )

    async def add_account(self, email: str, login: str) -> None:
        async with self.session() as session:
            session.add(
                Account(
                    email=email,
                    first_name="Known",
                    last_name="Tester",
                    login=login,
                    language=Language.EN.value,
                    time_zone="Europe/Belgrade",
                ),
            )
            await session.commit()

    async def document(
        self, kind: LegalDocumentKind, language: Language = Language.EN
    ) -> LegalDocument:
        response = await self.client.get(
            f"/api/v1/documents/{kind.value}", params={"language": language.value}
        )
        assert response.status_code == 200
        return LegalDocument.model_validate_json(response.content)

    async def consents(
        self, kinds: tuple[LegalDocumentKind, ...] = TERMS
    ) -> list[dict[str, str]]:
        accepted_at = datetime.now(UTC).isoformat()
        result: list[dict[str, str]] = []
        for kind in kinds:
            document = await self.document(kind)
            result.append(
                {
                    "document": kind.value,
                    "version": document.version,
                    "accepted_at": accepted_at,
                },
            )
        return result

    async def registration(
        self, email: str, *, intent: str = "attend"
    ) -> dict[str, object]:
        return {
            "email": email,
            "first_name": "Sample",
            "last_name": "Tester",
            "language": "en",
            "intent": intent,
            "consents": await self.consents(),
        }

    def code(self) -> str:
        code = search(r"[0-9]{6}$", str(self.outbox[-1]["Subject"]))
        assert code is not None
        return code.group(0)

    def device_public_key(self) -> str:
        spki = self.device.public_key().public_bytes(
            Encoding.DER, PublicFormat.SubjectPublicKeyInfo
        )
        return urlsafe_b64encode(spki).rstrip(b"=").decode("ascii")

    def verification(
        self, email: str, registration: dict[str, object]
    ) -> dict[str, object]:
        return {
            "email": email,
            "code": self.code(),
            "registration": registration,
            "registration_device_key": self.device_public_key(),
        }

    def package_ref(
        self, package: RegistrationPackage, purpose: str
    ) -> dict[str, object]:
        contour = get_settings().contour.value
        payload = (
            f"celmento:registration\n{purpose}\n{contour}\n{package.token}".encode()
        )
        r, s = decode_dss_signature(
            self.device.sign(payload, ec.ECDSA(hashes.SHA256()))
        )
        proof = (
            urlsafe_b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
            .rstrip(b"=")
            .decode("ascii")
        )
        return {"registration_package": package.token, "device_proof": proof}

    def finish_form(
        self, package: RegistrationPackage, login: str
    ) -> dict[str, object]:
        return {
            **self.package_ref(package, "finish"),
            "login": login,
            "language": "en",
            "time_zone": "Europe/Belgrade",
        }

    async def package(self, email: str) -> RegistrationPackage:
        form = await self.registration(email)
        assert (await self.post("register", form)).status_code == 200
        return package_from(
            await self.post("code/verify", self.verification(email, form)),
        )


@pytest.fixture
async def auth_stand(
    database_connection: AsyncConnection,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[AuthStand]:
    keys = {contour: Ed25519PrivateKey.generate() for contour in Contour}
    schemas = {contour: f"auth_{contour.value}_{uuid4().hex}" for contour in Contour}
    secrets = {contour: uuid4().hex for contour in Contour}
    clock = Clock()
    outbox: list[EmailMessage] = []
    monkeypatch.setattr(sign_in_codes, "monotonic", lambda: clock.now)
    monkeypatch.setattr(sign_in_codes, "_challenges", {})
    monkeypatch.setattr(emails, "_deliver", outbox.append)
    for contour, key in keys.items():
        public = key.public_key().public_bytes(
            Encoding.DER, PublicFormat.SubjectPublicKeyInfo
        )
        monkeypatch.setenv(
            f"CLM_APP_REGISTRATION_PUBLIC_KEY_{contour.value.upper()}",
            b64encode(public).decode("ascii"),
        )
    monkeypatch.setenv("CLM_APP_WEB_URL_RU", "http://ru.celmento.test")
    monkeypatch.setenv("CLM_APP_WEB_URL_WORLD", "http://world.celmento.test")
    monkeypatch.setenv("CLM_APP_EMAIL_FROM", "sign-in@example.com")

    def switch(contour: Contour) -> None:
        private = keys[contour].private_bytes(
            Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
        )
        monkeypatch.setenv(
            "CLM_APP_REGISTRATION_PRIVATE_KEY", b64encode(private).decode("ascii")
        )
        monkeypatch.setenv("CLM_APP_CONTOUR", contour.value)
        monkeypatch.setenv("CLM_APP_SESSION_SECRET", secrets[contour])
        get_settings.cache_clear()

    transaction = await database_connection.begin()
    try:
        async with AsyncClient(
            base_url="http://celmento.test",
            transport=ASGITransport(app=app),
        ) as client:
            stand = AuthStand(
                client,
                database_connection,
                schemas,
                switch,
                clock,
                outbox,
                ec.generate_private_key(ec.SECP256R1()),
            )
            for contour, schema in schemas.items():
                await database_connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                await database_connection.execute(
                    text(f'SET LOCAL search_path TO "{schema}"')
                )
                await database_connection.run_sync(Base.metadata.create_all)
                switch(contour)
                async with stand.session() as session:
                    await seed(session, draft_documents=True)

            async def get_test_session() -> AsyncGenerator[AsyncSession]:
                async with stand.session() as session:
                    yield session

            api.dependency_overrides[get_session] = get_test_session
            switch(Contour.WORLD)
            try:
                yield stand
            finally:
                api.dependency_overrides.pop(get_session, None)
    finally:
        await transaction.rollback()
        get_settings.cache_clear()


def assert_error(response: Response, status: int, code: ErrorCode) -> Error:
    assert response.status_code == status
    error = Error.model_validate_json(response.content)
    assert error.code == code
    return error


def package_from(response: Response) -> RegistrationPackage:
    assert response.status_code == 200
    result = SignInCodeVerificationResult.model_validate_json(response.content)
    assert result.outcome == VerificationOutcome.REGISTRATION_CONFIRMED
    assert result.session is None
    assert result.registration_package is not None
    return result.registration_package


# spec:test legal-documents#provide-five-read-only-documents
# spec:test legal-documents#share-version-across-languages
async def test_serves_a_read_only_bilingual_document_set_in_each_contour(
    auth_stand: AuthStand,
) -> None:
    for contour in Contour:
        auth_stand.switch(contour)
        for kind in LegalDocumentKind:
            english = await auth_stand.document(kind, Language.EN)
            russian = await auth_stand.document(kind, Language.RU)
            assert english.kind == russian.kind == kind
            assert english.contour == russian.contour == contour
            assert english.language == Language.EN
            assert russian.language == Language.RU
            assert english.version == russian.version
            assert english.title != russian.title
            assert english.text != russian.text
            version_line = next(
                line
                for line in english.text.splitlines()
                if line.startswith("Version ")
            )
            assert english.version in version_line
            assert (
                "celmento.ru" if contour == Contour.RU else "celmento.com"
            ) in version_line
        rejected = await auth_stand.client.post("/api/v1/documents/terms_of_use")
        assert rejected.status_code == 405


# spec:test email-code-sign-in#route-unknown-email-to-registration
# spec:test account-registration#send-code-on-registration
# spec:test account-registration#defer-personal-data-until-finish
# spec:test registration-finish-screen#defer-account-until-finish
# spec:test registration-finish-screen#sign-device-registration-package
# spec:test registration-finish-screen#create-in-selected-contour
# spec:test legal-documents#require-recorded-account-consent
# spec:test legal-documents#store-account-activation-18-confirmation
async def test_registration_writes_nothing_until_confirmed_finish(
    auth_stand: AuthStand,
) -> None:
    email = "new-email@example.com"
    unknown = await auth_stand.post("code/request", {"email": email, "language": "en"})
    assert unknown.status_code == 200
    request = SignInCodeRequestResult.model_validate_json(unknown.content)
    assert request.outcome == CodeRequestOutcome.REGISTRATION_REQUIRED
    assert request.first_name is None
    assert auth_stand.outbox == []

    registration = await auth_stand.registration(email, intent="lead")
    invalid = await auth_stand.post("register", {**registration, "consents": []})
    assert_error(invalid, 400, ErrorCode.CONSENT_REQUIRED)
    assert auth_stand.outbox == []
    sent = await auth_stand.post("register", registration)
    assert sent.status_code == 200
    new_reg = AccountRegistrationResult.model_validate_json(sent.content)
    assert new_reg.account_exists is False
    assert new_reg.first_name is None
    assert len(auth_stand.outbox) == 1
    assert auth_stand.outbox[0]["To"] == email
    assert await auth_stand.counts() == (0, 0, 0, 0)

    code = {"email": email, "code": auth_stand.code()}
    needs_registration = await auth_stand.post("code/verify", code)
    assert_error(needs_registration, 400, ErrorCode.REGISTRATION_REQUIRED)
    missing_key = await auth_stand.post(
        "code/verify", {**code, "registration": registration}
    )
    assert_error(missing_key, 400, ErrorCode.REGISTRATION_PACKAGE_INVALID)
    correct = auth_stand.verification(email, registration)
    package = package_from(await auth_stand.post("code/verify", correct))
    assert package.claims.email == email
    assert package.claims.first_name == "Sample"
    assert package.claims.code_confirmed
    assert package.claims.device_public_key == auth_stand.device_public_key()
    assert package.claims.entry_contour == Contour.WORLD
    assert package.claims.expires_at - package.claims.issued_at == timedelta(hours=24)
    assert package.claims.consents[0].accepted_at is not None
    assert_error(
        await auth_stand.post("code/verify", correct), 400, ErrorCode.CODE_INVALID
    )
    assert await auth_stand.counts() == (0, 0, 0, 0)

    finish = auth_stand.finish_form(package, "sample")
    lacked_activation = await auth_stand.post("registration/finish", finish)
    assert_error(lacked_activation, 400, ErrorCode.CONSENT_REQUIRED)
    assert await auth_stand.counts() == (0, 0, 0, 0)
    finish["activation"] = {
        "age_confirmed": True,
        "acceptances": await auth_stand.consents(ACTIVATION),
    }
    created = await auth_stand.post("registration/finish", finish)
    assert created.status_code == 201
    result = FinishRegistrationResult.model_validate_json(created.content)
    assert result.outcome == FinishOutcome.SESSION
    assert result.ticket is None
    assert result.session is not None
    account = result.session.account
    assert account.email == email
    assert account.contour == Contour.WORLD
    assert account.id.version == 7
    assert account.activated and account.leader is not None
    assert {entry.kind.value for entry in account.acceptances} == {
        "terms_of_use",
        "personal_data_consent",
        "age_confirmation",
        "specialist_offer",
        "data_processing_instruction",
    }
    age_record = next(
        entry for entry in account.acceptances if entry.kind.value == "age_confirmation"
    )
    assert age_record.version is None
    assert age_record.accepted_at == account.activated_at
    assert {entry.kind.value: entry.accepted_at for entry in account.acceptances}[
        "terms_of_use"
    ] == package.claims.consents[0].accepted_at
    assert await auth_stand.counts() == (1, 5, 1, 0)

    replay = await auth_stand.post(
        "registration/finish", {**finish, "login": "another"}
    )
    assert_error(replay, 409, ErrorCode.ACCOUNT_EXISTS)
    assert await auth_stand.counts() == (1, 5, 1, 0)


# spec:test email-code-sign-in#normalize-email
# spec:test email-code-sign-in#look-up-entry-contour
# spec:test email-code-sign-in#send-six-digit-code
# spec:test account-registration#handle-reused-email
# spec:test email-code-sign-in#send-code-email-transactional-email-code
# spec:test transactional-email#render-emails-ru-en-templates
async def test_known_address_uses_normalized_local_lookup_and_keeps_one_account(
    auth_stand: AuthStand,
) -> None:
    email = "known@example.com"
    auth_stand.switch(Contour.RU)
    await auth_stand.add_account(email, "knownru")
    auth_stand.switch(Contour.WORLD)

    payload = {"email": "  KNOWN@EXAMPLE.COM ", "language": "ru"}
    unknown = await auth_stand.post("code/request", payload)
    assert unknown.status_code == 200
    assert (
        SignInCodeRequestResult.model_validate_json(unknown.content).outcome
        == CodeRequestOutcome.REGISTRATION_REQUIRED
    )
    assert auth_stand.outbox == []
    await auth_stand.add_account(email, "knownworld")
    known = await auth_stand.post("code/request", payload)
    assert known.status_code == 200
    result = SignInCodeRequestResult.model_validate_json(known.content)
    assert result.outcome == CodeRequestOutcome.CODE_SENT
    assert result.first_name == "Known"
    message = auth_stand.outbox[-1]
    code = auth_stand.code()
    assert len(code) == 6 and code.isascii() and code.isdigit()
    assert message["To"] == email
    assert str(message["Subject"]) == f"Код для входа в celmēnto: {code}"
    html = message.get_body(("html",))
    assert html is not None
    html_body: object = html.get_content()
    assert isinstance(html_body, str)
    assert f"<h1>{code}</h1>" in html_body
    assert "10 минут" in html_body
    assert "проигнорируйте это письмо" in html_body

    verified = await auth_stand.post("code/verify", {"email": email, "code": code})
    assert verified.status_code == 200
    signed = SignInCodeVerificationResult.model_validate_json(verified.content)
    assert signed.outcome == VerificationOutcome.SIGNED_IN
    assert signed.session is not None
    assert signed.session.account.login == "knownworld"
    assert signed.session.account.first_name == "Known"
    assert await auth_stand.counts() == (1, 0, 1, 0)

    auth_stand.clock.now += 60
    already_registered = await auth_stand.post(
        "register",
        {
            "email": email,
            "first_name": "Edited",
            "last_name": "Name",
            "language": "en",
            "consents": [],
        },
    )
    assert already_registered.status_code == 200
    edited = AccountRegistrationResult.model_validate_json(already_registered.content)
    assert edited.account_exists and edited.first_name == "Known"
    assert len(auth_stand.outbox) == 2
    assert (
        str(auth_stand.outbox[-1]["Subject"])
        == f"Your celmēnto sign-in code: {auth_stand.code()}"
    )
    assert await auth_stand.counts() == (1, 0, 1, 0)

    again = await auth_stand.post(
        "code/verify", {"email": email, "code": auth_stand.code()}
    )
    assert again.status_code == 200
    other = SignInCodeVerificationResult.model_validate_json(again.content)
    assert other.session is not None
    old_header = {"Authorization": f"Bearer {signed.session.token}"}
    new_header = {"Authorization": f"Bearer {other.session.token}"}
    assert (
        await auth_stand.client.post("/api/v1/auth/sign-out", headers=old_header)
    ).status_code == 204
    assert_error(
        await auth_stand.client.post("/api/v1/auth/sign-out", headers=old_header),
        401,
        ErrorCode.UNAUTHORIZED,
    )
    assert (
        await auth_stand.client.post("/api/v1/auth/sign-out", headers=new_header)
    ).status_code == 204
    assert await auth_stand.counts() == (1, 0, 2, 0)


# spec:test transactional-email#complete-triggering-action-even-email
async def test_request_can_finish_when_mail_transport_fails(
    auth_stand: AuthStand,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def offline(_message: EmailMessage) -> None:
        raise OSError("Test transport is offline")

    monkeypatch.setattr(emails, "_deliver", offline)
    registration = await auth_stand.registration("transport@example.com")
    accepted = await auth_stand.post("register", registration)
    assert accepted.status_code == 200
    assert "Transactional email handoff failed" in caplog.text
    assert "transport@example.com" not in caplog.text
    assert await auth_stand.counts() == (0, 0, 0, 0)


# spec:test email-code-sign-in#enforce-resend-cooldown
async def test_resend_enforces_cooldown_and_supersedes_the_previous_code(
    auth_stand: AuthStand,
) -> None:
    email = "resend@example.com"
    form = await auth_stand.registration(email)
    assert (await auth_stand.post("register", form)).status_code == 200
    original = auth_stand.verification(email, form)

    repeated = await auth_stand.post("register", form)
    error = assert_error(repeated, 429, ErrorCode.RESEND_TOO_SOON)
    assert error.details == {"retry_after_seconds": 60}
    assert len(auth_stand.outbox) == 1
    assert_error(
        await auth_stand.post(
            "code/verify", {"email": email, "code": auth_stand.code()}
        ),
        400,
        ErrorCode.REGISTRATION_REQUIRED,
    )

    auth_stand.clock.now += 60
    assert (await auth_stand.post("register", form)).status_code == 200
    assert len(auth_stand.outbox) == 2
    assert original["code"] != auth_stand.code()
    assert_error(
        await auth_stand.post("code/verify", original), 400, ErrorCode.CODE_INVALID
    )
    package_from(
        await auth_stand.post("code/verify", auth_stand.verification(email, form))
    )


# spec:test email-code-sign-in#expire-code-in-ten-minutes
async def test_code_is_expired_at_ten_minutes(auth_stand: AuthStand) -> None:
    email = "expired@example.com"
    form = await auth_stand.registration(email)
    assert (await auth_stand.post("register", form)).status_code == 200
    body = auth_stand.verification(email, form)

    auth_stand.clock.now += 600
    assert_error(
        await auth_stand.post("code/verify", body), 400, ErrorCode.CODE_EXPIRED
    )
    assert await auth_stand.counts() == (0, 0, 0, 0)


# spec:test email-code-sign-in#lock-after-five-attempts
async def test_fifth_wrong_attempt_locks_verification_and_resend_for_fifteen_minutes(
    auth_stand: AuthStand,
) -> None:
    email = "locked@example.com"
    form = await auth_stand.registration(email)
    assert (await auth_stand.post("register", form)).status_code == 200
    correct = auth_stand.verification(email, form)
    wrong = {**correct, "code": "000001" if auth_stand.code() == "000000" else "000000"}

    for _ in range(4):
        assert_error(
            await auth_stand.post("code/verify", wrong), 400, ErrorCode.CODE_INVALID
        )
    locked = assert_error(
        await auth_stand.post("code/verify", wrong), 429, ErrorCode.CODE_LOCKED
    )
    assert locked.details == {"retry_after_seconds": 900}
    assert_error(
        await auth_stand.post("code/verify", correct), 429, ErrorCode.CODE_LOCKED
    )
    auth_stand.clock.now += 899
    still_locked = assert_error(
        await auth_stand.post("register", form), 429, ErrorCode.CODE_LOCKED
    )
    assert still_locked.details == {"retry_after_seconds": 1}
    auth_stand.clock.now += 1
    assert (await auth_stand.post("register", form)).status_code == 200
    assert len(auth_stand.outbox) == 2


async def test_concurrent_verification_and_resend_wait_for_exclusive_claim(
    auth_stand: AuthStand,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = "concurrent@example.com"
    form = await auth_stand.registration(email)
    assert (await auth_stand.post("register", form)).status_code == 200
    body = auth_stand.verification(email, form)
    entered = Event()
    held = Event()
    original_find = auth_router.find_account

    async def find_with_first_call_held(
        session: AsyncSession, address: str
    ) -> Account | None:
        if not entered.is_set():
            entered.set()
            await held.wait()
        return await original_find(session, address)

    monkeypatch.setattr(auth_router, "find_account", find_with_first_call_held)
    first = create_task(auth_stand.post("code/verify", body))
    try:
        async with timeout(5):
            await entered.wait()
        duplicate = await auth_stand.post("code/verify", body)
        assert_error(duplicate, 400, ErrorCode.CODE_INVALID)
        auth_stand.clock.now += 61
        blocked_send = await auth_stand.post("register", form)
        assert_error(blocked_send, 429, ErrorCode.RESEND_TOO_SOON)
        assert len(auth_stand.outbox) == 1
    finally:
        first.cancel()
        with suppress(CancelledError):
            await first

    package_from(await auth_stand.post("code/verify", body))
    assert_error(
        await auth_stand.post("code/verify", body), 400, ErrorCode.CODE_INVALID
    )


async def test_failed_session_commit_leaves_the_correct_code_usable(
    auth_stand: AuthStand,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = "commit@example.com"
    await auth_stand.add_account(email, "commit")
    assert (
        await auth_stand.post("code/request", {"email": email, "language": "en"})
    ).status_code == 200
    body = {"email": email, "code": auth_stand.code()}

    async def refuse_commit(_session: AsyncSession) -> None:
        raise AppError(500, ErrorCode.INTERNAL_ERROR)

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", refuse_commit)
        assert_error(
            await auth_stand.post("code/verify", body), 500, ErrorCode.INTERNAL_ERROR
        )

    assert await auth_stand.counts() == (1, 0, 0, 0)
    retry = await auth_stand.post("code/verify", body)
    assert retry.status_code == 200
    assert (
        SignInCodeVerificationResult.model_validate_json(retry.content).outcome
        == VerificationOutcome.SIGNED_IN
    )
    assert await auth_stand.counts() == (1, 0, 1, 0)


# spec:test booking-link-login#accept-login-5-32-characters
# spec:test booking-link-login#propose-login-registration-part-email
# spec:test booking-link-login#use-user-base-proposed-login
# spec:test registration-finish-screen#propose-login-from-email
# spec:test registration-finish-screen#fallback-to-user-login-base
# spec:test registration-finish-screen#pad-short-login
# spec:test registration-finish-screen#choose-smallest-free-suffix
async def test_login_proposal_and_validation_use_one_contours_accounts(
    auth_stand: AuthStand,
) -> None:
    package = await auth_stand.package("1ann@example.com")
    proposal = await auth_stand.post(
        "registration/login-proposal", auth_stand.package_ref(package, "login-proposal")
    )
    assert proposal.status_code == 200
    assert LoginAvailability.model_validate_json(proposal.content).login == "ann12"

    await auth_stand.add_account("first-taken@example.com", "ann12")
    await auth_stand.add_account("second-taken@example.com", "ann121")
    proposal = await auth_stand.post(
        "registration/login-proposal", auth_stand.package_ref(package, "login-proposal")
    )
    assert proposal.status_code == 200
    assert LoginAvailability.model_validate_json(proposal.content).login == "ann122"

    symbols = await auth_stand.package("12345@example.com")
    fallback = await auth_stand.post(
        "registration/login-proposal", auth_stand.package_ref(symbols, "login-proposal")
    )
    assert fallback.status_code == 200
    assert LoginAvailability.model_validate_json(fallback.content).login == "user1"

    verdicts = {
        "ax": "rule_length",
        "a%123": "rule_chars",
        "_abcd": "rule_start",
        "a123_": "rule_end",
        "a__bc": "rule_double",
        "APP": "reserved",
        "ANN12": "taken",
        "ANN122": "available",
        "z" * 32: "available",
        "z" * 33: "rule_length",
    }
    for login, verdict in verdicts.items():
        checked = await auth_stand.post(
            "registration/login-availability",
            {**auth_stand.package_ref(package, "login-availability"), "login": login},
        )
        assert checked.status_code == 200
        availability = LoginAvailability.model_validate_json(checked.content)
        assert availability.login == login.lower()
        assert availability.status.value == verdict

    old_proposal = auth_stand.finish_form(package, "ann122")
    await auth_stand.add_account("third-taken@example.com", "ann122")
    assert_error(
        await auth_stand.post("registration/finish", old_proposal),
        409,
        ErrorCode.LOGIN_TAKEN,
    )
    assert await auth_stand.counts() == (3, 0, 0, 0)
    new_proposal = auth_stand.finish_form(package, "ann123")
    assert (
        await auth_stand.post("registration/finish", new_proposal)
    ).status_code == 201


# spec:test region-contours#verify-package-offline
# spec:test region-contours#reject-invalid-tickets
# spec:test legal-documents#store-selected-contour-consents
async def test_offline_cross_contour_registration_uses_selected_documents_and_one_time_ticket(
    auth_stand: AuthStand,
) -> None:
    email = "cross-contour@example.com"
    package = await auth_stand.package(email)
    world_proof = auth_stand.finish_form(package, "crosscontour")
    assert await auth_stand.counts() == (0, 0, 0, 0)

    auth_stand.switch(Contour.RU)
    async with auth_stand.session() as session:
        await session.execute(
            update(LegalDocumentVersion)
            .where(
                LegalDocumentVersion.document.in_(tuple(kind.value for kind in TERMS))
            )
            .values(version="1.0-ru-test"),
        )
        await session.commit()

    assert_error(
        await auth_stand.post("registration/finish", world_proof),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    form = auth_stand.finish_form(package, "crosscontour")
    assert_error(
        await auth_stand.post("registration/finish", form),
        400,
        ErrorCode.CONSENT_REQUIRED,
    )
    incorrect_versions = {
        **form,
        "consents": [
            entry.model_dump(mode="json") for entry in package.claims.consents
        ],
    }
    assert_error(
        await auth_stand.post("registration/finish", incorrect_versions),
        400,
        ErrorCode.CONSENT_REQUIRED,
    )
    assert await auth_stand.counts() == (0, 0, 0, 0)
    form["consents"] = await auth_stand.consents()

    created = await auth_stand.post("registration/finish", form)
    assert created.status_code == 201
    issued = FinishRegistrationResult.model_validate_json(created.content)
    assert issued.outcome == FinishOutcome.TICKET
    assert issued.session is None
    assert issued.ticket is not None
    assert (
        issued.ticket.ticket_url
        == f"http://ru.celmento.test/login/ticket#ticket={issued.ticket.ticket}"
    )
    assert await auth_stand.counts() == (1, 2, 0, 1)

    exchange_payload = {"ticket": issued.ticket.ticket}
    auth_stand.switch(Contour.WORLD)
    assert await auth_stand.counts() == (0, 0, 0, 0)
    assert_error(
        await auth_stand.post("tickets/exchange", exchange_payload),
        400,
        ErrorCode.TICKET_INVALID,
    )
    auth_stand.switch(Contour.RU)

    converted = await auth_stand.post("tickets/exchange", exchange_payload)
    assert converted.status_code == 200
    signed_in = SignInSession.model_validate_json(converted.content)
    assert signed_in.account.contour == Contour.RU
    assert signed_in.account.email == email
    assert {entry.version for entry in signed_in.account.acceptances} == {"1.0-ru-test"}
    assert await auth_stand.counts() == (1, 2, 1, 1)
    assert_error(
        await auth_stand.post("tickets/exchange", exchange_payload),
        400,
        ErrorCode.TICKET_INVALID,
    )
    assert_error(
        await auth_stand.post("tickets/exchange", {"ticket": "unknown"}),
        400,
        ErrorCode.TICKET_INVALID,
    )
    assert await auth_stand.counts() == (1, 2, 1, 1)

    async with auth_stand.session() as session:
        registered = await session.scalar(select(Account).where(Account.email == email))
        assert registered is not None
        expired_ticket = await issue_ticket(session, registered)
        await session.flush()
        await session.execute(
            update(SignInTicket)
            .where(
                SignInTicket.account_id == registered.account_id,
                SignInTicket.used_at.is_(None),
            )
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1)),
        )
        await session.commit()
    assert_error(
        await auth_stand.post("tickets/exchange", {"ticket": expired_ticket.ticket}),
        400,
        ErrorCode.TICKET_INVALID,
    )
    assert (await auth_stand.counts())[2] == 1


async def test_package_operations_require_the_correct_device_proof(
    auth_stand: AuthStand,
) -> None:
    package = await auth_stand.package("bound-key@example.com")
    proposal = "registration/login-proposal"
    no_proof = await auth_stand.post(proposal, {"registration_package": package.token})
    assert no_proof.status_code == 422
    malformed = await auth_stand.post(
        proposal, {"registration_package": package.token, "device_proof": "short"}
    )
    assert malformed.status_code == 422
    assert_error(
        await auth_stand.post(
            proposal, {"registration_package": package.token, "device_proof": "A" * 86}
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    assert_error(
        await auth_stand.post(
            proposal, auth_stand.package_ref(package, "login-availability")
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    original_device = auth_stand.device
    auth_stand.device = ec.generate_private_key(ec.SECP256R1())
    assert_error(
        await auth_stand.post(
            proposal, auth_stand.package_ref(package, "login-proposal")
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    auth_stand.device = original_device
    right = await auth_stand.post(
        proposal, auth_stand.package_ref(package, "login-proposal")
    )
    assert right.status_code == 200

    token = package.token
    damaged = package.model_copy(
        update={"token": token.rpartition(".")[0] + ".invalid"}
    )
    assert_error(
        await auth_stand.post(
            proposal, auth_stand.package_ref(damaged, "login-proposal")
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    assert await auth_stand.counts() == (0, 0, 0, 0)
