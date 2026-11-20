-- Round 2 Batch C staging migration. Review existing schema/data and apply on isolated staging first.
BEGIN;
ALTER TABLE public.ed_stays ADD COLUMN IF NOT EXISTS visit_status varchar(30) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE public.ed_stays ADD COLUMN IF NOT EXISTS departed_at timestamptz;
ALTER TABLE public.ed_stays ADD COLUMN IF NOT EXISTS departed_by integer REFERENCES public.users(user_id);
-- Legacy discharged visits: authorization is not physical departure.
UPDATE public.ed_stays s SET visit_status='DISCHARGE_AUTHORIZED'
 WHERE visit_status='ACTIVE' AND EXISTS(SELECT 1 FROM public.discharges d WHERE d.stay_id=s.stay_id);
ALTER TABLE public.ed_stays ADD CONSTRAINT round2_visit_status_check
 CHECK (visit_status IN ('ACTIVE','DISCHARGE_AUTHORIZED','DEPARTED')) NOT VALID;
CREATE TABLE IF NOT EXISTS public.er_vital_entries (
 entry_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 stay_id bigint NOT NULL REFERENCES public.ed_stays(stay_id),
 recorded_by integer NOT NULL REFERENCES public.users(user_id),
 observation_time timestamptz NOT NULL,
 heart_rate numeric, respiratory_rate numeric,systolic_bp numeric,diastolic_bp numeric,
 spo2 numeric,temperature_celsius numeric,consciousness varchar(20),oxygen_support boolean,spo2_scale smallint,
 scoring_status varchar(30) NOT NULL CHECK(scoring_status IN ('PENDING_INPUTS','COMPLETED')),
 news2_score integer,risk_level text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS er_vital_entries_stay_time ON public.er_vital_entries(stay_id,observation_time DESC);
COMMIT;
-- Important: application roles must still enforce status, permissions and case scope.
