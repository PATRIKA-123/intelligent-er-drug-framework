const pool = require("../db");
const {
  getNormalizedMedications,
  autoMapMedication,
  resolveCandidateGenerics,
} = require("./medicationNormalizationService");
const { findDrugInteractions } = require("./ddinterService");
const { getColumns } = require("./schemaCapabilities");

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
     ORDER BY m.medication_id`,
    [medicationName]
  );

  if (result.rows.length === 0) {
    const candidates = resolveCandidateGenerics(medicationName);
    if (!candidates.length) {
      return {
        status: "UNMAPPED",
        canonical_identities: [],
        reason: "No exact medication mapping was found.",
      };
    }
    const verified = [];
    for (const candidate of candidates) {
      const dd = await pool.query(
        `SELECT drug_name FROM (
           SELECT DISTINCT LOWER(TRIM(drug_a)) AS drug_name FROM drug_interactions WHERE LOWER(TRIM(drug_a)) = $1
           UNION
           SELECT DISTINCT LOWER(TRIM(drug_b)) AS drug_name FROM drug_interactions WHERE LOWER(TRIM(drug_b)) = $1
         ) d LIMIT 1`,
        [candidate]
      );
      if (dd.rows.length > 0) verified.push(dd.rows[0].drug_name);
    }
    if (verified.length > 0) {
      return {
        status: "MAPPED",
        canonical_identities: [...new Set(verified)].sort(),
        reason: null,
      };
    }
    return {
      status: "UNMAPPED",
      canonical_identities: [],
      reason: "Drug not found in DDInter canonical dictionary.",
    };
  }

  const medications = new Map();
  for (const row of result.rows) {
    if (!medications.has(row.medication_id)) {
      medications.set(row.medication_id, { directMappings: [], components: [] });
    }
    const medication = medications.get(row.medication_id);
    if (row.direct_status !== null) {
      medication.directMappings.push({ canonical_name: row.canonical_name, status: row.direct_status });
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
        ...new Set(mappings.filter((item) => item.status === "MAPPED").map((item) => item.canonical_name).filter(Boolean)),
      ];
      const allMapped = mappings.every((item) => item.status === "MAPPED" && item.canonical_name);
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
      const allMapped = components.every((item) => item.status === "MAPPED" && item.canonical_name);
      if (!allMapped) {
        return {
          status: "INCOMPLETE_SCREENING",
          canonical_identities: [],
          reason: "One or more combination-drug ingredients are unmapped or pending.",
        };
      }
      ingredients = [...new Set(components.map((item) => item.canonical_name))];
    } else {
      return {
        status: "UNMAPPED",
        canonical_identities: [],
        reason: "No verified ingredient mapping exists.",
      };
    }
    resolvedSets.push(ingredients.map((name) => name.trim().toLowerCase()).sort());
  }

  const firstSet = JSON.stringify(resolvedSets[0]);
  if (!resolvedSets.every((set) => JSON.stringify(set) === firstSet)) {
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

async function screenPrescription(stayId, medicationName) {
  const prescriptionMapping = await resolvePrescriptionMedication(medicationName);
  if (prescriptionMapping.status !== "MAPPED") {
    return {
      screening_status: prescriptionMapping.status,
      mapping_reason: prescriptionMapping.reason,
      checked_pairs_count: 0,
      interactions_found: [],
      existing_unmapped_medications: [],
    };
  }

  const existingMedicationData = await getNormalizedMedications(stayId);
  const existingIdentities = existingMedicationData.canonical_identities;
  const proposedIdentities = prescriptionMapping.canonical_identities;
  const proposedSet = new Set(proposedIdentities.map((name) => name.toLowerCase()));
  const existingSet = new Set(existingIdentities.map((name) => name.toLowerCase()));
  const allIdentities = [...new Set([...existingIdentities, ...proposedIdentities])];

  const allPairs = [];
  for (let i = 0; i < allIdentities.length; i++) {
    for (let j = i + 1; j < allIdentities.length; j++) {
      const a = allIdentities[i].toLowerCase();
      const b = allIdentities[j].toLowerCase();
      if (proposedSet.has(a) || proposedSet.has(b)) allPairs.push([a, b]);
    }
  }

  const interactionResult = await findDrugInteractions(allIdentities);
  const relevantInteractions = interactionResult.interactions_found.filter((interaction) => {
    const a = interaction.drug_a.trim().toLowerCase();
    const b = interaction.drug_b.trim().toLowerCase();
    return (
      (proposedSet.has(a) && (existingSet.has(b) || proposedSet.has(b))) ||
      (proposedSet.has(b) && (existingSet.has(a) || proposedSet.has(a)))
    );
  });

  const existingUnmapped = existingMedicationData.unmapped_medications;
  return {
    screening_status: existingUnmapped.length > 0 ? "INCOMPLETE_SCREENING" : "SCREENED",
    mapping_reason: null,
    checked_pairs_count: allPairs.length,
    interactions_found: relevantInteractions,
    existing_unmapped_medications: existingUnmapped,
  };
}

async function createPrescription(stayId, data, doctorUserId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stayResult = await client.query(
      `SELECT e.stay_id, e.subject_id, p.patient_id
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
      `SELECT assignment_id FROM stay_doctor_assignments
       WHERE stay_id = $1 AND doctor_user_id = $2 AND status = 'ACTIVE' AND ended_at IS NULL
       LIMIT 1`,
      [stayId, doctorUserId]
    );
    if (assignmentResult.rows.length === 0) {
      const error = new Error("Only the actively assigned doctor can create a prescription.");
      error.statusCode = 403;
      throw error;
    }

    const screening = await screenPrescription(stayId, data.medication_name);
    const patientId = stayResult.rows[0].patient_id;

    const prescriptionResult = await client.query(
      `INSERT INTO prescriptions (
         patient_id, stay_id, medication_name, dosage, frequency, route, duration,
         prescribed_by, instructions, source, status, screening_result, screened_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'APPLICATION', 'PENDING_REVIEW', $10::jsonb, CURRENT_TIMESTAMP)
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
    return { prescription: prescriptionResult.rows[0], screening };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function reviewPrescription(stayId, prescriptionId, data, doctorUserId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stayResult = await client.query(
      `SELECT stay_id, subject_id FROM ed_stays WHERE stay_id = $1 FOR UPDATE`,
      [stayId]
    );
    if (stayResult.rows.length === 0) {
      const error = new Error("ED stay not found");
      error.statusCode = 404;
      throw error;
    }

    const assignmentResult = await client.query(
      `SELECT assignment_id FROM stay_doctor_assignments
       WHERE stay_id = $1 AND doctor_user_id = $2 AND status = 'ACTIVE' AND ended_at IS NULL
       LIMIT 1`,
      [stayId, doctorUserId]
    );
    if (assignmentResult.rows.length === 0) {
      const error = new Error("Only the actively assigned doctor can review prescriptions.");
      error.statusCode = 403;
      throw error;
    }

    const prescriptionResult = await client.query(
      `SELECT * FROM prescriptions WHERE prescription_id = $1 AND stay_id = $2 FOR UPDATE`,
      [prescriptionId, stayId]
    );
    if (prescriptionResult.rows.length === 0) {
      const error = new Error("Prescription not found for this stay");
      error.statusCode = 404;
      throw error;
    }
    if (prescriptionResult.rows[0].status !== "PENDING_REVIEW") {
      const error = new Error("This prescription has already been reviewed.");
      error.statusCode = 409;
      throw error;
    }

    let persistedReviewNotes = data.review_notes || null;
    if (data.status === "AUTHORIZED") {
      const screening = prescriptionResult.rows[0].screening_result;
      const screenStatus = screening?.screening_status;
      if (!screening || !["SCREENED", "UNMAPPED", "INCOMPLETE_SCREENING"].includes(screenStatus)) {
        const error = new Error("Missing or invalid drug screening result.");
        error.statusCode = 409;
        throw error;
      }
      const findings = Array.isArray(screening.interactions_found) ? screening.interactions_found : [];
      if (findings.length && data.acknowledged_interactions !== true) {
        const error = new Error("The assigned doctor must acknowledge detected interaction findings.");
        error.statusCode = 409;
        throw error;
      }
      if (screenStatus !== "SCREENED") {
        const justification = typeof data.review_notes === "string" ? data.review_notes.trim() : "";
        if (
          data.clinical_override !== true ||
          data.acknowledged_incomplete !== true ||
          justification.length < 30 ||
          justification.length > 1600
        ) {
          const error = new Error(
            "Documented clinical override, explicit acknowledgment, and a 30–1600 character justification are required for incomplete screening."
          );
          error.statusCode = 409;
          throw error;
        }
        const unknownCount = Array.isArray(screening.existing_unmapped_medications)
          ? screening.existing_unmapped_medications.length
          : 0;
        persistedReviewNotes =
          "[CLINICIAN_OVERRIDE; screening_status=" +
          screenStatus +
          "; interaction_findings=" +
          findings.length +
          "; unmapped_existing=" +
          unknownCount +
          "]\nClinical justification: " +
          justification;
      }

      const medName = prescriptionResult.rows[0].medication_name;
      const medInsert = await client.query(
        `INSERT INTO medications (subject_id, stay_id, charttime, medication_name, normalized_name)
         VALUES ($1, $2, CURRENT_TIMESTAMP, $3, LOWER(TRIM($3)))
         RETURNING medication_id`,
        [stayResult.rows[0].subject_id, stayId, medName]
      );
      if (medInsert.rows[0]?.medication_id) {
        await autoMapMedication(client, medInsert.rows[0].medication_id, medName);
      }
    }

    const result = await client.query(
      `UPDATE prescriptions
       SET status = $1, reviewed_by = $2, reviewed_at = CURRENT_TIMESTAMP, review_notes = $3
       WHERE prescription_id = $4 AND stay_id = $5
       RETURNING *`,
      [data.status, doctorUserId, persistedReviewNotes, prescriptionId, stayId]
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

async function getPrescriptions(stayId, options = {}) {
  const role = options.role || "DOCTOR";
  const columns = await getColumns("prescriptions");

  if (role === "PATIENT") {
    if (!columns.has("status")) return [];
    const patientColumns = [
      "prescription_id", "stay_id", "medication_name", "dosage", "frequency",
      "route", "duration", "prescribed_at", "instructions", "source", "created_at",
    ].filter((column) => columns.has(column));
    const result = await pool.query(
      `SELECT ${patientColumns.join(", ")} FROM prescriptions
       WHERE stay_id = $1 AND status = 'AUTHORIZED' ORDER BY created_at DESC`,
      [stayId]
    );
    return result.rows;
  }

  const staffColumns = [
    "prescription_id", "patient_id", "stay_id", "medication_name", "dosage",
    "frequency", "route", "duration", "prescribed_at", "prescribed_by",
    "instructions", "status", "screening_result", "screened_at",
    "reviewed_by", "reviewed_at", "review_notes", "source", "created_at",
  ].filter((column) => columns.has(column));
  const result = await pool.query(
    `SELECT ${staffColumns.join(", ")} FROM prescriptions WHERE stay_id = $1 ORDER BY created_at DESC`,
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
