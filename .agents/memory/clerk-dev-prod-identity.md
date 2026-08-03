---
name: Clerk dev/prod identity split
description: Dev and prod Clerk instances have separate user stores; anything keyed by Clerk user ID does not carry over to production
---

# Clerk dev/prod identity split

**Rule:** Replit-managed Clerk gives development and production separate user stores. The same person gets a DIFFERENT `user_...` ID in each environment. Any table keyed by Clerk user ID (e.g. `dispatcher_allowlist`, `staff.clerkUserId`) seeded or linked in dev will NOT match in prod — the user silently resolves to "denied"/unlinked with 403s on every guarded route.

**Why:** Production lockout on bookcleaning.app (2026-08-03): the allowlist migration seeded the dev owner ID; prod login had a different ID → 403 on all dispatcher routes, which blocked both the Jobber reconnect button and the live-call SSE feed (one root cause, two symptoms).

**How to apply:**
- Never seed Clerk IDs via migration and expect them to work in prod.
- Use stable identifiers (verified email) to bridge environments. The api-server now has `DISPATCHER_EMAILS` (shared env, comma-separated) email bootstrap in `callerRole.ts`: on a denied caller it checks the caller's VERIFIED Clerk emails and self-heals the allowlist row. Only cache negative (nonmatch) results per process; never cache matches, so transient Clerk/DB failures stay retryable.
- Same pattern applies to linking cleaner staff records across environments (staff.email exists for this).
- Diagnosis shortcut: prod deployment logs showing 403 on ALL dispatcher routes for a signed-in user = identity split, not a per-feature bug.
