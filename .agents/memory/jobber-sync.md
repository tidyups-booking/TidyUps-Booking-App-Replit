---
name: Jobber sync
description: Jobber GraphQL API versioning pitfalls and how outbound booking sync must be shaped
---

# Jobber sync

- Jobber retires pinned GraphQL API versions (`X-JOBBER-GRAPHQL-VERSION`); a retired version returns HTTP 404 and silently breaks all syncs. **Why:** the previously pinned version disappeared and every sync failed until bumped.
- **How to apply:** when any Jobber call starts failing with 404 "version does not exist", bump the version constant in the jobber service, then re-verify every query/mutation via introspection — schema shapes change between versions.
- As of version 2025-01-20:
  - `clients` search uses a top-level `searchTerm` arg (not inside `ClientFilterAttributes`).
  - Addresses use `street1` (not `street`).
  - `requestCreate` no longer accepts inline `instructions` or `property`; flow is clientCreate → propertyCreate → requestCreate(clientId, propertyId, title) → requestCreateNote (pinned) for free-text details.
  - `requestEdit` can only change `title`; details edits must go through notes (`requestCreateNote` / `requestEditNote`).
- Safe live-test pattern: create a throwaway request, edit it, then `requestArchive` it to clean up.
