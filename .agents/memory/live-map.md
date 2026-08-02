---
name: Live Cleaner Map
description: Architecture and key decisions for the cleaner GPS tracking + live map feature
---

# Live Cleaner Map

## What was built
- `cleaner_locations` table — one row per staff member (upsert on staff_id), stores lat/lng/accuracy/updatedAt
- `POST /api/staff/:id/location` — cleaner phone pings their GPS every 30s
- `GET /api/map/data?date=YYYY-MM-DD` — returns all active staff with their latest location + today's bookings
- `/map` page — Leaflet + OpenStreetMap (no API key), custom DivIcon markers with initials in colored circles
- Cleaner self-ID — localStorage key `cleaner_map_staff_id`; no Clerk→staff linking needed
- Tracking window — `isTrackingHours()` checks 8AM–8PM client-side before starting watchPosition
- Nearest-cleaner hint on New Booking form — geocodes address via Nominatim after 1.2s debounce, computes haversine distance to all located cleaners, shows "Assign →" button

## Key decisions
- **No zod in api-server routes** — api-server's esbuild config doesn't bundle zod as a direct dep; use plain JS validation or `@workspace/api-zod`.
- **Nominatim geocoding** — free, no API key, rate limit ~1/s; used with 400ms stagger for job address batch and 1.2s debounce for booking form.
- **In-DB location storage** — not in-memory; survives server restarts, one row per staff with upsert.

**Why:** Simplicity — no Redis/socket infrastructure needed for 8 cleaners pinging every 30s.
