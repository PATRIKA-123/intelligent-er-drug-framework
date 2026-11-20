-- B26: redacted, append-only operational audit events. No patient or payload data.
CREATE TABLE IF NOT EXISTS public.clinical_audit_events (
  audit_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor_id bigint,
  actor_role text,
  action text NOT NULL,
  resource_type text NOT NULL,
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  outcome text NOT NULL CHECK (outcome IN ('ALLOWED','DENIED','REJECTED','ERROR')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS clinical_audit_events_occurred_at_idx
 ON public.clinical_audit_events(occurred_at DESC);
CREATE OR REPLACE FUNCTION public.prevent_clinical_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'clinical_audit_events is append-only';
END;
$$;
DROP TRIGGER IF EXISTS clinical_audit_events_append_only ON public.clinical_audit_events;
CREATE TRIGGER clinical_audit_events_append_only BEFORE UPDATE OR DELETE
 ON public.clinical_audit_events FOR EACH ROW
 EXECUTE FUNCTION public.prevent_clinical_audit_event_mutation();
