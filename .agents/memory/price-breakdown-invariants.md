---
name: Booking price-breakdown invariants
description: Rules that keep the persisted quote itemization truthful across form flows and API clients
---
Bookings store a JSONB `priceBreakdown` that must always reconcile: base (hours × rate OR manualPrice, never both) − discounts + fuel = total = estimatedPrice.

**Why:** completion review repeatedly rejected the feature until every path (manual price edits, loyalty invalidation via phone change, over-quote discounts, price-only PATCHes from non-UI clients) preserved reconciliation.

**How to apply:** when touching booking pricing:
- Loyalty (10%) is canonically the LAST discount — the form blocks other discount controls while it's active; withdrawing it must add its amount back onto the quote.
- Discounts that would push the quote below $0 are refused (toast), never clamped.
- Direct price typing switches the breakdown to a manualPrice base and resets discount state.
- The API validates breakdowns server-side (POST/PATCH) and auto-clears a stored breakdown when a PATCH changes estimatedPrice without a replacement — keep that in sync with any new update path.
- Pure math + scripted assertions live in booking-app `src/lib/price-breakdown.ts|.check.ts` (run with tsx; no test framework in booking-app).
