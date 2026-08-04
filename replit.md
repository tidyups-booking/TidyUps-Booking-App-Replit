# 833 Tidyups Booking App

The operations hub for 833 Tidyups home cleaning service (Edmonton, AB), live at **https://bookcleaning.app** (autoscale, multi-instance). What started as a quick-booking tool now covers: dispatcher dashboard + fast booking form, **AI live-call panel** (Twilio answers calls, streams live transcription, AI extracts caller details in real time), **two-way Jobber sync** (bookings, edits, cancellations), **live cleaner GPS map**, a **cleaner mobile app** (Expo + Clerk), staff management, and dispatcher access control. Owner is non-technical — communicate in outcomes, not code.

**Product direction:** the owner plans to sell this system to other cleaning companies via the Jobber App Marketplace as a separate multi-tenant product — see `docs/jobber-marketplace-product-blueprint.md` and `docs/prompt-new-product-app.md`.

## Run & Operate

- `pnpm --filter @workspace/booking-app run dev` — run the frontend (via workflow)
- `pnpm --filter @workspace/api-server run dev` — run the API server (via workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter (routing), TanStack React Query, Tailwind CSS v4
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (v3), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Brand: 833 Tidyups — purple (#8870C4) / magenta (#EE3FCE), Poppins + Playfair Display
- Logo: `attached_assets/833tidyups-logo.png`

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/db/src/schema/bookings.ts` — bookings table schema
- `artifacts/api-server/src/routes/bookings.ts` — all booking CRUD + stats + upcoming routes
- `artifacts/booking-app/src/pages/` — dashboard, new-booking, bookings list, booking detail
- `artifacts/booking-app/src/components/` — badges, layout, and shadcn UI components

## Architecture decisions

- Single shared PostgreSQL DB; frontend calls `/api/*` routes via the shared reverse proxy
- Integer fields use `type: number` (not `type: integer`) in the OpenAPI spec to avoid Zod v3/v4 mismatch with orval — orval generates `zod.int()` for `integer` which doesn't exist in Zod v3
- Booking extras stored as a `text[]` Postgres array column
- `/bookings/stats` and `/bookings/upcoming` routes are declared BEFORE `/:id` in the Express router to prevent route conflicts

## Product

- Dashboard: stats (revenue, upcoming, pending, completed) + next 14 days schedule
- New Booking: fast phone-friendly form — service type, customer info, address, home size, extras chips, date/time, frequency, price estimate, notes; AI field indicators auto-fill from live calls
- All Bookings: filterable list by status
- Booking Detail: full view + status update + delete
- **Live-call AI panel**: Twilio answers (825) 533-4317, forwards to the business line, streams audio to the API server which transcribes and extracts caller details live on the dispatcher dashboard (SSE fan-out, works across autoscale instances)
- **Jobber integration**: two-way sync — bookings push to Jobber as client/property/request; Jobber webhooks (create/edit/cancel) flow back; OAuth connect flow in Settings
- **Cleaner mobile app** (`artifacts/cleaner-app`): Expo + Clerk login, schedule view, GPS tracking 8AM–8PM feeding the dispatcher Live Map (Leaflet + OSM)
- Staff management with dispatcher access control (Clerk-based, email bootstrap via `DISPATCHER_EMAILS`)
- Public booking site with contact form + spam filtering

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Phone numbers (live-call system)

- **(825) 533-4317** — the Twilio number. This is the ONLY number that activates the AI live-call panel; its voice webhook points at `https://bookcleaning.app/api/twilio/voice?sig=...` and calls forward to the business line.
- **(780) 718-5092** — `BUSINESS_PHONE_NUMBER` (where Twilio forwards answered calls); also shown on the public site.
- **833-843-9877** (advertised toll-free) and **587-900-7223** (advertised local) — carrier-side call forwarding to (825) 533-4317 is **confirmed live** (owner verified 2026-08-03). Calls to either advertised number now reach Twilio and ring through to (780) 718-5092.

## Gotchas

- After OpenAPI spec changes, always run `pnpm --filter @workspace/api-spec run codegen`
- After any `lib/*` change, run `pnpm run typecheck:libs` before checking artifact packages
- Never use `type: integer` in `openapi.yaml` — use `type: number` (Zod v3 compatibility)
- Express 5: wildcard routes need `/{*splat}`, not `*`; always annotate async handlers as `Promise<void>`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
