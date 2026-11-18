-- B09: record how each temperature value was interpreted.
-- Safe to re-run. Apply to a TEST database first. Nothing is deleted or
-- rewritten: the raw observations.temperature value is untouched, and rows that
-- have no unit status keep the OLD behaviour in the view until they are
-- classified (see scripts/backfillTemperatureUnits.js).
--
-- Roll back with: 20261116_001_observation_temperature_units.down.sql

BEGIN;

ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS temperature_source_unit varchar(1),
  ADD COLUMN IF NOT EXISTS temperature_unit_status varchar(30),
  ADD COLUMN IF NOT EXISTS temperature_celsius_verified numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'observations_temperature_unit_status_check'
      AND conrelid = 'observations'::regclass
  ) THEN
    ALTER TABLE observations
      ADD CONSTRAINT observations_temperature_unit_status_check
      CHECK (temperature_unit_status IS NULL OR temperature_unit_status IN
        ('CONVERTED_FROM_F','UNVERIFIED_CELSIUS','INFERRED_CELSIUS','IMPLAUSIBLE')),
      ADD CONSTRAINT observations_temperature_source_unit_check
      CHECK (temperature_source_unit IS NULL OR temperature_source_unit IN ('F','C')),
      ADD CONSTRAINT observations_temperature_celsius_verified_check
      CHECK (temperature_celsius_verified IS NULL OR temperature_celsius_verified BETWEEN 25 AND 45);
  END IF;
END $$;

-- Same columns as before, plus temperature_unit_status at the END.
-- temperature_celsius:
--   * row has a unit status  -> the stored canonical value (NULL when the unit
--                               is unverified or the value is implausible)
--   * row has no status yet  -> exactly the previous calculation
CREATE OR REPLACE VIEW observations_clean AS
 SELECT DISTINCT ON (stay_id, observation_time) observation_id,
    stay_id,
    observation_time,
    temperature,
    heart_rate,
    respiratory_rate,
    spo2,
    systolic_bp,
    data_source,
    consciousness,
    oxygen_support,
    spo2_scale,
        CASE
            WHEN temperature_unit_status IS NOT NULL THEN temperature_celsius_verified
            WHEN (temperature > (50)::numeric) THEN round((((temperature - (32)::numeric) * 5.0) / 9.0), 1)
            ELSE temperature
        END AS temperature_celsius,
    temperature_unit_status
   FROM observations
  ORDER BY stay_id, observation_time, observation_id;

COMMIT;