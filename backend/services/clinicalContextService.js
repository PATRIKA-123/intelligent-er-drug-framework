const pool = require("../db");

/**
 * Gathers the clinical context for one ED stay.
 *
 * Returns null if the stay itself does not exist, so the route
 * can translate that into a 404 instead of a fake empty context.
 *
 * Does NOT invent missing data. allergies/history currently have
 * zero rows in the project database (MIMIC-IV-ED Demo does not
 * provide them for this pipeline), so they are explicitly marked
 * "unavailable" rather than returned as an empty array, which
 * would look like "checked, found nothing."
 */
async function getClinicalContext(stayId) {
  // 1. The stay itself. If this doesn't exist, nothing else matters.
  const stayResult = await pool.query(
    `SELECT stay_id, subject_id, intime, outtime, gender, disposition,
            chiefcomplaint, acuity
     FROM ed_stays
     WHERE stay_id = $1`,
    [stayId]
  );

  if (stayResult.rows.length === 0) {
    return null;
  }

  const stay = stayResult.rows[0];

  // 2. Patient identity. ed_stays links to patients via subject_id,
  //    NOT patient_id (confirmed from the live schema).
  const patientResult = await pool.query(
    `SELECT patient_id, subject_id, data_source
     FROM patients
     WHERE subject_id = $1`,
    [stay.subject_id]
  );

  // 3. Diagnoses for this stay.
  const diagnosesResult = await pool.query(
    `SELECT seq_num, icd_code, icd_version, icd_title
     FROM diagnoses
     WHERE stay_id = $1
     ORDER BY seq_num`,
    [stayId]
  );

  // 4. Medications for this stay. medications.stay_id is nullable
  //    (124 of 2710 rows have no stay_id); filtering by stay_id here
  //    correctly excludes those, since they aren't linked to this stay.
  const medicationsResult = await pool.query(
    `SELECT medication_name, normalized_name, charttime
     FROM medications
     WHERE stay_id = $1
     ORDER BY charttime`,
    [stayId]
  );

  // 5. Latest observation (cleaned/deduplicated view).
  const latestObservationResult = await pool.query(
    `SELECT observation_id, observation_time, temperature, temperature_celsius,
            heart_rate, respiratory_rate, spo2, systolic_bp,
            consciousness, oxygen_support, spo2_scale
     FROM observations_clean
     WHERE stay_id = $1
     ORDER BY observation_time DESC
     LIMIT 1`,
    [stayId]
  );

  // 6. Latest NEWS2 result.
  const latestNews2Result = await pool.query(
    `SELECT observation_time, total_news2_score, risk_level
     FROM news2_results_real
     WHERE stay_id = $1
     ORDER BY observation_time DESC
     LIMIT 1`,
    [stayId]
  );

  // 7. Latest trend result.
  const latestTrendResult = await pool.query(
    `SELECT observation_time, trend_classification
     FROM trend_results
     WHERE stay_id = $1
     ORDER BY observation_time DESC
     LIMIT 1`,
    [stayId]
  );

  return {
    stay,
    patient: patientResult.rows[0] || null,
    diagnoses: diagnosesResult.rows,
    medications: medicationsResult.rows,
    latest_observation: latestObservationResult.rows[0] || null,
    latest_news2: latestNews2Result.rows[0] || null,
    latest_trend: latestTrendResult.rows[0] || null,
    allergies: "unavailable in current dataset",
    history: "unavailable in current dataset",
  };
}

module.exports = { getClinicalContext };