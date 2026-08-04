# Ready-to-Paste Prompt — NEW Product App (the sellable version)

**How to use this:** create a brand-new Replit App, then paste everything below the line as your very first message. Also attach the file `docs/jobber-marketplace-product-blueprint.md` from this project (download it and drag it into the chat) — the prompt works alone, but the blueprint adds detail.

---

I'm building a **sellable product**: an AI receptionist + dispatch system that any cleaning company using Jobber can install from the Jobber App Marketplace. I already built and battle-tested a single-company version for my own cleaning business (833 Tidyups, live at bookcleaning.app) — this new app is the multi-company product version of it. I'm not technical: explain things by business outcome, not code, and make technical decisions yourself.

## The product

A cleaning company signs up, connects their own Jobber account, picks a phone number, and customizes what the AI receptionist says and asks. Then: calls to their number get answered, forwarded to their real phone, transcribed live on their dashboard while AI extracts the caller's name, address, and service details — and bookings sync two-way with their Jobber calendar.

## The setup wizard (core experience — think "configurator")

Checklist-style onboarding, no technical steps:
1. Create account → company workspace
2. Connect Jobber (one-click OAuth)
3. Pick a local phone number (provisioned automatically via Twilio) or forward their existing number
4. Customize the receptionist: business name + greeting script, checkboxes for what the AI should collect (name, address, service type, home size, pets, preferred date, budget, referral source), custom Q&A pairs ("Do you bring supplies?" → their answer), services + price ranges, and the phone number to ring through to
5. Invite dispatchers/cleaners with their own logins
6. Test-call button, then go live

## Architecture requirements (multi-company from day one)

- Every company's data fully separated (every table keyed by company)
- Each company OAuths their own Jobber account; Jobber webhooks routed by Jobber account ID
- One Twilio phone number per company (Twilio subaccounts); inbound calls routed by the dialed number
- AI prompts assembled from each company's wizard answers — never hardcoded
- Company logins with owner/dispatcher/cleaner roles (an auth system with organizations)
- Subscription billing (Stripe) with a free trial
- Neutral product branding (not 833 Tidyups); each company sees their own name in their dashboard

## Hard-won technical lessons from the working prototype (don't relearn these the hard way)

- **Twilio strips query strings from `<Stream>` WebSocket URLs.** Auth tokens for the audio stream must ride a nested `<Parameter name="token">` and be read from the start message's `customParameters` — a `?token=` in the URL never arrives. Synthetic tests pass with query tokens; real calls fail.
- **Production runs multi-instance (autoscale): never keep live-call or realtime state in process memory.** Use a shared database row + Postgres LISTEN/NOTIFY fan-out for live transcription to dashboards. One-time tokens must be enforced in the database (single-use table with atomic insert), not in memory.
- **Jobber's GraphQL API retires pinned versions** (old versions start 404ing and break every sync) — pin a current version, note it, and expect to bump it. Creating a booking requires client → property → request in sequence; "requestEdit" only edits the title.
- Webhook endpoints need their own simple auth (signed query param works — HTTP webhooks keep query strings; only Twilio's WebSocket streams lose them).
- Rate-limit / debounce bursts of Jobber webhooks so you don't hammer their API.

## Jobber Marketplace listing (the end goal)

Submitted from my Jobber Developer Center ("Manage Apps" → "Request a review"). Requirements: 2FA on my developer account, app logo uploaded, pre-submission checklist, listing copy (name, description, features/benefits) and gallery screenshots. Jobber tests the app themselves and coordinates release timing. Build so a Jobber reviewer can sign up and try it with a demo/test setup.

## Build order

1. Multi-company foundation: signup, company workspaces, role-based logins
2. Per-company Jobber OAuth + webhook routing
3. Per-company phone number provisioning + call routing
4. Setup wizard + configurable AI receptionist script
5. Live-call dashboard (transcription + AI extraction), scoped per company
6. Stripe subscription billing with trial
7. Marketplace assets (logo, screenshots, listing copy) + demo account for reviewers

## Before you start building

Ask me these one at a time (I haven't decided yet): the product's name/brand, monthly pricing, and whether version 1 includes the cleaner mobile app + GPS map or is dashboard-only. Then start with step 1 of the build order.

---
