-- Round 2 T5/T6: Apply only after confirming real staging schema and prior 009 migration.
BEGIN;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS full_name varchar(150);
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS phone varchar(30);
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS email varchar(150);
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS created_by integer REFERENCES public.users(user_id);
-- Existing MIMIC subject IDs are much smaller; validate against the current database before migration.
CREATE SEQUENCE IF NOT EXISTS public.parvah_patient_subject_seq AS bigint START WITH 9000000000;
CREATE SEQUENCE IF NOT EXISTS public.parvah_stay_id_seq AS bigint START WITH 90000001;
CREATE TABLE IF NOT EXISTS public.visit_access_codes (
  code_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stay_id bigint NOT NULL REFERENCES public.ed_stays(stay_id),
  patient_id integer NOT NULL REFERENCES public.patients(patient_id),
  code_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by integer REFERENCES public.users(user_id),
  revoked_at timestamptz,
  created_by integer NOT NULL REFERENCES public.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS visit_access_codes_one_active_per_stay
 ON public.visit_access_codes(stay_id) WHERE revoked_at IS NULL AND used_at IS NULL;
CREATE TABLE IF NOT EXISTS public.visit_registration_requests (
  key_hash char(64) PRIMARY KEY,
  created_by integer NOT NULL REFERENCES public.users(user_id),
  payload_hash char(64) NOT NULL,
  stay_id bigint UNIQUE REFERENCES public.ed_stays(stay_id),
  processing_status varchar(30) NOT NULL DEFAULT 'PENDING_INPUTS'
    CHECK (processing_status IN ('PENDING_INPUTS','RUNNING','COMPLETED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
