---
name: TS project references need lib rebuilds
description: api-server typechecks against lib/*/dist .d.ts, not source; stale dist breaks builds/deploys after schema or API type additions
---

# TS project references: rebuild libs after type additions

The api-server tsconfig uses project references to `lib/db` and `lib/api-zod` (both `composite` + `emitDeclarationOnly`, outDir `dist`). TypeScript resolves imports against the compiled `.d.ts` in `dist/`, NOT the source files — even though package.json `exports` point at `src/`.

**Why:** Two deployment failures (2026-08-03) came from merged code that added new schema files (`contact-messages`, `contact-throttle`) or new zod types without rebuilding — errors look like "Module '@workspace/db' has no exported member X" or "property does not exist" even though the source clearly has it.

**How to apply:** After ANY addition to `lib/db/src/schema/` or `lib/api-zod` types, run `pnpm exec tsc --build` in the lib package (the api-spec `codegen` script's `typecheck:libs` step also does this). If a "missing export" error appears for something that exists in source, check `lib/*/dist/` for a missing/stale `.d.ts` before anything else.
