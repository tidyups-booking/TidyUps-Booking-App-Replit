#!/bin/bash
# test-migrations.sh — reproducible scratch-DB coverage for the migration pipeline.
#
# Verifies that BOTH migration runners (file-based migrate.sh and the embedded
# startup runner in src/migrate.ts, exercised via the built api-server bundle)
# produce the identical schema and ledger across these paths:
#
#   1. Fresh DB via migrate.sh
#   2. Re-run of migrate.sh is a no-op
#   3. Legacy DB whose ledger recorded the pre-rename Jobber migration name
#      (002_add_jobber_job_id_unique_index) — rename reconciliation must skip
#      the renamed file and never re-run it
#   4. Fresh DB via the embedded startup runner
#   5. Cross-runner: embedded runner against a migrate.sh-applied DB skips all
#   6. Pre-ledger DB (tables exist from old `drizzle-kit push` days, no
#      _migrations table) — idempotent migrations must complete without error
#
# Usage: DATABASE_URL=postgres://... bash lib/db/test-migrations.sh
# Creates and drops databases named _mig_test_{1..4} on the same server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
API_DIST="$ROOT/artifacts/api-server/dist/index.mjs"

if [ -z "${DATABASE_URL:-}" ]; then echo "ERROR: DATABASE_URL not set" >&2; exit 1; fi

BASE="${DATABASE_URL%/*}"
url() { echo "$BASE/$1"; }

# Expected ledger = every .sql file in migrations/, sorted by name (the same
# order psql/_migrations use), so this never goes stale when migrations land.
EXPECTED_LEDGER=$(ls "$SCRIPT_DIR"/migrations/*.sql | xargs -n1 basename | sed 's/\.sql$//' | sort)

fail() { echo "FAIL: $1" >&2; exit 1; }

assert_schema() { # $1 = db url, $2 = label
  local u="$1" label="$2"
  # Key objects that prove baseline + every incremental migration ran:
  psql "$u" -t -A -c "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('staff','bookings','call_transcripts','cleaner_locations','jobber_tokens','dispatcher_allowlist')" | grep -qx 6 \
    || fail "$label: expected 6 core tables"
  psql "$u" -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_name='staff' AND column_name='clerk_user_id'" | grep -qx 1 \
    || fail "$label: staff.clerk_user_id missing (001)"
  psql "$u" -t -A -c "SELECT count(*) FROM information_schema.columns WHERE table_name='bookings' AND column_name='jobber_synced_job_id'" | grep -qx 1 \
    || fail "$label: bookings.jobber_synced_job_id missing (003 jobber)"
  psql "$u" -t -A -c "SELECT count(*) FROM pg_indexes WHERE indexname='bookings_jobber_synced_job_id_unique'" | grep -qx 1 \
    || fail "$label: unique index on jobber_synced_job_id missing"
  psql "$u" -t -A -c "SELECT count(*) FROM dispatcher_allowlist" | grep -qEx '[1-9][0-9]*' \
    || fail "$label: owner dispatcher seed missing (003 seed)"
  echo "  ok: $label schema verified"
}

assert_ledger() { # $1 = db url, $2 = label, $3 = extra allowed names (regex, optional)
  local u="$1" label="$2" extra="${3:-^$}"
  local got
  got=$(psql "$u" -t -A -c "SELECT name FROM _migrations ORDER BY name" | grep -Ev "$extra")
  [ "$got" = "$EXPECTED_LEDGER" ] || fail "$label: ledger mismatch:
$got"
  echo "  ok: $label ledger verified"
}

run_embedded() { # $1 = db url — run built api-server briefly so its startup runner migrates
  [ -f "$API_DIST" ] || (cd "$ROOT/artifacts/api-server" && node ./build.mjs >/dev/null)
  DATABASE_URL="$1" PORT=9199 timeout 15 node --enable-source-maps "$API_DIST" 2>&1 | grep -E '^\[db\]' || true
}

cleanup() { for i in 1 2 3 4; do psql "$DATABASE_URL" -q -c "DROP DATABASE IF EXISTS _mig_test_$i" 2>/dev/null || true; done; }
trap cleanup EXIT
cleanup
for i in 1 2 3 4; do psql "$DATABASE_URL" -q -c "CREATE DATABASE _mig_test_$i"; done

echo "== 1. Fresh DB via migrate.sh =="
DATABASE_URL="$(url _mig_test_1)" bash "$SCRIPT_DIR/migrate.sh" >/dev/null
assert_schema "$(url _mig_test_1)" "fresh/migrate.sh"
assert_ledger "$(url _mig_test_1)" "fresh/migrate.sh"

echo "== 2. Re-run migrate.sh is a no-op =="
OUT=$(DATABASE_URL="$(url _mig_test_1)" bash "$SCRIPT_DIR/migrate.sh" 2>/dev/null | tail -1)
echo "$OUT" | grep -q "applied 0" || fail "re-run applied migrations: $OUT"
echo "  ok: re-run no-op"

echo "== 3. Legacy ledger with pre-rename Jobber name =="
LEGACY="$(url _mig_test_2)"
# A real legacy DB actually ran the old migration (its content is identical to
# the renamed 003 file — git rename R100), so apply baseline + that SQL first.
psql "$LEGACY" -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/migrations/000_baseline.sql" >/dev/null 2>&1
psql "$LEGACY" -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/migrations/003_add_jobber_synced_job_id.sql" >/dev/null 2>&1
psql "$LEGACY" -q -c "CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()); INSERT INTO _migrations (name) VALUES ('000_baseline'), ('002_add_jobber_job_id_unique_index');"
OUT=$(DATABASE_URL="$LEGACY" bash "$SCRIPT_DIR/migrate.sh" 2>/dev/null)
echo "$OUT" | grep -q "skipping  003_add_jobber_synced_job_id.sql" || fail "renamed migration was not reconciled/skipped"
assert_schema "$LEGACY" "legacy-rename"
assert_ledger "$LEGACY" "legacy-rename" "^002_add_jobber_job_id_unique_index$"
echo "  ok: rename reconciliation"

echo "== 4. Fresh DB via embedded startup runner =="
run_embedded "$(url _mig_test_3)" >/dev/null
assert_schema "$(url _mig_test_3)" "fresh/embedded"
assert_ledger "$(url _mig_test_3)" "fresh/embedded"

echo "== 5. Cross-runner: embedded runner on migrate.sh DB skips all =="
OUT=$(run_embedded "$(url _mig_test_1)")
echo "$OUT" | grep -q "migration applied" && fail "embedded runner re-applied on migrate.sh DB"
assert_ledger "$(url _mig_test_1)" "cross-runner"
echo "  ok: cross-runner consistency"

echo "== 6. Pre-ledger DB (tables exist, no _migrations) =="
PRELEDGER="$(url _mig_test_4)"
# Simulate a DB created by old drizzle push: baseline tables, no ledger
psql "$PRELEDGER" -q -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/migrations/000_baseline.sql"
DATABASE_URL="$PRELEDGER" bash "$SCRIPT_DIR/migrate.sh" >/dev/null
assert_schema "$PRELEDGER" "pre-ledger"
assert_ledger "$PRELEDGER" "pre-ledger"

echo ""
echo "ALL MIGRATION TESTS PASSED"
