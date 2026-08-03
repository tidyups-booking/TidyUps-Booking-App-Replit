---
name: Live-call cross-instance design
description: How the live-call panel survives autoscale multi-instance deployments
---
Live-call state is shared via Postgres, not process memory:
- Single-row table `live_call_state` (id=1) holds active_call_sid + running transcript; SSE `state` events read it, so late joiners on any instance sync up.
- Events fan out via NOTIFY on channel `live_call_events`; each instance holds a dedicated LISTEN connection (reconnects with backoff) and writes to its own local SSE clients. The publisher does NOT fan out locally — it hears its own NOTIFY, so delivery is uniform.
- NOTIFY payloads cap at ~8000 bytes; oversized events are slimmed (`needsHydration: true`) and listeners re-read the transcript from the table.
- Twilio stream tokens are stateless HMAC (keyed with SESSION_SECRET) over an expiry, because the /twilio/voice webhook and the WS upgrade can hit different instances. Single-use semantics were traded for cross-instance validity.
- Audio buffering stays in-process: the Twilio media WebSocket is pinned to one instance for the call's duration; only derived state is shared.

**Why:** production deployment is autoscale; in-memory call state silently broke the panel whenever webhook and SSE landed on different instances.
**How to apply:** any new live/realtime feature (presence, notifications) should use the same LISTEN/NOTIFY + shared-row pattern, never module-level state. E2E: `artifacts/api-server/e2e-multi-instance-livecall-check.mts` simulates a second instance.
