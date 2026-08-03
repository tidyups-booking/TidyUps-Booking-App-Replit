---
name: Jobber API quirks
description: Jobber GraphQL versioning pitfalls and drizzle array-param gotcha found while building calendar sync
---

# Jobber API quirks

- Jobber retires GraphQL API versions: pinned version `2024-11-15` began returning HTTP 404 "version does not exist". Currently pinned to `2025-04-16` (verified live). If Jobber calls suddenly 404, check the `X-JOBBER-GRAPHQL-VERSION` header first.
- Filter schema changes between versions: `JobFilterAttributes.scheduledBetween {startAt,endAt}` was removed; newer versions use `startAt: { after, before }` (Iso8601DateTimeRangeInput). Introspect `__type(name:"JobFilterAttributes")` when a filter field errors.
- **Why:** an invalid version or renamed filter fails every Jobber sync (manual and background) at once.
- Drizzle raw SQL: interpolating a JS array as `${arr}` expands to a tuple `($1,$2,...)`, which breaks `= ANY(...::text[])`. Use `${sql.param(arr)}` to bind the array as a single parameter.
- Background calendar auto-sync lives in api-server `services/jobberCalendarSync.ts` (shared with the manual sync route); its health is surfaced in `GET /jobber/status` under `autoSync`.
