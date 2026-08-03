-- Single-use enforcement for Twilio stream tokens.
-- Tokens are stateless HMACs (any instance can validate), but each token may
-- be consumed only once across ALL instances: consumption inserts the token
-- signature here, and a conflicting insert means the token was replayed.
CREATE TABLE IF NOT EXISTS stream_token_uses (
  token_sig  TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);
