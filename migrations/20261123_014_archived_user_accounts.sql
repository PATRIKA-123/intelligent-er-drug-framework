-- Run ON NEON (pravah2) before the updated Render backend is deployed.
-- Non-destructive. Preserve historical user references for clinical accountability.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_non_archived ON public.users(user_id) WHERE archived_at IS NULL;
COMMIT;
