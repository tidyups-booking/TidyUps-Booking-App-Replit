-- Dispatcher inbox: track when a contact message was marked handled.
-- NULL = new/unread; non-NULL = handled.
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS handled_at TIMESTAMPTZ;
