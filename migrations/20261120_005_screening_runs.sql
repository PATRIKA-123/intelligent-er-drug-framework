-- B13. Persistent screening run ledger. Does not change clinical results.
CREATE TABLE IF NOT EXISTS public.screening_runs (
  engine_run_id uuid PRIMARY KEY,
  stay_id bigint NOT NULL REFERENCES public.ed_stays(stay_id),
  engine_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETE_ZERO_FINDINGS','COMPLETE_FINDINGS','FAILED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  drug_finding_count integer CHECK (drug_finding_count IS NULL OR drug_finding_count >= 0),
  alert_count integer CHECK (alert_count IS NULL OR alert_count >= 0),
  failure_code text,
  CONSTRAINT screening_runs_terminal_check CHECK (
    (status = 'RUNNING' AND completed_at IS NULL AND failure_code IS NULL) OR
    (status <> 'RUNNING' AND completed_at IS NOT NULL)
  ),
  CONSTRAINT screening_runs_completed_counts CHECK (
    status NOT IN ('COMPLETE_ZERO_FINDINGS','COMPLETE_FINDINGS') OR
    (drug_finding_count IS NOT NULL AND alert_count IS NOT NULL AND failure_code IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS screening_runs_one_running_per_stay
  ON public.screening_runs(stay_id) WHERE status = 'RUNNING';
CREATE INDEX IF NOT EXISTS screening_runs_stay_started
  ON public.screening_runs(stay_id, started_at DESC, engine_run_id DESC);
