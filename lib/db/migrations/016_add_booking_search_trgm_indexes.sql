-- Booking search uses ILIKE '%term%' across address, city, name, and phone.
-- Substring ILIKE can't use btree indexes, so add pg_trgm GIN indexes to keep
-- search fast as the bookings table grows into the thousands of rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS bookings_address_trgm_idx
  ON bookings USING gin (address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bookings_city_trgm_idx
  ON bookings USING gin (city gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bookings_first_name_trgm_idx
  ON bookings USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bookings_last_name_trgm_idx
  ON bookings USING gin (last_name gin_trgm_ops);
-- Matches the full-name ILIKE on (first_name || ' ' || last_name).
CREATE INDEX IF NOT EXISTS bookings_full_name_trgm_idx
  ON bookings USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS bookings_phone_trgm_idx
  ON bookings USING gin (phone gin_trgm_ops);
-- Digits-only phone match: routes search a normalized digits string instead of
-- the interleaved '%4%0%3%…' pattern (which defeats trigram indexes entirely).
CREATE INDEX IF NOT EXISTS bookings_phone_digits_trgm_idx
  ON bookings USING gin ((regexp_replace(phone, '\D', '', 'g')) gin_trgm_ops);
