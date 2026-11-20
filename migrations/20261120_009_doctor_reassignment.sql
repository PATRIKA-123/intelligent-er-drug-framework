-- Round 2 T4, apply only after inspecting the target staging schema.
-- Keep assignment history and allow REPLACED as a terminal state.
ALTER TABLE public.stay_doctor_assignments ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.stay_doctor_assignments ADD COLUMN IF NOT EXISTS replaced_at timestamptz;
ALTER TABLE public.stay_doctor_assignments ADD COLUMN IF NOT EXISTS replaced_by integer REFERENCES public.users(user_id);
-- Expected original constraint from schema-export.sql; review any drift before executing.
ALTER TABLE public.stay_doctor_assignments DROP CONSTRAINT IF EXISTS chk_assignment_status;
ALTER TABLE public.stay_doctor_assignments ADD CONSTRAINT chk_assignment_status
 CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED','REPLACED'));
-- Must clean any pre-existing duplicate ACTIVE rows before this runs; do not auto-delete.
CREATE UNIQUE INDEX IF NOT EXISTS round2_one_active_doctor_per_stay
 ON public.stay_doctor_assignments(stay_id) WHERE status='ACTIVE';
