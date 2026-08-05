---
name: Booking-app PWA (desktop install)
description: Why the dispatcher portal is installable via manifest only, with no service worker
---

# Booking-app PWA — manifest-only, no service worker

The dispatcher web portal is an installable PWA via `public/manifest.webmanifest` + icons + theme-color/apple-touch-icon tags in `index.html`, plus an `InstallAppButton` (beforeinstallprompt) in the header.

**Rule:** do NOT add a service worker without revisiting this decision.

**Why:** dispatchers use this as a live dispatch tool (calls, schedules, GPS map). A service worker's cache can serve stale bookings/schedules after a deploy or offline blip — worse than a plain error. Modern Chrome/Edge desktop install requires only a valid manifest + icons; no SW needed for installability.

**How to apply:**
- If offline support is ever requested, prefer network-first with explicit staleness UI, and version-bust aggressively.
- Icons were generated from `public/logo.png` with ImageMagick (`magick`; sharp unavailable). Maskable icon = logo at ~64% on white 512² canvas.
- Safari never fires `beforeinstallprompt` — the button correctly stays hidden there; Safari users install via File → Add to Dock (follow-up task exists for an in-app hint).
- `prompt()` on the captured event is single-use: clear captured state synchronously on click before awaiting.
