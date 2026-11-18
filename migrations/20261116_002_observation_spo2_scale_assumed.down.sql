-- Rolls back 20261116_002_observation_spo2_scale_assumed.sql.
BEGIN;

ALTER TABLE observations
  DROP COLUMN IF EXISTS spo2_scale_assumed;

COMMIT;
