-- Homeowner pins: dispatcher-saved locations on the Live Map (address search
-- or dropped pin) used to eyeball distances between a home and the cleaners.
CREATE TABLE IF NOT EXISTS homeowner_pins (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
