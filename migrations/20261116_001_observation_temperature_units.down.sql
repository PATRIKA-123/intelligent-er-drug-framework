-- Rolls back 20261116_001_observation_temperature_units.sql.
-- Restores the previous view and removes the three columns (the unit
-- provenance is lost; the raw temperature values are not affected).
BEGIN;

DROP VIEW IF EXISTS observations_clean;
CREATE VIEW observations_clean AS
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
            WHEN (temperature > (50)::numeric) THEN round((((temperature - (32)::numeric) * 5.0) / 9.0), 1)
            ELSE temperature
        END AS temperature_celsius
   FROM observations
  ORDER BY stay_id, observation_time, observation_id;

ALTER TABLE observations
  DROP CONSTRAINT IF EXISTS observations_temperature_unit_status_check,
  DROP CONSTRAINT IF EXISTS observations_temperature_source_unit_check,
  DROP CONSTRAINT IF EXISTS observations_temperature_celsius_verified_check,
  DROP COLUMN IF EXISTS temperature_source_unit,
  DROP COLUMN IF EXISTS temperature_unit_status,
  DROP COLUMN IF EXISTS temperature_celsius_verified;

COMMIT;