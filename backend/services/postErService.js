const pool = require("../db");
const { getClinicalSummary } = require("./clinicalSummaryService");
const { getPrescriptions } = require("./prescriptionService");
const { getColumns } = require("./schemaCapabilities");

async function getPostErData(stayId) {
  const clinicalSummary = await getClinicalSummary(stayId);

  if (!clinicalSummary) {
    return null;
  }

  const dischargeResult = await pool.query(
    `SELECT discharge_id, discharge_time, discharge_status,
            discharge_diagnosis, discharge_instructions,
            disposition, prescribed_followup, source, created_at
     FROM discharges
     WHERE stay_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [stayId]
  );

  const followUpsResult = await pool.query(
    `SELECT follow_up_id, follow_up_date, follow_up_type,
            department, provider_name, status, notes, created_at
     FROM follow_ups
     WHERE stay_id = $1
     ORDER BY follow_up_date ASC`,
    [stayId]
  );
    const assignedDoctor = await getAssignedDoctor(stayId);
  const prescriptions = await getPrescriptions(stayId);

   return {
    clinical_summary: clinicalSummary,
    assigned_doctor: assignedDoctor,
    discharge: dischargeResult.rows[0] || null,
    follow_ups: followUpsResult.rows,
    prescriptions,
  };
}



async function getAssignedDoctor(stayId) {
  const columns = await getColumns("stay_doctor_assignments");

  const assignmentDateColumn = columns.has("assigned_at")
    ? "assigned_at"
    : "created_at";

  if (!columns.has(assignmentDateColumn)) {
    throw new Error(
      "Neither assigned_at nor created_at exists in stay_doctor_assignments"
    );
  }

  const result = await pool.query(
    `SELECT
       a.assignment_id,
       a.stay_id,
       a.doctor_user_id,
       a.assigned_by,
       a.${assignmentDateColumn} AS assigned_at,
       a.status,
       a.notes,
       u.username,
       dp.full_name,
       dp.qualification,
       dp.specialization,
       dp.registration_number
     FROM stay_doctor_assignments a
     JOIN users u ON u.user_id = a.doctor_user_id
     JOIN doctor_profiles dp ON dp.user_id = u.user_id
     WHERE a.stay_id = $1
       AND a.status = 'ACTIVE'
     LIMIT 1`,
    [stayId]
  );

  return result.rows[0] || null;
}


async function assignDoctorToStay(stayId, doctorUserId, assignedBy, notes) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the stay row to prevent concurrent assignments.
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

    // Verify that the selected user is an active doctor.
    const doctorResult = await client.query(
      `SELECT u.user_id
       FROM users u
       JOIN doctor_profiles dp ON dp.user_id = u.user_id
       WHERE u.user_id = $1
         AND u.role = 'DOCTOR'
         AND u.is_active = TRUE`,
      [doctorUserId]
    );

    if (doctorResult.rows.length === 0) {
      const error = new Error(
        "Active doctor account or doctor profile not found"
      );
      error.statusCode = 404;
      throw error;
    }

    // Do not overwrite an existing active assignment.
    const existing = await client.query(
      `SELECT assignment_id
       FROM stay_doctor_assignments
       WHERE stay_id = $1
         AND status = 'ACTIVE'
       LIMIT 1`,
      [stayId]
    );

    if (existing.rows.length > 0) {
      const error = new Error(
        "An active doctor is already assigned to this stay"
      );
      error.statusCode = 409;
      throw error;
    }

    const result = await client.query(
      `INSERT INTO stay_doctor_assignments (
         stay_id,
         doctor_user_id,
         assigned_by,
         status,
         notes
       )
       VALUES ($1, $2, $3, 'ACTIVE', $4)
       RETURNING *`,
      [stayId, doctorUserId, assignedBy, notes || null]
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


async function createDischarge(stayId, data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the stay so doctor reassignment cannot race with authorization.
    const stayResult = await client.query(
      `SELECT e.stay_id, p.patient_id
       FROM ed_stays e
       JOIN patients p ON p.subject_id = e.subject_id
       WHERE e.stay_id = $1
       FOR UPDATE OF e`,
      [stayId]
    );

    if (stayResult.rows.length === 0) {
      const error = new Error("Stay or linked patient not found");
      error.statusCode = 404;
      throw error;
    }

    // Verify that the logged-in doctor is actively assigned to this stay.
    const assignmentResult = await client.query(
      `SELECT assignment_id
       FROM stay_doctor_assignments
       WHERE stay_id = $1
         AND doctor_user_id = $2
         AND status = 'ACTIVE'
         AND ended_at IS NULL
       LIMIT 1`,
      [stayId, data.authorized_by]
    );

    if (assignmentResult.rows.length === 0) {
      const error = new Error(
        "Only the actively assigned doctor can authorize discharge"
      );
      error.statusCode = 403;
      throw error;
    }

    // Prevent duplicate discharge records.
    const existing = await client.query(
      `SELECT discharge_id
       FROM discharges
       WHERE stay_id = $1
       LIMIT 1`,
      [stayId]
    );

    if (existing.rows.length > 0) {
      const error = new Error(
        "A discharge record already exists for this stay"
      );
      error.statusCode = 409;
      throw error;
    }

    const patientId = stayResult.rows[0].patient_id;

    const result = await client.query(
      `INSERT INTO discharges (
         patient_id,
         stay_id,
         discharge_time,
         discharge_status,
         discharge_diagnosis,
         discharge_instructions,
         disposition,
         prescribed_followup,
         source,
         authorized_by,
         authorized_at
       )
       VALUES (
         $1, $2, COALESCE($3::timestamp, CURRENT_TIMESTAMP),
         $4, $5, $6, $7, $8, 'APPLICATION',
         $9, CURRENT_TIMESTAMP
       )
       RETURNING *`,
      [
        patientId,
        stayId,
        data.discharge_time || null,
        data.discharge_status,
        data.discharge_diagnosis || null,
        data.discharge_instructions || null,
        data.disposition || null,
        data.prescribed_followup === true,
        data.authorized_by,
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


async function createFollowUp(stayId, data) {
  const stayResult = await pool.query(
    `SELECT e.stay_id, p.patient_id
     FROM ed_stays e
     JOIN patients p ON p.subject_id = e.subject_id
     WHERE e.stay_id = $1`,
    [stayId]
  );

  if (stayResult.rows.length === 0) {
    const error = new Error("Stay or linked patient not found");
    error.statusCode = 404;
    throw error;
  }

  const patientId = stayResult.rows[0].patient_id;

  const result = await pool.query(
    `INSERT INTO follow_ups (
       patient_id, stay_id, follow_up_date, follow_up_type,
       department, provider_name, status, notes, source
     )
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'PLANNED'),
             $8, 'APPLICATION')
     RETURNING *`,
    [
      patientId,
      stayId,
      data.follow_up_date,
      data.follow_up_type,
      data.department || null,
      data.provider_name || null,
      data.status || null,
      data.notes || null,
    ]
  );

  return result.rows[0];
}

module.exports = {
  getPostErData,
  createDischarge,
  createFollowUp,
  getAssignedDoctor,
  assignDoctorToStay,
};
