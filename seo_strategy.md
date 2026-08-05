# SEO Strategy — 833 Tidyups Booking App

## In scope
- `artifacts/booking-app` — internal staff booking app (React SPA, served publicly on Replit)
- `artifacts/cleaner-app` — cleaner mobile app with a public-facing Expo landing page

## Out of scope
- Authenticated dashboards / internal app pages (staff use only)
- `artifacts/mockup-sandbox` — design sandbox, not public-facing
- `artifacts/api-server` — API, not a user-facing page

## Target audience
- **Booking app**: Internal staff only (dispatchers / phone staff). Should NOT be indexed.
- **Cleaner app landing page**: Cleaners downloading the Expo app. Minimal public SEO relevance.

## Primary keywords
- N/A — both surfaces are internal/restricted tools, not public marketing pages.

## Rendering mode
- Booking app: SPA (React + Vite), no SSR
- Cleaner app: Expo (React Native), with a server-rendered landing page template

## Dismissed categories
- (None yet)

## Notes
- The booking app being indexed by Google is an active risk given `<meta name="robots" content="index, follow">` and `robots.txt Allow: /`. The app handles customer PII (names, addresses, contact details).
