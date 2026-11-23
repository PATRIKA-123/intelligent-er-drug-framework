-- Run on Neon SQL Editor before deploying the admin management backend.
-- Records administrative actions and stores hashed, one-time reset tokens.
BEGIN;
CREATE TABLE IF NOT EXISTS public.admin_action_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id integer REFERENCES public.users(user_id) ON DELETE SET NULL,
  action varchar(80) NOT NULL,
  target_type varchar(40) NOT NULL,
  target_id varchar(80) NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_action_audit_created ON public.admin_action_audit(created_at DESC);
CREATE TABLE IF NOT EXISTS public.admin_password_resets (
  reset_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_by integer REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_admin_password_resets_user ON public.admin_password_resets(user_id);
COMMIT;
