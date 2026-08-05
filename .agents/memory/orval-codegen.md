---
name: Orval codegen + zod v3
description: OpenAPI spec constructs that break the workspace's orval-generated zod (zod v3)
---

**Rule:** In `lib/api-spec/openapi.yaml`, do not use `format: email` on string fields. Orval v8 emits `zod.email()` (a zod v4 API), but the workspace pins zod v3, so `typecheck:libs` fails with `Property 'email' does not exist`. Use a `pattern` regex instead (e.g. `^[^@\s]+@[^@\s]+\.[^@\s]+$`), which generates `.regex(...)` and works in v3.

**Why:** Hit when adding the public contact endpoint — orval succeeded but the chained typecheck failed, making it look like a codegen bug.

**How to apply:** Whenever adding string formats to the OpenAPI spec, prefer `pattern`/`minLength`/`maxLength`; if codegen "fails" during typecheck, check the generated `lib/api-zod/src/generated/api.ts` for zod v4-only calls.

## Never pass `queryKey` in generated hook options
Generated hooks compute `queryOptions?.queryKey ?? getXQueryKey(...)` — any override, even `queryKey: []` added to appease TS, REPLACES the URL-scoped key and collapses distinct queries into one shared cache entry (cross-view/cross-user leaks). Omit queryKey entirely; the `as any` cast already covers typing. Guarded by e2e-account-switch-cache-check.mts.
