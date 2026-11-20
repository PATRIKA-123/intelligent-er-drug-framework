-- B17: Quality-review metadata. No clinical observations are modified.
-- Date-shift semantics are dataset-level, not clinical encounter timestamps.
CREATE TABLE IF NOT EXISTS public.observation_quality_reviews (
  observation_id integer PRIMARY KEY REFERENCES public.observations(observation_id) ON DELETE CASCADE,
  data_source text NOT NULL,
  systolic_bp_review_required boolean NOT NULL DEFAULT false,
  quality_reason text NOT NULL,
  review_status text NOT NULL DEFAULT 'PENDING',
  reviewed_by integer REFERENCES public.users(user_id),
  reviewed_at timestamptz,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT observation_quality_review_status_check CHECK (review_status IN ('PENDING','CONFIRMED','DISMISSED')),
  CONSTRAINT observation_quality_review_complete_check CHECK (
    (review_status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (review_status IN ('CONFIRMED','DISMISSED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE TABLE IF NOT EXISTS public.dataset_time_semantics (
  data_source text PRIMARY KEY,
  privacy_shifted boolean NOT NULL,
  time_basis text NOT NULL,
  display_note text NOT NULL,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_observation_quality_review_pending
  ON public.observation_quality_reviews(review_status, data_source);
