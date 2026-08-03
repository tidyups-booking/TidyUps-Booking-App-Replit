#!/bin/bash
# migrate.sh — apply all pending SQL migrations in lib/db/migrations/
# Non-interactive: safe to run in CI / post-merge hooks with no TTY.
# Tracks applied migrations in the _migrations table (same table used by earlier
# manual runs). Already-applied files are skipped automatically.
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set" >&2
  exit 1
fi

# Resolve the migrations directory relative to this script, regardless of cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: migrations directory not found at $MIGRATIONS_DIR" >&2
  exit 1
fi

# Ensure the tracking table exists (idempotent).
psql "$DATABASE_URL" -q -c "
  CREATE TABLE IF NOT EXISTS _migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
"

echo "Running migrations from $MIGRATIONS_DIR"

# Iterate over .sql files in sorted (numeric) order.
shopt -s nullglob
sql_files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ ${#sql_files[@]} -eq 0 ]; then
  echo "No migration files found."
  exit 0
fi

applied_count=0
skipped_count=0

for file in "${sql_files[@]}"; do
  filename=$(basename "$file")
  name="${filename%.sql}"

  # Check whether this migration has already been recorded.
  already_applied=$(psql "$DATABASE_URL" -t -q -c \
    "SELECT COUNT(*) FROM _migrations WHERE name = '$name';" | tr -d '[:space:]')

  if [ "$already_applied" != "0" ]; then
    echo "  — skipping  $filename (already applied)"
    skipped_count=$((skipped_count + 1))
    continue
  fi

  echo "  ✦ applying  $filename"
  psql "$DATABASE_URL" -q -f "$file"
  psql "$DATABASE_URL" -q -c "INSERT INTO _migrations (name) VALUES ('$name');"
  applied_count=$((applied_count + 1))
done

echo ""
echo "Done — applied $applied_count migration(s), skipped $skipped_count."
