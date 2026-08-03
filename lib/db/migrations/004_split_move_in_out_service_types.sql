-- Move-in and move-out cleans are separate services.
-- move_in_out is kept for legacy rows but no longer offered in booking forms.
ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'move_in';
ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'move_out';
