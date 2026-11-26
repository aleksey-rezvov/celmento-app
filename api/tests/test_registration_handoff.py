from asyncio import Barrier, gather, timeout
from base64 import b64decode, b64encode, urlsafe_b64encode
from datetime import UTC, datetime, timedelta, tzinfo
from hashlib import sha256

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
    load_pem_private_key,
)
from pydantic import SecretStr
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from test_account import AccountStand, account_stand
from test_auth_registration import (
    TERMS,
    AuthStand,
    assert_error,
    auth_stand,
    registration_device_proof,
)

from celmento_api.config import get_settings
from celmento_api.models.account import Account, RegistrationPackageUse
from celmento_api.models.enums import (
    Contour,
    ErrorCode,
    Language,
    LegalDocumentKind,
    RegistrationIntent,
)
from celmento_api.models.legal import Acceptance, LegalDocumentVersion
from celmento_api.schemas.auth import (
    AccountRegistration,
    FinishRegistrationResult,
    RegistrationPackage,
)
from celmento_api.schemas.documents import ConsentAcceptance
from celmento_api.services import (
    registration,
    registration_handoff,
    registration_package,
)

__all__: list[str] = ["account_stand", "auth_stand"]


def _base64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


async def _uses(stand: AuthStand) -> dict[str, tuple[str, datetime]]:
    async with stand.session() as session:
        rows = await session.scalars(select(RegistrationPackageUse))
        return {
            row.package_digest: (row.selected_contour, row.expires_at) for row in rows
        }


