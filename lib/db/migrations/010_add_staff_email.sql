-- Add optional email address to staff records
ALTER TABLE staff ADD COLUMN IF NOT EXISTS email text;
