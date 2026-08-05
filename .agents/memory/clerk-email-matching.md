---
name: Clerk email-based identity matching
description: Match against ALL verified Clerk addresses, never just the primary email
---

Any feature that decides identity/status by comparing a stored email against a Clerk account must compare against **all verified addresses** on the account, not just the primary one.

**Why:** Access grants (dispatcher invites, staff self-link) accept any verified address, but Clerk profile summaries default to the primary email. Matching only the primary makes the UI misreport someone's status when the stored email is a secondary verified address (e.g. offering "Add to Dispatch" for an existing dispatcher, then 409 on click). This caused a code-review rejection.

**How to apply:** When exposing Clerk users through the API for matching purposes, include a lowercased `verifiedEmails` list alongside the display `email`, and match client-side against the full list. Keep the primary email for display only.
