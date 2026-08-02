# Threat Model

## Project Overview

833 Tidyups Booking App is an internal quick-booking tool for a home cleaning service. Staff use it to log customer appointments taken over the phone in under 60 seconds. The app captures customer PII (name, phone, email, address), service details, and scheduling data. It integrates with Jobber (field-service management), Twilio (live call transcription), Google Maps (address autocomplete), and OpenAI (GPT + Whisper for AI-assisted booking extraction).

- **Tech stack:** Node.js 24, TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, React + Vite, Clerk authentication.
- **Deployment:** Public autoscale deployment at `https://bookcleaning.app` and `https://tidyups-booking.replit.app`.
- **Users:** Internal staff only — authenticated via Clerk.

## Assets

- **Customer PII** — first/last name, phone, email, home address, postal code for every booking. Compromise violates customer privacy and potential PIPEDA obligations.
- **Call transcripts** — verbatim phone conversation recordings including customer PII.
- **Staff home addresses and GPS locations** — stored in `staffTable` and `cleanerLocationsTable`. Exposure endangers staff safety.
- **Jobber OAuth tokens** — stored in `jobberTokensTable`. Compromise allows an attacker to read/write all Jobber clients and jobs.
- **API secrets** — `CLERK_SECRET_KEY`, `JOBBER_CLIENT_SECRET`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`. All held in env; not detected in source.
- **Booking business data** — scheduling, pricing, status, sync state.

## Trust Boundaries

- **Public internet → API** — The Express API is publicly reachable. Clerk `requireAuth` gates most routes, but the Twilio voice webhook and Jobber OAuth callback are intentionally public. The Twilio Media Streams WebSocket is also publicly reachable with no auth check.
- **Browser → API (CORS)** — CORS is configured with `origin: true` (reflect-any) and `credentials: true`, which removes the same-origin protection for credentialed requests.
- **API → Jobber** — OAuth2 bearer tokens stored in the database.
- **API → OpenAI** — API key in env; used for both Whisper transcription and GPT booking extraction.
- **API → Twilio** — Incoming webhooks are trusted without signature validation.
- **Authenticated staff vs. admin** — No role separation; all Clerk-authenticated users have identical privileges.

## Scan Anchors

- **Entry points:** `artifacts/api-server/src/routes/index.ts` (route registration + auth gating), `artifacts/api-server/src/app.ts` (CORS, body parser, `requireAuth` definition), `artifacts/api-server/src/index.ts` (HTTP server + WebSocket upgrade handler).
- **Highest-risk areas:** CORS config in `app.ts`, unauthenticated WebSocket in `index.ts` + `services/twilio-stream.ts`, Twilio webhook in `routes/twilio.ts`, staff location endpoint in `routes/map.ts`.
- **Public surfaces:** `GET /api/jobber/callback`, `POST /api/twilio/voice`, `WS /api/twilio/stream` (no auth at all).
- **Protected surfaces:** All `/api/*` routes behind `requireAuth` (Clerk), except the above three.
- **Dev-only:** `artifacts/mockup-sandbox/` — design mockups, not production.

## Threat Categories

### Spoofing

Clerk-based auth is applied to most routes via `requireAuth`. The main spoofing risk is the unauthenticated Twilio WebSocket (`/api/twilio/stream`), which accepts arbitrary WebSocket connections without verifying they originate from Twilio. An attacker can inject fake call events and manipulate the live transcript stream seen by staff.

The Twilio HTTP voice webhook (`POST /api/twilio/voice`) is also unauthenticated — Twilio provides HMAC-SHA1 request signatures for webhook validation, but the app does not check them.

### Tampering

- **CORS misconfiguration** — `cors({ credentials: true, origin: true })` reflects any origin with credentials, enabling credentialed cross-site requests from attacker-controlled pages.
- **Staff location spoofing** — `POST /api/staff/:id/location` requires authentication but not ownership; any staff user can overwrite any other staff member's GPS position.
- **Fake transcript injection via WebSocket** — unauthenticated WebSocket allows injecting fake transcripts that are broadcast to all SSE clients and run through OpenAI GPT, potentially filling the booking form with attacker-controlled values.

### Information Disclosure

- Staff home addresses and live GPS coordinates are returned to all authenticated users via `GET /api/map/data`, with no role restriction.
- Call transcripts (including verbatim customer conversations) are readable by any authenticated user for any booking ID (`GET /api/call-transcripts/:bookingId`).
- Error messages from Jobber callbacks and failed operations may expose internal state; most are benign.

### Denial of Service

- `express.json({ limit: "50mb" })` allows very large request bodies, creating memory pressure.
- No rate limiting on `POST /api/ai/extract-booking`, which invokes OpenAI GPT; abuse burns API credits.
- Unauthenticated WebSocket allows resource consumption (audio buffer, repeated Whisper/GPT calls) without any auth.

### Elevation of Privilege

No role separation exists — all authenticated users can create/edit/delete bookings, manage staff, and trigger Jobber sync. This is acceptable for an internal staff tool with a small, trusted user base, but should be documented as an assumption.
