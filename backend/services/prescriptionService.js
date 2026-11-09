const pool = require("../db");
const { getNormalizedMedications } = require("./medicationNormalizationService");
const { findDrugInteractions } = require("./ddinterService");

/**
 * Resolves a proposed medication using existing frozen mapping data.
 * No fuzzy matching or new mapping is performed.
 */
async function resolvePrescriptionMedication(medicationName) {
  const result = await pool.query(
    `SELECT DISTINCT
        m.medication_id,
        cm.canonical_name,
        cm.mapping_status AS direct_status,
        mc.component_name,
        mc.component_canonical_name,
        mc.mapping_status AS component_status
     FROM medications m
     LEFT JOIN canonical_medication_map cm
       ON cm.medication_id = m.medication_id
     LEFT JOIN medication_components mc
       ON mc.medication_id = m.medication_id
     WHERE LOWER(TRIM(m.medication_name)) = LOWER(TRIM($1))
        OR LOWER(TRIM(m.normalized_name)) = LOWER(TRIM($1))
        OR EXISTS (
          SELECT 1
          FROM canonical_medication_map cm2
          WHERE cm2.medication_id = m.medication_id
            AND LOWER(TRIM(cm2.source_name)) = LOWER(TRIM($1))
        )
     ORDER BY m.medication_id`,
    [medicationName]
  );

  if (result.rows.length === 0) {
    return {
      status: "UNMAPPED",
      canonical_identities: [],
      reason: "No exact medication mapping was found.",
    };
  }

  const medications = new Map();

  for (const row of result.rows) {
    if (!medications.has(row.medication_id)) {
      medications.set(row.medication_id, {
        directMappings: [],
        components: [],
      });
    }

    const medication = medications.get(row.medication_id);

    if (row.direct_status !== null) {
      medication.directMappings.push({
        canonical_name: row.canonical_name,
        status: row.direct_status,
      });
    }

    if (row.component_status !== null) {
      medication.components.push({
        canonical_name: row.component_canonical_name,
        status: row.component_status,
        component_name: row.component_name,
      });
    }
  }

  const resolvedSets = [];

  for (const medication of medications.values()) {
    let ingredients = [];

    if (medication.directMappings.length > 0) {
      const mappings = medication.directMappings;

      const canonicalNames = [
        ...new Set(
          mappings
            .filter((item) => item.status === "MAPPED")
            .map((item) => item.canonical_name)
            .filter(Boolean)
        ),
      ];

      const allMapped = mappings.every(
        (item) => item.status === "MAPPED" && item.canonical_name
      );

      if (!allMapped || canonicalNames.length !== 1) {
        return {
          status: "INCOMPLETE_SCREENING",
          canonical_identities: [],
          reason: "Direct medication mapping is incomplete or ambiguous.",
        };
      }

      ingredients = canonicalNames;
    } else if (medication.components.length > 0) {
      const components = medication.components;

      const allMapped = components.every(
        (item) =>
          item.status === "MAPPED" && item.canonical_name
      );

      if (!allMapped) {
        return {
          status: "INCOMPLETE_SCREENING",
          canonical_identities: [],
          reason: "One or more combination-drug ingredients are unmapped or pending.",
        };
      }

      ingredients = [
        ...new Set(components.map((item) => item.canonical_name)),
      ];
    } else {
      return {
        status: "UNMAPPED",
        canonical_identities: [],
        reason: "No verified ingredient mapping exists.",
      };
    }

    resolvedSets.push(
      ingredients.map((name) => name.trim().toLowerCase()).sort()
    );
  }

  const firstSet = JSON.stringify(resolvedSets[0]);

  const allConsistent = resolvedSets.every(
    (set) => JSON.stringify(set) === firstSet
  );

  if (!allConsistent) {
    return {
      status: "INCOMPLETE_SCREENING",
      canonical_identities: [],
      reason: "Matching medication records have conflicting ingredient mappings.",
    };
  }

  return {
    status: "MAPPED",
    canonical_identities: resolvedSets[0],
    reason: null,
  };
}

/**
 * Screens a proposed prescription against existing medications.
 * This function does not persist or modify drug safety results.
 */
async function screenPrescription(stayId, medicationName) {
  const prescriptionMapping =
    await resolvePrescriptionMedication(medicationName);

  if (prescriptionMapping.status !== "MAPPED") {
    return {
      screening_status: prescriptionMapping.status,
      mapping_reason: prescriptionMapping.reason,
      checked_pairs_count: 0,
      interactions_found: [],
      existing_unmapped_medications: [],
    };
  }

  const existingMedicationData =
    await getNormalizedMedications(stayId);

  const existingIdentities =
    existingMedicationData.canonical_identities;

  const proposedIdentities =
    prescriptionMapping.canonical_identities;

  const proposedSet = new Set(
    proposedIdentities.map((name) => name.toLowerCase())
  );

  const existingSet = new Set(
    existingIdentities.map((name) => name.toLowerCase())
  );

  const allIdentities = [
    ...new Set([...existingIdentities, ...proposedIdentities]),
  ];

  const allPairs = [];

  for (let i = 0; i < allIdentities.length; i++) {
    for (let j = i + 1; j < allIdentities.length; j++) {
      const a = allIdentities[i].toLowerCase();
      const b = allIdentities[j].toLowerCase();

      if (
        proposedSet.has(a) ||
        proposedSet.has(b)
      ) {
        allPairs.push([a, b]);
      }
    }
  }

  const interactionResult =
    await findDrugInteractions(allIdentities);

  const relevantInteractions =
    interactionResult.interactions_found.filter((interaction) => {
      const a = interaction.drug_a.trim().toLowerCase();
      const b = interaction.drug_b.trim().toLowerCase();

      return (
        (proposedSet.has(a) &&
          (existingSet.has(b) || proposedSet.has(b))) ||
        (proposedSet.has(b) &&
          (existingSet.has(a) || proposedSet.has(a)))
      );
    });

  const existingUnmapped =
    existingMedicationData.unmapped_medications;

  return {
    screening_status:
      existingUnmapped.length > 0
        ? "INCOMPLETE_SCREENING"
        : "SCREENED",
    mapping_reason: null,
    checked_pairs_count: allPairs.length,
    interactions_found: relevantInteractions,
    existing_unmapped_medications: existingUnmapped,
  };
}

