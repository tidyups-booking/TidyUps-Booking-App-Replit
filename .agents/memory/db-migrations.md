---
name: DB migration runners
description: How the dual migration runners (API startup + post-merge shell) must stay consistent
---

Two migration runners share the same `_migrations` ledger:
- Embedded startup runner: `lib/db/src/migrate.ts` (runs when api-server boots)
- File-based runner: `lib/db/migrate.sh` over `lib/db/migrations/*.sql` (runs in `scripts/post-merge.sh`)

**Rules** (violations got a task rejected in review):
- Both runners must cover the identical migration set under identical names (including `000_baseline`). Adding a `.sql` file without the matching embedded entry (or vice versa) causes schema divergence between deploy paths.
- Never rename an applied migration. If a rename already happened, add it to `RENAMED_MIGRATIONS` in `migrate.ts` AND the reconciliation block in `migrate.sh` so the new name is marked applied wherever the old one was.
- Apply + ledger-record must be one transaction (`BEGIN/COMMIT` in migrate.ts; `psql --single-transaction -f file -c insert` in migrate.sh).
- All migration SQL must be idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, duplicate_object catch).

**Why:** a merge once shipped a `.sql`-only jobber migration plus a rename (`002_add_jobber_job_id_unique_index` → `003_add_jobber_synced_job_id`), risking re-execution and divergent schemas depending on which runner ran first.

**How to apply:** when adding any migration, update both `migrate.ts` and `lib/db/migrations/`, then validate with scratch DBs (`CREATE DATABASE migrate_testN`) via both runners: fresh apply, re-run no-op, and cross-runner skip.
