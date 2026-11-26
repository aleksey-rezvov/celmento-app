from dataclasses import dataclass, replace
from hashlib import sha256
from time import monotonic
from typing import Annotated
from uuid import UUID, uuid4

from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field, JsonValue, StrictBool, StrictInt

from celmento_api.admin_assistant.api import Method
from celmento_api.models.enums import AdminAction

BATCH_THRESHOLD: int = 10
PREVIEW_LIFETIME_SECONDS: float = 300.0

type Confirmed = Annotated[
    StrictBool,
    Field(
        description="True only after the administrator approves the displayed preview."
    ),
]
type ConfirmationCount = Annotated[
    StrictInt,
    Field(
        description="The object count the administrator named in their second confirmation."
    ),
]


@dataclass(frozen=True, slots=True)
class ChangeRequest:
    action: AdminAction
    method: Method
    path: str
    body: BaseModel

    def fingerprint(self) -> bytes:
        return sha256(f"{self.path}\n{self.body.model_dump_json()}".encode()).digest()


@dataclass(frozen=True, slots=True)
class Approval:
    confirmed: bool
    confirmation_id: UUID | None
    confirmed_count: int | None


class ChangeDetails(BaseModel):
    changes: dict[str, JsonValue]
    count: int = 1
    reminder: str | None = None
    base_version: int | None = Field(default=None, exclude=True)


class ChangePreview(ChangeDetails):
    confirmation_id: UUID


class CountConfirmation(BaseModel):
    confirmation_id: UUID
    confirmed_count_required: int


@dataclass(frozen=True, slots=True)
class PendingChange:
    action: AdminAction
    fingerprint: bytes
    count: int
    expires_at: float
    base_version: int | None
    needs_count: bool = False


class Confirmations:
    def __init__(self) -> None:
        self._pending: dict[UUID, PendingChange] = {}

    def preview(self, request: ChangeRequest, details: ChangeDetails) -> ChangePreview:
        now = monotonic()
        self._pending = {
            identifier: change
            for identifier, change in self._pending.items()
            if change.expires_at > now
        }
        identifier = uuid4()
        self._pending[identifier] = PendingChange(
            request.action,
            request.fingerprint(),
            details.count,
            now + PREVIEW_LIFETIME_SECONDS,
            details.base_version,
        )
        return ChangePreview(
            confirmation_id=identifier,
            changes=details.changes,
            count=details.count,
            reminder=details.reminder,
        )

    # spec:impl admin-ai-assistant#run-changing-action-two-steps
    def accept(
        self, request: ChangeRequest, approval: Approval
    ) -> CountConfirmation | PendingChange:
        identifier = approval.confirmation_id
        pending = self._pending.get(identifier) if identifier is not None else None
        if identifier is None or pending is None:
            raise ToolError("Request a preview before confirming this change.")
        if pending.expires_at <= monotonic():
            del self._pending[identifier]
            raise ToolError("This preview expired. Request and confirm a new preview.")
        if (
            pending.action != request.action
            or pending.fingerprint != request.fingerprint()
        ):
            raise ToolError(
                "This confirmation does not match the previewed action and arguments."
            )

        # spec:impl admin-ai-assistant#ask-second-confirmation-names-number
        if pending.needs_count:
            if approval.confirmed_count != pending.count:
                raise ToolError("Confirm again with the displayed object count.")
        elif approval.confirmed_count is not None:
            raise ToolError("First confirm the preview without an object count.")
        elif pending.count > BATCH_THRESHOLD:
            del self._pending[identifier]
            count_identifier = uuid4()
            self._pending[count_identifier] = replace(pending, needs_count=True)
            return CountConfirmation(
                confirmation_id=count_identifier,
                confirmed_count_required=pending.count,
            )

        # Consume approval before the network call, even when its outcome is uncertain.
        del self._pending[identifier]
        return pending