# spec:test registration-finish-screen#reject-reused-registration-package
async def test_handoff_binds_package_and_retains_use_after_account_deletion(
    auth_stand: AuthStand,
) -> None:
    email = "handoff-member@example.com"
    package = await auth_stand.package(email)
    digest = sha256(package.token.encode()).hexdigest()
    assert await _uses(auth_stand) == {}
    local = auth_stand.finish_form(package, "handoff_member")
    invalid_login = {**local, "login": "!"}
    assert_error(
        await auth_stand.post("registration/finish", invalid_login),
        400,
        ErrorCode.LOGIN_INVALID,
    )
    form = auth_stand.handoff_form(package, Contour.RU)
    assert_error(
        await auth_stand.post(
            "registration/handoff", {**form, "selected_contour": Contour.WORLD.value}
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    assert await _uses(auth_stand) == {}
    auth_stand.switch(Contour.RU)
    assert_error(
        await auth_stand.post(
            "registration/handoff", auth_stand.handoff_form(package, Contour.WORLD)
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    assert await _uses(auth_stand) == {}

    auth_stand.switch(Contour.WORLD)
    handoff = await auth_stand.handoff_for(package, Contour.RU)
    assert await auth_stand.handoff_for(package, Contour.RU) == handoff
    use = {digest: (Contour.RU.value, package.claims.expires_at)}
    assert await _uses(auth_stand) == use
    assert await auth_stand.counts() == (0, 0, 0, 0)
    refused = assert_error(
        await auth_stand.post("registration/finish", local),
        409,
        ErrorCode.CONFLICT,
    )
    assert refused.details == {"selected_contour": Contour.RU.value}
    another_package = await auth_stand.package("other-handoff@example.com")

    auth_stand.switch(Contour.RU)
    consents = await auth_stand.consents()
    for target, token in (
        (package, None),
        (package, "invalid"),
        (another_package, handoff),
    ):
        assert_error(
            await auth_stand.post(
                "registration/finish",
                {
                    **auth_stand.finish_form(target, "handoff_member"),
                    "consents": consents,
                    "handoff": token,
                },
            ),
            400,
            ErrorCode.REGISTRATION_PACKAGE_INVALID,
        )
    assert await _uses(auth_stand) == {}
    assert await auth_stand.counts() == (0, 0, 0, 0)
    finish = {
        **auth_stand.finish_form(package, "handoff_member"),
        "consents": consents,
        "handoff": handoff,
    }
    created = await auth_stand.post("registration/finish", finish)
    assert created.status_code == 201, created.text
    result = FinishRegistrationResult.model_validate_json(created.content)
    assert result.ticket is not None and result.session is None
    assert await _uses(auth_stand) == use
    assert_error(
        await auth_stand.post("registration/finish", finish),
        409,
        ErrorCode.ACCOUNT_EXISTS,
    )
    assert await auth_stand.counts() == (1, 2, 0, 1)

    async with auth_stand.session() as session:
        account = await session.scalar(select(Account).where(Account.email == email))
        assert account is not None
        await session.execute(
            delete(Acceptance).where(Acceptance.account_id == account.account_id)
        )
        await session.delete(account)
        await session.commit()
    replay = assert_error(
        await auth_stand.post("registration/finish", finish),
        409,
        ErrorCode.CONFLICT,
    )
    assert replay.details == {"selected_contour": Contour.RU.value}
    assert await _uses(auth_stand) == use
    assert await auth_stand.counts() == (0, 0, 0, 0)

    auth_stand.switch(Contour.WORLD)
    assert await _uses(auth_stand) == use
    assert await auth_stand.counts() == (0, 0, 0, 0)
    auth_stand.clock.now += 60
    independent = await auth_stand.package(email)
    retry = await auth_stand.post(
        "registration/finish", auth_stand.finish_form(independent, "local_member")
    )
    assert retry.status_code == 201, retry.text
    assert await auth_stand.counts() == (1, 2, 1, 0)


async def test_cutover_rejects_legacy_and_expired_packages_and_cleans_expired_receipts(
    auth_stand: AuthStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    package = await auth_stand.package("cutover-member@example.com")
    private = load_pem_private_key(
        b64decode(get_settings().registration_private_key.get_secret_value()),
        password=None,
    )
    assert isinstance(private, Ed25519PrivateKey)
    old_claims = package.claims.model_dump_json().encode("utf-8")
    legacy = RegistrationPackage(
        token=f"{_base64url(old_claims)}.{_base64url(private.sign(old_claims))}",
        claims=package.claims,
    )
    assert_error(
        await auth_stand.post(
            "registration/finish", auth_stand.finish_form(legacy, "cutover_member")
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_INVALID,
    )
    assert await _uses(auth_stand) == {}
    await auth_stand.handoff_for(package, Contour.RU)

    # Stamp the next issued package after the first one has expired.
    simulated_now = package.claims.expires_at + timedelta(seconds=1)

    class LaterTime:
        @staticmethod
        def now(zone: tzinfo = UTC) -> datetime:
            return simulated_now.astimezone(zone)

    monkeypatch.setattr(registration_package, "datetime", LaterTime)
    monkeypatch.setattr(registration_handoff, "datetime", LaterTime)
    assert_error(
        await auth_stand.post(
            "registration/handoff", auth_stand.handoff_form(package, Contour.RU)
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_EXPIRED,
    )
    assert_error(
        await auth_stand.post(
            "registration/finish", auth_stand.finish_form(package, "cutover_member")
        ),
        400,
        ErrorCode.REGISTRATION_PACKAGE_EXPIRED,
    )
    fresh = await auth_stand.package("fresh-member@example.com")
    assert len(await _uses(auth_stand)) == 1
    await auth_stand.handoff_for(fresh, Contour.RU)
    assert await _uses(auth_stand) == {
        sha256(fresh.token.encode()).hexdigest(): (
            Contour.RU.value,
            fresh.claims.expires_at,
        )
    }
    assert await auth_stand.counts() == (0, 0, 0, 0)


async def test_contour_binding_serializes_local_finish_and_cross_handoff(
    account_stand: AccountStand, monkeypatch: pytest.MonkeyPatch
) -> None:
    entry = account_stand.settings.contour
    other = Contour.WORLD if entry == Contour.RU else Contour.RU
    now = datetime.now(UTC)
    keys = Ed25519PrivateKey.generate()
    private_pem = keys.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
    public_der = keys.public_key().public_bytes(
        Encoding.DER, PublicFormat.SubjectPublicKeyInfo
    )
    settings = account_stand.settings.model_copy(
        update={
            "registration_private_key": SecretStr(
                b64encode(private_pem).decode("ascii")
            ),
            f"registration_public_key_{entry.value}": b64encode(public_der).decode(
                "ascii"
            ),
        }
    )
    monkeypatch.setattr(registration_package, "get_settings", lambda: settings)
    async with account_stand.session() as session:
        records = await session.scalars(
            select(LegalDocumentVersion).where(
                LegalDocumentVersion.document.in_(tuple(kind.value for kind in TERMS))
            )
        )
        consents = [
            ConsentAcceptance(
                document=LegalDocumentKind(record.document),
                version=record.version,
                accepted_at=now,
            )
            for record in records
        ]
    email = "race-member@example.com"
    new_account = AccountRegistration(
        email=email,
        first_name="Race",
        last_name="Member",
        language=Language.EN,
        intent=RegistrationIntent.ATTEND,
        consents=consents,
    )
    device = ec.generate_private_key(ec.SECP256R1())
    device_key = device.public_key().public_bytes(
        Encoding.DER, PublicFormat.SubjectPublicKeyInfo
    )
    package = registration_package.issue_package(
        email, new_account, None, _base64url(device_key), None
    )

    original = registration_handoff.record_package_use
    barrier = Barrier(2)

    async def claim(
        session: AsyncSession, digest: str, selected: Contour, expires_at: datetime
    ) -> Contour | None:
        await barrier.wait()
        return await original(session, digest, selected, expires_at)

    monkeypatch.setattr(registration, "record_package_use", claim)
    monkeypatch.setattr(registration_handoff, "record_package_use", claim)
    common = {"registration_package": package.token}
    async with timeout(10):
        local, cross = await gather(
            account_stand.client.post(
                "/api/v1/auth/registration/finish",
                json={
                    **common,
                    "device_proof": registration_device_proof(
                        device, package.token, "finish", entry
                    ),
                    "login": "race_member",
                    "language": "en",
                    "time_zone": "Europe/Belgrade",
                },
            ),
            account_stand.client.post(
                "/api/v1/auth/registration/handoff",
                json={
                    **common,
                    "device_proof": registration_device_proof(
                        device, package.token, "handoff", entry, other
                    ),
                    "selected_contour": other.value,
                },
            ),
        )
    assert (local.status_code, cross.status_code) in {(201, 409), (409, 200)}
    winner = entry if local.status_code == 201 else other
    rejected = cross if winner == entry else local
    problem = assert_error(rejected, 409, ErrorCode.CONFLICT)
    assert problem.details == {"selected_contour": winner.value}
    async with account_stand.session() as session:
        receipts = (await session.scalars(select(RegistrationPackageUse))).all()
        assert len(receipts) == 1
        assert receipts[0].package_digest == sha256(package.token.encode()).hexdigest()
        assert receipts[0].selected_contour == winner.value
        assert await session.scalar(select(func.count()).select_from(Account)) == int(
            winner == entry
        )
