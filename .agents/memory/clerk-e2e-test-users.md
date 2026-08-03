---
name: Clerk e2e test users
description: Quirks when creating/mutating Clerk test users via the backend API in e2e checks
---
- Backend-created email addresses are VERIFIED automatically.
- Instance invariant: every user must keep ≥1 verified email — to test an unverified address, give the user a separate verified primary email first, then add/PATCH the target address unverified.
- Emails are globally unique; stray users from earlier failed runs cause `form_identifier_exists` 422s — look up owners by email and reuse/delete test-only strays instead of blindly creating.
**How to apply:** any e2e script minting +clerk_test users (see e2e-dispatcher-bootstrap-check.mts pattern).
