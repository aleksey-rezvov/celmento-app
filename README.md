# celmēnto

A mobile diary for coaches and psychologists: meetings, clients, notes, practice hours and payments in one place. Clients book a session through a public link without installing the app.

## Status

Early development: the application code is on its way.

## License

[MIT](LICENSE)

## Development

Use Python 3.15.2 with uv 0.13.10, Node.js 26.13.1 with pnpm 12.23.0, and Docker Compose.

- `api/` contains the FastAPI application and Alembic configuration.
- `web/` contains the Next.js application.
- `docker-compose.yml` starts PostgreSQL 19 and Mailpit for development.

Copy `.env.example` to `.env`. Set a development database password and a development session secret using `openssl rand -hex 32` for each. Supply development Ed25519 registration keys through the corresponding variables. Store the file locally with permissions `0600`.

From the repository root, start the development services.

```sh
docker compose up -d --wait
```

PostgreSQL listens on `127.0.0.1:5433`. The first start provisions both `celmento_app` and `celmento_app_test`. Mailpit listens on SMTP port `1025` and has a web inbox at `http://127.0.0.1:8025`.

Apply schema changes to an existing database with `uv run --locked alembic upgrade head` from `api/`. Bootstrap an empty database with `api/scripts/schema-snapshot.sh restore` from the repository root. The command restores the generated schema and records the Alembic revision. Compare an upgraded database with `api/scripts/schema-snapshot.sh check`.

The API sends development mail to the SMTP host and port in `.env`. Run each contour with its own database, session secret, registration signing key, and SMTP inbox. Configure the two verification keys and the web and API origins in `.env`.

Start the API from `api/`.

```sh
uv sync --locked
uv run --locked alembic upgrade head
uv run --locked python -m celmento_api.seed --draft-documents
uv run uvicorn celmento_api.main:app --host 127.0.0.1 --port 8000
```

The API schema is at `http://127.0.0.1:8000/api/v1/openapi.json`.

Start the web application from `web/`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000`. To regenerate the web API types, use `pnpm api:types` with the celmēnto specification repository checked out alongside this repository.

## Checks

Run API checks from `api/` with the development database running.

```sh
uv run ruff format --check .
uv run ruff check .
uv run pyright
uv run pytest
```

Run web checks from `web/`.

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
