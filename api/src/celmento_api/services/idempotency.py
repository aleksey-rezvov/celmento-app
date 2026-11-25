from hashlib import sha256
from json import dumps
from uuid import UUID

from pydantic import BaseModel


def request_fingerprint(body: BaseModel, target_id: UUID | None = None) -> str:
    payload: object = body.model_dump(mode="json", exclude_unset=True)
    raw = dumps(
        (str(target_id) if target_id is not None else None, payload),
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(raw.encode()).hexdigest()
