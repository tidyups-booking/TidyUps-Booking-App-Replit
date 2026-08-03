-- Itemized price breakdown (hours, rate, discounts, fuel surcharge) recorded
-- at booking creation so dispatchers can see how the quoted price was built.
-- Mirrors the embedded entry in lib/db/src/migrate.ts (005_add_price_breakdown).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_breakdown JSONB;
