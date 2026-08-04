-- Clerk backend invitation id (inv_...) for the sign-up email sent when a
-- pending dispatcher invite is created. Stored so that removing the invite
-- can also revoke the emailed sign-up link (see api-server
-- src/routes/dispatchers.ts). NULL when the email failed to send.
ALTER TABLE dispatcher_invites
  ADD COLUMN IF NOT EXISTS clerk_invitation_id TEXT;
