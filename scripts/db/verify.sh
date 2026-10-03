#!/usr/bin/env bash
# マイグレーション・RLS・DBの関数を、使い捨ての PostgreSQL で確かめる（Docker 不要）。
# 使い方: pnpm db:verify   （PostgreSQL 16 のサーバが要る。PGBIN で場所を変えられる）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="${DB_VERIFY_WORKDIR:-$(mktemp -d)}"
PGDATA="$WORK/pgdata"
SOCKDIR="$WORK/sock"
PGPORT="${DB_VERIFY_PORT:-55433}"
mkdir -p "$PGDATA" "$SOCKDIR" "$WORK/sql/migrations"
# postgres ユーザーからリポジトリの場所が読めないこともあるので、SQL は作業用の場所に写してから流す
cp "$REPO_DIR"/scripts/db/*.sql "$WORK/sql/"
cp "$REPO_DIR"/supabase/migrations/*.sql "$WORK/sql/migrations/"
cp "$REPO_DIR"/supabase/seed.sql "$WORK/sql/seed.sql"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

run_as() {
  # postgres は root で動かせないので、root のときは postgres ユーザーで動かす
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres:postgres "$WORK"
    su postgres -s /bin/bash -c "$1"
  else
    bash -c "$1"
  fi
}

echo "==> initdb"
run_as "'$PGBIN/initdb' -D '$PGDATA' -A trust -U postgres" >/dev/null
echo "==> start postgres"
run_as "'$PGBIN/pg_ctl' -D '$PGDATA' -o '-p $PGPORT -k $SOCKDIR -c listen_addresses=' -w start" >/dev/null

PSQL="'$PGBIN/psql' -v ON_ERROR_STOP=1 -h '$SOCKDIR' -p $PGPORT -U postgres -d postgres -q"

echo "==> shims (auth / grants / storage)"
run_as "$PSQL -f '$WORK/sql/auth-shim.sql'"
# 権限の既定値はマイグレーションより前に流す（Supabase と同じく、作ったときに付く）
run_as "$PSQL -f '$WORK/sql/grants-shim.sql'"
run_as "$PSQL -f '$WORK/sql/storage-shim.sql'"

echo "==> migrations"
for f in "$WORK"/sql/migrations/*.sql; do
  echo "    - $(basename "$f")"
  run_as "$PSQL -f '$f'"
done

echo "==> seed"
run_as "$PSQL -f '$WORK/sql/seed.sql'"

echo "==> tests"
run_as "$PSQL -f '$WORK/sql/tests.sql'"

echo "==> OK"
