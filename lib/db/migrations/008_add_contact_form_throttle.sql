-- Per-IP throttle ledger for the public contact form.
-- Replaces the old in-memory rate limiter so limits survive restarts and
-- are shared across instances. One row per accepted submission attempt.
CREATE TABLE IF NOT EXISTS contact_form_throttle (
  id           BIGSERIAL PRIMARY KEY,
  ip           TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_form_throttle_ip_submitted_at_idx
  ON contact_form_throttle (ip, submitted_at);
