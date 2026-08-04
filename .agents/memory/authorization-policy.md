---
name: Authorization policy — dispatcher vs cleaner
description: Owner-confirmed rule for who can change what across the web portal, API, and cleaner app.
---

# Only dispatchers make changes; cleaners are view-only plus 3 self-service abilities

The rule (owner Richard confirmed 2026-08-04): **all mutations are dispatcher-only**, except cleaners (authenticated Clerk users linked to a staff record) may:

1. Mark **their own** assigned job `in_progress` / `completed` (status only — no other booking fields).
2. Edit **their own** staff record's contact fields (phone, email, homeAddress + coords).
3. Post **their own** GPS location (powers the live map).

Cleaners get broad READ access (whole team's schedule, all job pins, live map, teammate job details) but never write to anyone else's data — and cannot reschedule/edit/cancel even their own jobs.

**Why:** Richard explicitly stated "only dispatchers can make changes" after team-wide schedule visibility shipped; he then confirmed keeping exactly these three self-service exceptions.

**How to apply:**
- Any new mutation endpoint defaults to dispatcher-only (`guardDispatcher`/`requireDispatcherAuth`). Staff-visible reads use `guardStaff` (401 unauth, 403 unlinked accounts — unlinked-but-authenticated Clerk users get nothing).
- Enforce server-side, not just by hiding UI; e2e checks assert cleaner 403s on mutations.
- Features that let cleaners assign/claim/modify jobs (e.g. "claim unassigned job" ideas) conflict with this rule — get explicit owner sign-off before building.
