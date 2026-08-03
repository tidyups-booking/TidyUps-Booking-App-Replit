---
name: Autoscale vs in-memory call state
description: In-memory one-time tokens and SSE broadcast state break on autoscale (multi-instance) deployments — confirmed live-call failure mode
---

# Autoscale vs in-memory call state

**Rule:** Anything held in a single process's memory — one-time stream tokens, active-call state, SSE subscriber lists — silently breaks on autoscale deployments, because consecutive requests (webhook POST, WebSocket upgrade, SSE connection) can land on different instances.

**Why:** Confirmed in production (2026-08-03): Twilio voice webhook hit one instance (200, token issued in memory), the WebSocket stream upgrade 4s later was rejected with "invalid or missing stream token" — it landed on a different instance. Dev always works (single process), so this class of bug only appears on the published site.

**How to apply:**
- Cross-request coordination state must live in a shared store (Postgres/DB) or the deployment must be pinned to a single instance.
- Diagnosis shortcut: feature works in workspace but not on the live site, and prod logs show the first webhook succeeding followed by a rejected follow-up connection → instance split.
- The live-call flow spans three connections (voice POST → WS stream → SSE transcript); ALL THREE must agree on state location.
