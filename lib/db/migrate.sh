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

# Reconcile renamed migrations: if the old name was recorded, mark the new
# name applied so the same migration never re-runs under a new name.
# Keep this list in sync with RENAMED_MIGRATIONS in src/migrate.ts.
psql "$DATABASE_URL" -q -c "
  INSERT INTO _migrations (name)
  SELECT '003_add_jobber_synced_job_id'
  WHERE EXISTS (SELECT 1 FROM _migrations WHERE name = '002_add_jobber_job_id_unique_index')
  ON CONFLICT (name) DO NOTHING;
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
  # Apply the migration and record it in ONE transaction (--single-transaction
  # wraps all -f/-c actions), so a failure can never leave an applied-but-
  # unrecorded migration that would re-run on retry.
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 --single-transaction \
    -f "$file" \
    -c "INSERT INTO _migrations (name) VALUES ('$name');"
  applied_count=$((applied_count + 1))
done

echo ""
echo "Done — applied $applied_count migration(s), skipped $skipped_count."
