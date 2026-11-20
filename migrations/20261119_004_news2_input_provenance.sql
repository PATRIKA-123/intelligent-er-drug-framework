-- B10: distinguish historical reconstruction from provenance captured on new NEWS2 inserts.
-- Apply ONLY through scripts/b10-provenance-local.js, to the isolated local test DB.
-- Never rewrite input measurements or existing NEWS2 scores.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='observations' AND column_name='spo2_scale_assumed') THEN
  RAISE EXCEPTION 'B10 missing spo2_scale_assumed migration';
 END IF;
 IF EXISTS (SELECT observation_id FROM public.news2_results_real GROUP BY observation_id HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Duplicate NEWS2 observation_id: manual review required';
 END IF;
 IF EXISTS (SELECT 1 FROM public.news2_results_real n LEFT JOIN public.observations o ON o.observation_id=n.observation_id WHERE o.observation_id IS NULL OR n.stay_id IS DISTINCT FROM o.stay_id OR n.observation_time IS DISTINCT FROM o.observation_time) THEN
  RAISE EXCEPTION 'NEWS2 row without exact observation link: manual review required';
 END IF;
END $$;
CREATE TABLE public.news2_input_provenance (
 observation_id integer PRIMARY KEY REFERENCES public.observations(observation_id) ON DELETE RESTRICT,
 stay_id bigint NOT NULL,
 observation_time timestamp without time zone NOT NULL,
 consciousness_assumed boolean,
 oxygen_support_assumed boolean,
 spo2_scale_assumed boolean,
 consciousness_missing boolean NOT NULL,
 oxygen_support_missing boolean NOT NULL,
 spo2_scale_missing boolean NOT NULL,
 provenance_origin text NOT NULL CHECK (provenance_origin IN ('HISTORICAL_DERIVED', 'CAPTURED_AT_INSERT')),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX news2_input_provenance_stay_idx ON public.news2_input_provenance(stay_id,observation_time);
CREATE TABLE public.news2_provenance_audit (
 audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 observation_id integer,
 event_type text NOT NULL CHECK (event_type IN ('HISTORICAL_RECONSTRUCTED','NEWS2_INSERT_CAPTURED','OBSERVATION_INPUT_CHANGED','NEWS2_RESULT_CHANGED')),
 event_details jsonb NOT NULL DEFAULT '{}'::jsonb,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX news2_provenance_audit_observation_idx ON public.news2_provenance_audit(observation_id,occurred_at);
CREATE FUNCTION public.b10_reject_provenance_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'B10 provenance and audit rows are append-only'; END $$;
CREATE TRIGGER b10_immutable_news2_input_provenance BEFORE UPDATE OR DELETE ON public.news2_input_provenance FOR EACH ROW EXECUTE FUNCTION public.b10_reject_provenance_mutation();
CREATE TRIGGER b10_immutable_news2_provenance_audit BEFORE UPDATE OR DELETE ON public.news2_provenance_audit FOR EACH ROW EXECUTE FUNCTION public.b10_reject_provenance_mutation();
-- Explicit provenance: these rows are reconstructed from current observations, not captured at calculation time.
INSERT INTO public.news2_input_provenance (
 observation_id,stay_id,observation_time,consciousness_assumed,oxygen_support_assumed,spo2_scale_assumed,
 consciousness_missing,oxygen_support_missing,spo2_scale_missing,provenance_origin
)
SELECT o.observation_id,o.stay_id,o.observation_time,o.consciousness_assumed,o.oxygen_support_assumed,o.spo2_scale_assumed,
       o.consciousness IS NULL,o.oxygen_support IS NULL,o.spo2_scale IS NULL,'HISTORICAL_DERIVED'
FROM public.news2_results_real n JOIN public.observations o ON o.observation_id=n.observation_id;
INSERT INTO public.news2_provenance_audit(observation_id,event_type,event_details)
SELECT observation_id,'HISTORICAL_RECONSTRUCTED',jsonb_build_object(
 'origin',provenance_origin,
 'assumed_flags',jsonb_build_object('consciousness',consciousness_assumed,'oxygen_support',oxygen_support_assumed,'spo2_scale',spo2_scale_assumed),
 'missing_inputs',jsonb_build_object('consciousness',consciousness_missing,'oxygen_support',oxygen_support_missing,'spo2_scale',spo2_scale_missing))
FROM public.news2_input_provenance;
-- Future results capture the flags when the score row is inserted.
CREATE FUNCTION public.b10_capture_news2_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obs public.observations%ROWTYPE;
BEGIN
 SELECT * INTO obs FROM public.observations WHERE observation_id=NEW.observation_id;
 IF NOT FOUND OR NEW.stay_id IS DISTINCT FROM obs.stay_id OR NEW.observation_time IS DISTINCT FROM obs.observation_time THEN
  RAISE EXCEPTION 'NEWS2 insert must reference matching observation';
 END IF;
 INSERT INTO public.news2_input_provenance(observation_id,stay_id,observation_time,
 consciousness_assumed,oxygen_support_assumed,spo2_scale_assumed,
 consciousness_missing,oxygen_support_missing,spo2_scale_missing,provenance_origin)
 VALUES(obs.observation_id,obs.stay_id,obs.observation_time,
 obs.consciousness_assumed,obs.oxygen_support_assumed,obs.spo2_scale_assumed,
 obs.consciousness IS NULL,obs.oxygen_support IS NULL,obs.spo2_scale IS NULL,'CAPTURED_AT_INSERT');
 INSERT INTO public.news2_provenance_audit(observation_id,event_type,event_details)
 VALUES(NEW.observation_id,'NEWS2_INSERT_CAPTURED',jsonb_build_object(
 'origin','CAPTURED_AT_INSERT',
 'assumed_flags',jsonb_build_object('consciousness',obs.consciousness_assumed,'oxygen_support',obs.oxygen_support_assumed,'spo2_scale',obs.spo2_scale_assumed),
 'missing_inputs',jsonb_build_object('consciousness',obs.consciousness IS NULL,'oxygen_support',obs.oxygen_support IS NULL,'spo2_scale',obs.spo2_scale IS NULL)));
 RETURN NEW;
END $$;
CREATE TRIGGER b10_news2_insert_provenance AFTER INSERT ON public.news2_results_real FOR EACH ROW EXECUTE FUNCTION public.b10_capture_news2_insert();
CREATE FUNCTION public.b10_audit_source_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD.consciousness,OLD.oxygen_support,OLD.spo2_scale,OLD.consciousness_assumed,OLD.oxygen_support_assumed,OLD.spo2_scale_assumed)
    IS DISTINCT FROM ROW(NEW.consciousness,NEW.oxygen_support,NEW.spo2_scale,NEW.consciousness_assumed,NEW.oxygen_support_assumed,NEW.spo2_scale_assumed) THEN
  INSERT INTO public.news2_provenance_audit(observation_id,event_type,event_details)
  VALUES(NEW.observation_id,'OBSERVATION_INPUT_CHANGED',jsonb_build_object('original_flags',jsonb_build_array(OLD.consciousness_assumed,OLD.oxygen_support_assumed,OLD.spo2_scale_assumed),'new_flags',jsonb_build_array(NEW.consciousness_assumed,NEW.oxygen_support_assumed,NEW.spo2_scale_assumed)));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER b10_observation_input_audit AFTER UPDATE ON public.observations FOR EACH ROW EXECUTE FUNCTION public.b10_audit_source_change();
CREATE FUNCTION public.b10_audit_news2_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.news2_provenance_audit(observation_id,event_type,event_details)
 VALUES(COALESCE(NEW.observation_id,OLD.observation_id),'NEWS2_RESULT_CHANGED',jsonb_build_object('operation',TG_OP));
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER b10_news2_change_audit AFTER UPDATE OR DELETE ON public.news2_results_real FOR EACH ROW EXECUTE FUNCTION public.b10_audit_news2_change();
