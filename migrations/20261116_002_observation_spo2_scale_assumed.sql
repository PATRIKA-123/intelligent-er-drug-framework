-- B10: record whether observations.spo2_scale was assumed (a demonstration
-- default) rather than measured. consciousness_assumed and
-- oxygen_support_assumed already exist; this adds the missing third flag.
-- Safe to re-run. Apply to a TEST database first. No data is changed.
--
-- Roll back with: 20261116_002_observation_spo2_scale_assumed.down.sql

BEGIN;

ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS spo2_scale_assumed boolean;

COMMIT;
