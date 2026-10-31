
const pool = require("../db");

/**
 * Persists drug-safety findings for one ED stay.
 *
 * If options.client is supplied, the caller owns the transaction and
 * connection. This service must not BEGIN, COMMIT, ROLLBACK, or release
 * that external client.
 *
 * Without options.client, this service manages its own transaction.
 */
async function persistDrugSafetyResults(
  stayId,
  mappedMedications,
  interactionsFound,
  options = {}
) {
  const externalClient = options.client ?? null;
  const client = externalClient ?? await pool.connect();
  const ownsTransaction = !externalClient;

  try {
    if (ownsTransaction) {
      await client.query("BEGIN");
    }

    // Resolve patient_id; a missing stay must not change existing rows.
    const patientResult = await client.query(
      `SELECT p.patient_id
       FROM ed_stays e
       JOIN patients p ON p.subject_id = e.subject_id
       WHERE e.stay_id = $1`,
      [stayId]
    );

    if (patientResult.rows.length === 0) {
      if (ownsTransaction) {
        await client.query("ROLLBACK");
      }
      return null;
    }

    const patientId = patientResult.rows[0].patient_id;

    // Map each canonical drug name to its medication IDs.
    const medIdsByCanonicalName = new Map();

    for (const med of mappedMedications) {
      const key = String(med.canonical_name).toLowerCase();

      if (!medIdsByCanonicalName.has(key)) {
        medIdsByCanonicalName.set(key, []);
      }

      medIdsByCanonicalName.get(key).push(med.medication_id);
    }

    // Expand canonical interaction findings into medication-level rows.
    const rows = [];

    for (const finding of interactionsFound) {
      const drugA = String(finding.drug_a).toLowerCase();
      const drugB = String(finding.drug_b).toLowerCase();

      const medIdsA = medIdsByCanonicalName.get(drugA) || [];
      const medIdsB = medIdsByCanonicalName.get(drugB) || [];

      for (const medIdA of medIdsA) {
        for (const medIdB of medIdsB) {
          rows.push({
            medication_id_a: medIdA,
            medication_id_b: medIdB,
            component_a: drugA,
            component_b: drugB,
            interaction_id: finding.interaction_id,
            interaction_level: finding.interaction_level,
          });
        }
      }
    }

    // Replace this stay's current snapshot inside the active transaction.
    const deleteResult = await client.query(
      `DELETE FROM drug_safety_results
       WHERE stay_id = $1`,
      [stayId]
    );

    let insertedRows = [];

    
if (rows.length > 0) {
  const engineRunId = options.engineRunId ?? null;
  const engineVersion = options.engineVersion ?? null;

  if (!engineRunId || !engineVersion) {
    throw new Error(
      "Missing engineRunId or engineVersion for drug safety provenance"
    );
  }

  const insertResult = await client.query(
    `INSERT INTO drug_safety_results
       (patient_id, stay_id, medication_id_a, medication_id_b,
        component_a, component_b, interaction_id, interaction_level,
        result_status, source, engine_run_id, engine_version)
     SELECT $1, $2, a, b, ca, cb, iid, lvl,
            'INTERACTION_FOUND', 'DDInter_2.0', $9, $10
     FROM unnest(
       $3::int[], $4::int[], $5::text[],
       $6::text[], $7::int[], $8::text[]
     ) AS t(a, b, ca, cb, iid, lvl)
     RETURNING safety_result_id, medication_id_a, medication_id_b,
         component_a, component_b, interaction_id, interaction_level,
         engine_run_id, engine_version`,
    [
      patientId,
      stayId,
      rows.map((r) => r.medication_id_a),
      rows.map((r) => r.medication_id_b),
      rows.map((r) => r.component_a),
      rows.map((r) => r.component_b),
      rows.map((r) => r.interaction_id),
      rows.map((r) => r.interaction_level),
      engineRunId,
      engineVersion,
    ]
  );

  insertedRows = insertResult.rows;
}


    if (ownsTransaction) {
      await client.query("COMMIT");
    }

    return {
      stay_id: stayId,
      patient_id: patientId,
      deleted_count: deleteResult.rowCount,
      inserted_count: insertedRows.length,
      findings: insertedRows,
    };
  } catch (err) {
    if (ownsTransaction) {
      await client.query("ROLLBACK");
    }

    throw err;
  } finally {
    if (ownsTransaction) {
      client.release();
    }
  }
}

module.exports = { persistDrugSafetyResults };
