from argparse import ArgumentParser, Namespace
from asyncio import run
from datetime import UTC, datetime
from json import dumps
from secrets import token_urlsafe
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from celmento_api.admin_auth import admin_key_hash
from celmento_api.db import engine, session_factory
from celmento_api.models.admin import AdminKey


async def issue_key(session: AsyncSession, label: str) -> tuple[AdminKey, str]:
    normalized = label.strip()
    if not 1 <= len(normalized) <= 100 or "\0" in normalized:
        raise ValueError("Administrator label must have 1 to 100 characters")
    secret = f"clm_admin_{token_urlsafe(32)}"
    key = AdminKey(key_hash=admin_key_hash(secret), label=normalized)
    session.add(key)
    await session.flush()
    return key, secret


async def revoke_key(session: AsyncSession, key_id: UUID) -> bool:
    key = await session.get(AdminKey, key_id, with_for_update=True)
    if key is None:
        return False
    # spec:impl admin-ai-assistant#let-product-owner-revoke-administrator
    if key.revoked_at is None:
        key.revoked_at = datetime.now(UTC)
    return True


class KeyArguments(Namespace):
    command: str
    label: str
    id: UUID


async def _execute(args: KeyArguments) -> None:
    try:
        async with session_factory() as session:
            if args.command == "issue":
                key, secret = await issue_key(session, args.label)
                await session.commit()
                print(dumps({"admin_key_id": str(key.admin_key_id), "key": secret}))
            else:
                if not await revoke_key(session, args.id):
                    raise ValueError("No administrator key has that id")
                await session.commit()
    finally:
        await engine.dispose()


def main() -> None:
    parser = ArgumentParser(description="Manage keys for the configured contour")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("issue").add_argument("--label", required=True)
    subparsers.add_parser("revoke").add_argument("--id", type=UUID, required=True)
    args = KeyArguments()
    parser.parse_args(namespace=args)
    try:
        run(_execute(args))
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
