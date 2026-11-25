from base64 import b64decode, urlsafe_b64encode
from binascii import Error as Base64Error
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import UUID

from cryptography.exceptions import InvalidSignature, UnsupportedAlgorithm
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.serialization import (
    load_der_public_key,
    load_pem_private_key,
)
from pydantic import ValidationError

from celmento_api.config import get_settings
from celmento_api.contour import current_contour
from celmento_api.errors import AppError
from celmento_api.models.enums import Contour, ErrorCode
from celmento_api.schemas.auth import (
    AccountRegistration,
    RegistrationOrigin,
    RegistrationPackage,
    RegistrationPackageClaims,
)

PACKAGE_LIFETIME: timedelta = timedelta(hours=24)
DEVICE_PROOF_BYTES: int = 64


class _SignedRegistrationClaims(RegistrationPackageClaims):
    inviter_id: UUID | None = None


class DeviceProofPurpose(StrEnum):
    LOGIN_PROPOSAL = "login-proposal"
    LOGIN_AVAILABILITY = "login-availability"
    FINISH = "finish"


def _encode(value: bytes) -> str:
    return urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    decoded = b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    if _encode(decoded) != value:
        raise ValueError("Expected canonical, unpadded base64url")
    return decoded


def _private_key() -> Ed25519PrivateKey:
    try:
        data = b64decode(
            get_settings().registration_private_key.get_secret_value(), validate=True
        )
        key = load_pem_private_key(data, password=None)
    except Base64Error, ValueError, TypeError:
        raise AppError(500, ErrorCode.INTERNAL_ERROR) from None
    if not isinstance(key, Ed25519PrivateKey):
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return key


def _public_key(contour: Contour) -> Ed25519PublicKey:
    settings = get_settings()
    serialized = (
        settings.registration_public_key_ru
        if contour == Contour.RU
        else settings.registration_public_key_world
    )
    try:
        key = load_der_public_key(b64decode(serialized, validate=True))
    except Base64Error, ValueError:
        raise AppError(500, ErrorCode.INTERNAL_ERROR) from None
    if not isinstance(key, Ed25519PublicKey):
        raise AppError(500, ErrorCode.INTERNAL_ERROR)
    return key


def _device_key(value: str) -> ec.EllipticCurvePublicKey:
    key = load_der_public_key(_decode(value))
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(
        key.curve, ec.SECP256R1
    ):
        raise TypeError("Expected a P-256 device public key")
    return key


def _verify_device_proof(
    claims: RegistrationPackageClaims,
    token: str,
    proof: str,
    purpose: DeviceProofPurpose,
) -> None:
    signature = _decode(proof)
    if len(signature) != DEVICE_PROOF_BYTES:
        raise ValueError("Expected a P1363 device signature")
    half = DEVICE_PROOF_BYTES // 2
    der = encode_dss_signature(
        int.from_bytes(signature[:half], "big"),
        int.from_bytes(signature[half:], "big"),
    )
    payload = (
        f"celmento:registration\n{purpose.value}\n{current_contour().value}\n{token}"
    )
    _device_key(claims.device_public_key).verify(
        der, payload.encode("utf-8"), ec.ECDSA(hashes.SHA256())
    )


def issue_package(
    email: str,
    registration: AccountRegistration,
    origin: RegistrationOrigin | None,
    device_public_key: str,
    inviter_id: UUID | None,
) -> RegistrationPackage:
    try:
        _device_key(device_public_key)
    except TypeError, ValueError, Base64Error, UnsupportedAlgorithm:
        raise AppError(400, ErrorCode.REGISTRATION_PACKAGE_INVALID) from None
    now = datetime.now(UTC)
    claims = _SignedRegistrationClaims(
        email=email,
        first_name=registration.first_name,
        last_name=registration.last_name,
        consents=registration.consents,
        intent=registration.intent if origin is None else None,
        origin=origin,
        entry_contour=current_contour(),
        device_public_key=device_public_key,
        code_confirmed=True,
        issued_at=now,
        expires_at=now + PACKAGE_LIFETIME,
        inviter_id=inviter_id,
    )
    excluded = {"inviter_id"} if inviter_id is None else None
    payload = claims.model_dump_json(exclude=excluded).encode("utf-8")
    # spec:impl registration-finish-screen#sign-device-registration-package
    return RegistrationPackage(
        token=f"{_encode(payload)}.{_encode(_private_key().sign(payload))}",
        claims=claims,
    )


def verify_package(
    token: str, proof: str, purpose: DeviceProofPurpose
) -> _SignedRegistrationClaims:
    try:
        encoded, signature = token.split(".")
        payload = _decode(encoded)
        claims = _SignedRegistrationClaims.model_validate_json(payload)
        # spec:impl region-contours#verify-package-offline
        _public_key(claims.entry_contour).verify(_decode(signature), payload)
        _verify_device_proof(claims, token, proof, purpose)
    except (
        TypeError,
        ValueError,
        Base64Error,
        ValidationError,
        InvalidSignature,
        UnsupportedAlgorithm,
    ):
        raise AppError(400, ErrorCode.REGISTRATION_PACKAGE_INVALID) from None
    if (
        not claims.code_confirmed
        or claims.expires_at - claims.issued_at != PACKAGE_LIFETIME
    ):
        raise AppError(400, ErrorCode.REGISTRATION_PACKAGE_INVALID)
    if claims.expires_at <= datetime.now(UTC):
        raise AppError(400, ErrorCode.REGISTRATION_PACKAGE_EXPIRED)
    # spec:impl meeting-invite-page#create-new-account-leader-contour
    if claims.origin is not None and current_contour() != claims.entry_contour:
        raise AppError(400, ErrorCode.REGION_LOCKED)
    return claims
