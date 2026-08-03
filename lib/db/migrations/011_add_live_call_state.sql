-- Live call state shared across API server instances.
-- Single-row table: the current (only) active call's SID and running transcript.
-- Combined with Postgres LISTEN/NOTIFY on channel 'live_call_events', this lets
-- the Twilio webhook/WebSocket land on one instance while dispatcher SSE
-- connections on other instances still see the call.
CREATE TABLE IF NOT EXISTS live_call_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  active_call_sid TEXT,
  transcript      TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO live_call_state (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;
