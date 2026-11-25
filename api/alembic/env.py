import asyncio

from sqlalchemy.engine import Connection

from alembic import context
from celmento_api.config import get_settings
from celmento_api.db import Base, engine


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().database_url.get_secret_value(),
        target_metadata=Base.metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_sync_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_online_migrations() -> None:
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_sync_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_online_migrations())
