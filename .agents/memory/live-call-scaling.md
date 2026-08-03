---
name: Live-call cross-instance design
description: How the live-call panel survives autoscale multi-instance deployments
---
Live-call state is shared via Postgres, not process memory:
- Single-row table `live_call_state` (id=1) holds active_call_sid + running transcript; SSE `state` events read it, so late joiners on any instance sync up.
- Events fan out via NOTIFY on channel `live_call_events`; each instance holds a dedicated LISTEN connection (reconnects with backoff) and writes to its own local SSE clients. The publisher does NOT fan out locally — it hears its own NOTIFY, so delivery is uniform.
- NOTIFY payloads cap at ~8000 bytes; oversized events are slimmed (`needsHydration: true`) and listeners re-read the transcript from the table.
- Twilio stream tokens are stateless HMAC (keyed with SESSION_SECRET) over `expiry.nonce` (random nonce prevents same-ms collisions), because the /twilio/voice webhook and the WS upgrade can hit different instances. Single-use is enforced cross-instance via atomic INSERT into `stream_token_uses` (replay → reject; DB error → fail closed).
- **Twilio STRIPS query strings when connecting to a TwiML `<Stream>` URL.** The `?token=` in the wss URL never arrives — every real call was rejected at upgrade ("invalid or missing stream token") while synthetic tests passed. Token must ride a nested `<Parameter name="token">`, which arrives in the start message's `start.customParameters`. WS upgrades without a query token are admitted provisionally (per-IP + global caps, short auth timeout, small maxPayload) and must authenticate in their start frame or be closed.
- The `live_call_state` row doubles as a strict cross-instance lease: claim/transcript-write/release are conditional UPDATEs keyed on active_call_sid (claim only when NULL or stale). Duplicate streams — even for the same CallSid — back off with close(1013); losing the lease suppresses call_ended so one stream can't end another's live call.
- Audio buffering stays in-process: the Twilio media WebSocket is pinned to one instance for the call's duration; only derived state is shared.

**Why:** production deployment is autoscale; in-memory call state silently broke the panel whenever webhook and SSE landed on different instances. The query-string stripping was invisible in dev because test clients keep the query.
**How to apply:** any new live/realtime feature (presence, notifications) should use the same LISTEN/NOTIFY + shared-row pattern, never module-level state. When integrating any Twilio streaming feature, pass auth via `<Parameter>`, never the URL. E2E: `e2e-multi-instance-livecall-check.mts` (fan-out) and `e2e-twilio-stream-auth-check.mts` (real-Twilio auth shape, replay, lease backoff) in artifacts/api-server.
