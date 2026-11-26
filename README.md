# celmēnto

A mobile diary for coaches and psychologists: meetings, clients, notes, practice hours and payments in one place. Clients book a session through a public link without installing the app.

The first version runs in a phone browser and installs as a standalone web app.
The product includes two independent contours and a separate MCP connection for administration.

## License

[MIT](LICENSE)

## Development

Use Python 3.15.2 with uv 0.13.10, Node.js 26.13.1 with pnpm 12.23.0, and Docker Compose.

- `api/` contains the FastAPI application, Alembic migrations and the administration server.
- `web/` contains the Next.js application, installation metadata and service worker.
- `docker-compose.yml` starts PostgreSQL 19 and Mailpit for development.

Copy `.env.example` to `.env` and store it with permissions `0600`. Use a separate value from `openssl rand -hex 32` for the database password and the session secret. Set `CLM_APP_DATABASE_URL` for development and `CLM_APP_TEST_DATABASE_URL` for the separate `celmento_app_test` database.

From the repository root, start the development services.

```sh
docker compose up -d --wait
```

PostgreSQL listens on `127.0.0.1:5433`. The first start provisions both `celmento_app` and `celmento_app_test`. Mailpit listens on SMTP port `1025` and has a web inbox at `http://127.0.0.1:8025`.

Apply schema changes to an existing database with `uv run --locked alembic upgrade head` from `api/`. Bootstrap an empty database with `api/scripts/schema-snapshot.sh restore` from the repository root. The command restores the generated schema and records the Alembic revision. Compare an upgraded database with `api/scripts/schema-snapshot.sh check`.

Start the API from `api/`.

```sh
uv sync --locked
uv run --locked alembic upgrade head
uv run --locked python -m celmento_api.seed --draft-documents
uv run --locked uvicorn celmento_api.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

The API schema is at `http://127.0.0.1:8000/api/v1/openapi.json`.

Start the web application from `web/`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000`. Use `pnpm build` and `pnpm start` for a production build with the service worker. A previously opened schedule or note can be read offline in the same signed-in session. Saving a meeting or editing a note requires a connection.

Stage the approved character files in `web/public/characters/` for the private build. Run `pnpm api:types` with the canonical specification repository checked out alongside this repository to regenerate the public web API types.

## Contours

Set `CLM_APP_CONTOUR` and `NEXT_PUBLIC_CLM_APP_CONTOUR` to the same value, `ru` or `world`. Each process group uses its own PostgreSQL database, media directory, session secret, registration signing key and SMTP inbox. Development email uses `CLM_APP_SMTP_HOST`, `CLM_APP_SMTP_PORT` and `CLM_APP_EMAIL_FROM`.

Configure the two web origins with `CLM_APP_WEB_URL_RU` and `CLM_APP_WEB_URL_WORLD`. Set `CLM_APP_PUBLIC_API_URL` to the contour's browser-visible API origin. In the web build, `NEXT_PUBLIC_CLM_APP_API_URL` points to its own API and `NEXT_PUBLIC_CLM_APP_OTHER_ZONE_URL` and `NEXT_PUBLIC_CLM_APP_OTHER_ZONE_API_URL` point to the other contour's web and API origins. Set these values before building.

Supply an Ed25519 key for `CLM_APP_REGISTRATION_PRIVATE_KEY` as base64 of a PEM private key. `CLM_APP_REGISTRATION_PUBLIC_KEY_RU` and `CLM_APP_REGISTRATION_PUBLIC_KEY_WORLD` are base64 of the corresponding DER SubjectPublicKeyInfo keys. The browser carries a signed handoff when the person chooses another contour. Each contour verifies it locally.

## Administration

Run these commands from `api/` with the target contour's configuration.

```sh
uv run --locked python -m celmento_api.admin_keys issue --label "Product owner"
uv run --locked python -m celmento_api.admin_keys revoke --id "$ADMIN_KEY_ID"
```

Issue prints the key once together with its identifier. Use the identifier as `ADMIN_KEY_ID` when revoking the key. Store the key in the MCP client's secret configuration and pass it only to the assistant process as `CLM_APP_ADMIN_KEY`. Set `CLM_APP_ADMIN_API_URL` to the same contour's API origin or its `/api/v1` URL. Use a separate connection and key for each contour. Configure the MCP client for stdio with `api/` as its working directory and this command.

```sh
uv run --locked python -m celmento_api.admin_assistant
```

The eleven tools cover feedback, statistics, the journal, account lookup, grants, legal version publication, preseeded templates and reserved logins. Changes use a preview and explicit confirmation. A batch above ten objects also requires confirmation of the count.

## Checks

Run API checks from `api/` with PostgreSQL running and the specification repository beside the app. The contract test compares every documented path, method and operation identifier with the API.

```sh
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked pyright
uv run --locked pytest
```

Run web checks from `web/`.

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
