-- Pending dispatcher invitations, added by name + email from the Staff page.
-- When someone signs in with a Clerk account whose VERIFIED email matches a
-- pending invite, they are added to dispatcher_allowlist automatically and
-- the invite is marked claimed (see api-server src/lib/callerRole.ts).
CREATE TABLE IF NOT EXISTS dispatcher_invites (
  id                    SERIAL PRIMARY KEY,
  email                 TEXT NOT NULL,
  name                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at            TIMESTAMPTZ,
  claimed_clerk_user_id TEXT
);

-- Only one PENDING invite per email; claimed invites are kept as history.
CREATE UNIQUE INDEX IF NOT EXISTS dispatcher_invites_pending_email_uq
  ON dispatcher_invites (lower(email))
  WHERE claimed_at IS NULL;
