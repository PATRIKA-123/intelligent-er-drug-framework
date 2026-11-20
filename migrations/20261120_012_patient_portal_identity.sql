-- Round 2 D; STAGING FIRST. Requires B2 migration 010. No historical auto-linking.
BEGIN;
CREATE TABLE public.patient_profiles (
  user_id integer PRIMARY KEY REFERENCES public.users(user_id),
  patient_id integer NOT NULL UNIQUE REFERENCES public.patients(patient_id),
  full_name varchar(150) NOT NULL,
  date_of_birth date NOT NULL,
  phone varchar(30) NOT NULL,
  email varchar(150),
  share_history boolean NOT NULL DEFAULT false,
  consent_changed_at timestamptz NOT NULL DEFAULT now(),
  consent_version bigint NOT NULL DEFAULT 1,
  emergency_contact_name varchar(150),
  emergency_contact_phone varchar(30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.patient_visit_access (
  user_id integer NOT NULL REFERENCES public.users(user_id),
  stay_id bigint NOT NULL REFERENCES public.ed_stays(stay_id),
  source varchar(20) NOT NULL CHECK(source IN ('CLAIMED','STAFF_VERIFIED')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,stay_id),
  UNIQUE(stay_id)
);
CREATE TABLE public.patient_claim_attempts (
  attempt_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(user_id),
  stay_id bigint,
  ip_digest char(64) NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  succeeded boolean NOT NULL DEFAULT false
);
CREATE INDEX patient_claim_attempts_user_time ON public.patient_claim_attempts(user_id,attempted_at DESC);
CREATE INDEX patient_claim_attempts_stay_time ON public.patient_claim_attempts(stay_id,attempted_at DESC);
CREATE INDEX patient_claim_attempts_ip_time ON public.patient_claim_attempts(ip_digest,attempted_at DESC);
CREATE TABLE public.patient_identity_reviews (
  review_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stay_id bigint NOT NULL REFERENCES public.ed_stays(stay_id),
  requesting_user_id integer NOT NULL REFERENCES public.users(user_id),
  action varchar(24) NOT NULL CHECK(action IN ('CLAIM','CORRECTION')),
  status varchar(24) NOT NULL DEFAULT 'PENDING_VERIFICATION'
     CHECK(status IN ('PENDING_VERIFICATION','APPROVED','REJECTED')),
  prior_user_id integer REFERENCES public.users(user_id),
  reason varchar(500),
  code_id bigint REFERENCES public.visit_access_codes(code_id),
  verified_by integer REFERENCES public.users(user_id),
  verification_method varchar(200),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX patient_claim_pending_once ON public.patient_identity_reviews(stay_id,requesting_user_id)
  WHERE action='CLAIM' AND status='PENDING_VERIFICATION';
CREATE TABLE public.patient_identity_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stay_id bigint REFERENCES public.ed_stays(stay_id),
  actor_id integer NOT NULL REFERENCES public.users(user_id),
  action varchar(40) NOT NULL,
  prior_user_id integer REFERENCES public.users(user_id),
  new_user_id integer REFERENCES public.users(user_id),
  review_id bigint REFERENCES public.patient_identity_reviews(review_id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.patient_allergies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(user_id),
  name varchar(150) NOT NULL CHECK(length(btrim(name))>0),
  reaction varchar(200), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.patient_medications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(user_id),
  name varchar(150) NOT NULL CHECK(length(btrim(name))>0),
  dose varchar(100), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.patient_conditions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id integer NOT NULL REFERENCES public.users(user_id),
  name varchar(150) NOT NULL CHECK(length(btrim(name))>0),
  note varchar(200), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patient_allergies_owner ON public.patient_allergies(user_id);
CREATE INDEX patient_medications_owner ON public.patient_medications(user_id);
CREATE INDEX patient_conditions_owner ON public.patient_conditions(user_id);
COMMIT;
