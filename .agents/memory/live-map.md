---
name: Live Cleaner Map
description: Architecture and key decisions for the cleaner GPS tracking + live map feature
---

# Live Cleaner Map

## What was built
- `cleaner_locations` table — one row per staff member (upsert on staff_id), stores lat/lng/accuracy/updatedAt
- Cleaner phones ping GPS every 30s; dispatcher map polls map data every 30s
- Map page uses **Google Maps JS API** (switched from Leaflet Aug 2026 at owner's request — wanted the Google look). Loader fetches the key from a dispatcher-guarded API endpoint, then injects the Maps script (`libraries=marker`, `mapId: "DEMO_MAP_ID"` for AdvancedMarkerElement support).
- Markers are `AdvancedMarkerElement`s with HTML content (colored initials circles); shared InfoWindow for popups; async geocode work guarded by a generation token so date switches can't resurrect stale pins.
- Cleaner self-ID — localStorage key `cleaner_map_staff_id`
- Tracking window — 8AM–8PM client-side check before starting watchPosition

## Key decisions
- **No zod in api-server routes** — api-server's esbuild config doesn't bundle zod as a direct dep; use plain JS validation or `@workspace/api-zod`.
- **Google Maps key is served to authenticated dispatchers only** via an API endpoint, not baked into the client bundle. Ensure the key is browser-restricted in Google Cloud; "Maps JavaScript API" must be enabled or `gm_authFailure` fires (surfaced as a banner on the map card).
- **Server-side geocoding is Google-backed** (geocode service: in-memory cache, small concurrency cap). A background backfill geocodes upcoming bookings missing coords every ~10 min and persists them, so map pins load straight from the DB; the frontend per-booking geocode remains only as a fallback.
- **Google Geocoding almost never returns ZERO_RESULTS** — even gibberish addresses resolve to approximate coords. Negative-path tests must inject a stub geocoder (the backfill accepts one); don't rely on fake addresses failing. The backfill keeps a per-process skip list of unresolvable rows so they can't starve valid rows behind them out of the batch window.
- **In-DB location storage** — not in-memory; survives server restarts.

**Why:** Simplicity — no Redis/socket infrastructure needed for 8 cleaners pinging every 30s.
