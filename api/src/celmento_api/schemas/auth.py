from enum import StrEnum
from re import fullmatch
from typing import Annotated
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    Field,
    SecretStr,
    field_validator,
)

from celmento_api.models.enums import (
    Contour,
    Language,
    LoginAvailabilityStatus,
    RegistrationIntent,
)
from celmento_api.schemas.account import Account, Email, Name, TimeZone
from celmento_api.schemas.documents import ConsentAcceptance

EmailInput = Annotated[
    str,
    Field(repr=False, json_schema_extra={"format": "email", "maxLength": 254}),
]
Token = Annotated[
    str,
    Field(repr=False, json_schema_extra={"format": "password", "x-sensitive": True}),
]
SecretInput = Annotated[
    SecretStr,
    Field(repr=False, json_schema_extra={"x-sensitive": True, "writeOnly": True}),
]

DevicePublicKey = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]+$")]
DeviceProof = Annotated[
    str,
    Field(pattern=r"^[A-Za-z0-9_-]{86}$", repr=False),
]


class CodeRequestOutcome(StrEnum):
    CODE_SENT = "code_sent"
    REGISTRATION_REQUIRED = "registration_required"


class VerificationOutcome(StrEnum):
    SIGNED_IN = "signed_in"
    REGISTRATION_CONFIRMED = "registration_confirmed"


class FinishOutcome(StrEnum):
    SESSION = "session"
    TICKET = "ticket"


class OriginPage(StrEnum):
    PUBLIC_BOOKING = "public_booking"
    MEETING_INVITE = "meeting_invite"


class SignInCodeRequest(BaseModel):
    email: EmailInput
    language: Language


class SignInCodeRequestResult(BaseModel):
    outcome: CodeRequestOutcome
    first_name: str | None


class RegistrationOrigin(BaseModel):
    page: OriginPage
    login: str
    meeting_id: UUID | None
    specialist_first_name: str | None = Field(
        default=None, json_schema_extra={"readOnly": True}
    )


class AccountRegistration(BaseModel):
    email: EmailInput
    first_name: Name = Field(repr=False)
    last_name: Name = Field(repr=False)
    language: Language
    consents: Annotated[
        list[ConsentAcceptance], Field(json_schema_extra={"minItems": 2})
    ]
    intent: RegistrationIntent | None = None
    origin: RegistrationOrigin | None = None


class AccountRegistrationResult(BaseModel):
    account_exists: bool
    first_name: str | None


class SignInCodeVerification(BaseModel):
    email: EmailInput
    code: Annotated[
        SecretStr,
        Field(
            repr=False,
            json_schema_extra={
                "pattern": "^[0-9]{6}$",
                "x-sensitive": True,
                "writeOnly": True,
            },
        ),
    ]
    registration: AccountRegistration | None = None
    registration_device_key: DevicePublicKey | None = None

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: SecretStr) -> SecretStr:
        if not fullmatch(r"[0-9]{6}", value.get_secret_value()):
            raise ValueError("Enter six digits")
        return value


class SignInSession(BaseModel):
    token: Token
    account: Account


class RegistrationPackageClaims(BaseModel):
    email: Email = Field(repr=False)
    first_name: Name = Field(repr=False)
    last_name: Name = Field(repr=False)
    consents: list[ConsentAcceptance]
    intent: RegistrationIntent | None
    origin: RegistrationOrigin | None
    entry_contour: Contour
    device_public_key: DevicePublicKey
    code_confirmed: bool
    issued_at: AwareDatetime
    expires_at: AwareDatetime


class RegistrationPackage(BaseModel):
    token: Token
    claims: RegistrationPackageClaims


class SignInCodeVerificationResult(BaseModel):
    outcome: VerificationOutcome
    session: SignInSession | None
    registration_package: RegistrationPackage | None


class RegistrationPackageRef(BaseModel):
    registration_package: SecretInput
    device_proof: DeviceProof


class RegistrationHandoffRequest(RegistrationPackageRef, extra="forbid"):
    selected_contour: Contour


class RegistrationHandoff(BaseModel):
    handoff: Token


class RegistrationLoginCheck(RegistrationPackageRef):
    login: str


class LoginAvailability(BaseModel):
    login: str
    status: LoginAvailabilityStatus


class AccountActivation(BaseModel):
    age_confirmed: Annotated[
        bool, Field(strict=True, json_schema_extra={"enum": [True]})
    ]
    acceptances: Annotated[
        list[ConsentAcceptance], Field(json_schema_extra={"minItems": 2})
    ]


class RegistrationFinish(RegistrationPackageRef):
    login: str
    language: Language
    time_zone: TimeZone
    consents: list[ConsentAcceptance] | None = None
    activation: AccountActivation | None = None
    notify_specialist: bool = False
    handoff: SecretStr | None = Field(
        default=None,
        repr=False,
        json_schema_extra={"x-sensitive": True, "writeOnly": True},
    )


class SignInTicket(BaseModel):
    ticket: Token
    ticket_url: Annotated[
        str, Field(repr=False, json_schema_extra={"format": "uri", "x-sensitive": True})
    ]
    expires_at: AwareDatetime


class SignInTicketExchange(BaseModel):
    ticket: Annotated[
        SecretStr, Field(repr=False, json_schema_extra={"x-sensitive": True})
    ]


class FinishRegistrationResult(BaseModel):
    outcome: FinishOutcome
    session: SignInSession | None
    ticket: SignInTicket | None
