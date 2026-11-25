#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
action=${1:-}
database=${2:-celmento_app}
snapshot=api/alembic/schema.sql

postgres_command() {
  docker compose exec -T postgres sh -ec '
    export PGPASSWORD="$POSTGRES_PASSWORD"
    exec "$@"
  ' postgres "$@"
}

query() {
  postgres_command psql -h 127.0.0.1 -U celmento_app -d "$database" -X -v ON_ERROR_STOP=1 -Atc "$1" </dev/null
}

valid_revision() {
  [[ "$1" =~ ^[[:alnum:]_]+$ ]]
}

dump_schema() {
  local revision
  revision=$(query 'SELECT version_num FROM public.alembic_version')
  if ! valid_revision "$revision"; then
    printf '%s\n' 'The database must have exactly one Alembic head.' >&2
    return 1
  fi
  printf -- '-- Alembic revision: %s\n' "$revision"
  postgres_command pg_dump --host 127.0.0.1 --username celmento_app --dbname "$database" \
    --schema-only --no-owner --no-privileges --restrict-key=celmentoSchema </dev/null |
    python3 -c 'import sys; sys.stdout.write(sys.stdin.read().rstrip("\n") + "\n")'
}

restore_schema() {
  local revision
  revision=$(sed -n '1s/^-- Alembic revision: //p' "$snapshot")
  if ! valid_revision "$revision"; then
    printf '%s\n' 'The schema snapshot is missing its Alembic head.' >&2
    return 1
  fi
  if [[ "$(query "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")" != 0 ]]; then
    printf '%s\n' 'Restore the snapshot to an empty database.' >&2
    return 1
  fi
  {
    cat "$snapshot"
    printf "\nINSERT INTO public.alembic_version (version_num) VALUES ('%s');\n" "$revision"
  } | postgres_command psql -h 127.0.0.1 -U celmento_app -d "$database" -X -v ON_ERROR_STOP=1 --single-transaction -f -
}

case "$action" in
  dump) dump_schema ;;
  check) dump_schema | diff -u "$snapshot" - ;;
  restore) restore_schema ;;
  *) printf '%s\n' 'Usage: api/scripts/schema-snapshot.sh dump|check|restore [database]' >&2; exit 2 ;;
esac