/**
 * Creates a proposed prescription.
 * Only the actively assigned doctor may create it.
 */
async function createPrescription(stayId, data, doctorUserId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const stayResult = await client.query(
      `SELECT e.stay_id, p.patient_id
       FROM ed_stays e
       JOIN patients p ON p.subject_id = e.subject_id
       WHERE e.stay_id = $1
       FOR UPDATE OF e`,
      [stayId]
    );

    if (stayResult.rows.length === 0) {
      const error = new Error("ED stay or linked patient not found");
      error.statusCode = 404;
      throw error;
    }

    const assignmentResult = await client.query(
      `SELECT assignment_id
       FROM stay_doctor_assignments
       WHERE stay_id = $1
         AND doctor_user_id = $2
         AND status = 'ACTIVE'
         AND ended_at IS NULL
       LIMIT 1`,
      [stayId, doctorUserId]
    );

    if (assignmentResult.rows.length === 0) {
      const error = new Error(
        "Only the actively assigned doctor can create a prescription."
      );
      error.statusCode = 403;
      throw error;
    }

    const screening = await screenPrescription(
      stayId,
      data.medication_name
    );

    const patientId = stayResult.rows[0].patient_id;

    const prescriptionResult = await client.query(
      `INSERT INTO prescriptions (
         patient_id,
         stay_id,
         medication_name,
         dosage,
         frequency,
         route,
         duration,
         prescribed_by,
         instructions,
         source,
         status,
         screening_result,
         screened_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         'APPLICATION', 'PENDING_REVIEW', $10::jsonb, CURRENT_TIMESTAMP
       )
       RETURNING *`,
      [
        patientId,
        stayId,
        data.medication_name.trim(),
        data.dosage || null,
        data.frequency || null,
        data.route || null,
        data.duration || null,
        doctorUserId,
        data.instructions || null,
        JSON.stringify(screening),
      ]
    );

    await client.query("COMMIT");

    return {
      prescription: prescriptionResult.rows[0],
      screening,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Authorizes or rejects a pending prescription.
 * Only the actively assigned doctor may review it.
 */
async function reviewPrescription(
  stayId,
  prescriptionId,
  data,
  doctorUserId
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const stayResult = await client.query(
      `SELECT stay_id
       FROM ed_stays
       WHERE stay_id = $1
       FOR UPDATE`,
      [stayId]
    );

    if (stayResult.rows.length === 0) {
      const error = new Error("ED stay not found");
      error.statusCode = 404;
      throw error;
    }

    const assignmentResult = await client.query(
      `SELECT assignment_id
       FROM stay_doctor_assignments
       WHERE stay_id = $1
         AND doctor_user_id = $2
         AND status = 'ACTIVE'
         AND ended_at IS NULL
       LIMIT 1`,
      [stayId, doctorUserId]
    );

    if (assignmentResult.rows.length === 0) {
      const error = new Error(
        "Only the actively assigned doctor can review prescriptions."
      );
      error.statusCode = 403;
      throw error;
    }

    const prescriptionResult = await client.query(
      `SELECT *
       FROM prescriptions
       WHERE prescription_id = $1
         AND stay_id = $2
       FOR UPDATE`,
      [prescriptionId, stayId]
    );

    if (prescriptionResult.rows.length === 0) {
      const error = new Error("Prescription not found for this stay");
      error.statusCode = 404;
      throw error;
    }

    if (prescriptionResult.rows[0].status !== "PENDING_REVIEW") {
      const error = new Error(
        "This prescription has already been reviewed."
      );
      error.statusCode = 409;
      throw error;
    }

    if (data.status === "AUTHORIZED") {
      const screening = prescriptionResult.rows[0].screening_result;

      if (!screening || screening.screening_status !== "SCREENED") {
        const error = new Error(
          "Cannot authorize prescription because interaction screening is incomplete. Review the medication mapping and screening result first."
        );
        error.statusCode = 409;
        throw error;
      }
    }

    const result = await client.query(
      `UPDATE prescriptions
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = CURRENT_TIMESTAMP,
           review_notes = $3
       WHERE prescription_id = $4
         AND stay_id = $5
       RETURNING *`,
      [
        data.status,
        doctorUserId,
        data.review_notes || null,
        prescriptionId,
        stayId,
      ]
    );

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Retrieves prescriptions belonging to one ED stay.
 */
async function getPrescriptions(stayId) {
  const result = await pool.query(
    `SELECT
       prescription_id,
       patient_id,
       stay_id,
       medication_name,
       dosage,
       frequency,
       route,
       duration,
       prescribed_at,
       prescribed_by,
       instructions,
       status,
       screening_result,
       screened_at,
       reviewed_by,
       reviewed_at,
       review_notes,
       source,
       created_at
     FROM prescriptions
     WHERE stay_id = $1
     ORDER BY created_at DESC`,
    [stayId]
  );

  return result.rows;
}

module.exports = {
  resolvePrescriptionMedication,
  screenPrescription,
  createPrescription,
  reviewPrescription,
  getPrescriptions,
};
