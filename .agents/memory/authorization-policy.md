---
name: Authorization policy — dispatcher vs cleaner
description: Owner-confirmed rule for who can change what across the web portal, API, and cleaner app.
---

# Only dispatchers make changes; cleaners are view-only plus 3 self-service abilities

The rule (owner Richard confirmed 2026-08-04): **all mutations are dispatcher-only**, except cleaners (authenticated Clerk users linked to a staff record) may:

1. Mark **their own** assigned job `in_progress` / `completed` (status only — no other booking fields).
2. Edit **their own** staff record's contact fields (phone, email, homeAddress + coords).
3. Post **their own** GPS location (powers the live map).

4. (Accepted 2026-08-05, merged with owner approval) CLAIM an unassigned job for themselves — atomic conditional update, staffId IS NULL, loser gets 409. Any caller with a linked staff record may claim (incl. dispatcher-with-staff).

Cleaners get broad READ access (whole team's schedule, all job pins, live map, teammate job details) but never write to anyone else's data — and cannot reschedule/edit/cancel even their own jobs.

**Owner override (2026-08-05):** any account with a verified email in `DISPATCHER_EMAILS` (shared env → dev AND prod) ALWAYS resolves as dispatcher, even if staff-linked — and KEEPS its staffId so the cleaner app works for the owner. Dispatcher `CallerRole.staffId` is `number | null`. Elevation persists an allowlist row; revoking such an account requires removing the env email, not just the allowlist row. Clerk lookups are in-flight-coalesced + negative-cached (60s) per caller.

**Why:** Richard explicitly stated "only dispatchers can make changes" after team-wide schedule visibility shipped; he then confirmed keeping exactly these three self-service exceptions. Later he asked that "any of Richard's accounts, cleaner or dispatcher, get access to everything" and approved cleaner job-claiming.

**How to apply:**
- Any new mutation endpoint defaults to dispatcher-only (`guardDispatcher`/`requireDispatcherAuth`). Staff-visible reads use `guardStaff` (401 unauth, 403 unlinked accounts — unlinked-but-authenticated Clerk users get nothing).
- Enforce server-side, not just by hiding UI; e2e checks assert cleaner 403s on mutations.
- Claiming unassigned jobs is an accepted exception (see #4); any OTHER feature letting cleaners assign/modify jobs still needs explicit owner sign-off before building.
