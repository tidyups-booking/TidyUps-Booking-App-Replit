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

## Email-based access grants (dispatcher invites, 2026-08-04)

`dispatcher_invites` extends the same email-bridging pattern to UI-managed invites ("add by name + email"). Two security rules learned here:
- **Only VERIFIED Clerk emails may grant access** — anywhere an email grants a role (env list, invite claim, or direct-grant lookup by email). Anyone can attach an *unverified* copy of someone else's address to their own Clerk account and hijack the grant.
- **Claim before grant, atomically.** Win the invite with a conditional `UPDATE ... WHERE claimed_at IS NULL RETURNING` in the same transaction as the allowlist insert; grant nothing if zero rows. Otherwise a revoke racing a sign-in still leaks access. Also close out pending invites when access is granted another way, or a stale invite re-grants after a later revocation.
- Negative caching of denied callers must have a TTL (not a permanent per-process set), or a fresh invite won't take effect for someone who signed in too early.

**Invitation emails:** Clerk backend invitations (`clerkClient.invitations.createInvitation` with `notify: true, ignoreExisting: true`) send the sign-up email and pre-verify the address. The `redirectUrl` must point at the SAME Clerk environment that sent it (prod → live domain, dev → .replit.dev preview), because dev/prod user stores are separate.

## Staff-email self-link (cleaner self-service)
Cleaners sign up with the email on their staff record; the API links the account on the first authenticated request (same verified-emails-only rule as dispatcher grants). Two lessons:
- **Same-user race:** two parallel first requests can both attempt the conditional link UPDATE; the loser updates zero rows. Before negative-caching the loser, re-check whether the row now belongs to THIS caller — otherwise a freshly linked account gets denied for the cache TTL.
- **Client caching:** the mobile app's /staff/me query must retry briefly (not `retry: false`) or a race-loser 404 gets cached and the user sees "Account not linked" until manual refresh.
- **Bootstrap must run on the route the client actually calls:** the self-link lives in resolveCallerRole, but the app's first call (GET /staff/me) originally did a direct clerkUserId lookup and never resolved the role — so linking never fired in the real app despite passing in-process e2e. Any "links on first request" behavior needs an HTTP-level e2e through the real endpoint, not just direct function calls.
