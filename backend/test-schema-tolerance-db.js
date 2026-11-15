// Real-database test: the access rules and Post-ER reads must work on BOTH
// database layouts - the older one (no ended_at / assigned_at / prescription
// status columns) and the newer one the Post-ER code was written for.
// Uses its own temporary schema (acl_tol) and drops it at the end.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env
//   node test-schema-tolerance-db.js

const pool = require("./db");
const { clearSchemaCache } = require("./services/schemaCapabilities");

let failed = 0, total = 0;
function check(name, got, expected) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `   (got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)})`));
}

async function build(client, { newer }) {
  await client.query("DROP SCHEMA IF EXISTS acl_tol CASCADE");
  await client.query("CREATE SCHEMA acl_tol");
  await client.query("SET search_path TO acl_tol");
  await client.query(`
    CREATE TABLE users (user_id INT PRIMARY KEY, username TEXT, role TEXT, patient_id INT);
    CREATE TABLE doctor_profiles (user_id INT, full_name TEXT, qualification TEXT,
                                  specialization TEXT, registration_number TEXT);
    CREATE TABLE stay_doctor_assignments (
      assignment_id SERIAL PRIMARY KEY, stay_id BIGINT, doctor_user_id INT,
      assigned_by INT, status TEXT, notes TEXT, created_at TIMESTAMP DEFAULT NOW()
      ${newer ? ", assigned_at TIMESTAMP DEFAULT NOW(), ended_at TIMESTAMP" : ""});
    CREATE TABLE prescriptions (
      prescription_id SERIAL PRIMARY KEY, patient_id INT, stay_id BIGINT,
      medication_name TEXT, dosage TEXT, frequency TEXT, route TEXT, duration TEXT,
      prescribed_at TIMESTAMP, prescribed_by INT, instructions TEXT, source TEXT,
      created_at TIMESTAMP DEFAULT NOW()
      ${newer ? ", status TEXT, screening_result JSONB, screened_at TIMESTAMP, reviewed_by INT, reviewed_at TIMESTAMP, review_notes TEXT" : ""});
    INSERT INTO users VALUES (40,'dr40','DOCTOR',NULL),(41,'dr41','DOCTOR',NULL);
    INSERT INTO doctor_profiles VALUES (40,'Dr Forty','MBBS','EM','R40'),(41,'Dr Forty-One','MBBS','EM','R41');
  `);
  if (newer) {
    await client.query(`
      INSERT INTO stay_doctor_assignments (stay_id, doctor_user_id, assigned_by, status, ended_at) VALUES
        (1, 40, 1, 'ACTIVE', NULL),
        (1, 41, 1, 'ACTIVE', NOW());   -- active status but already ended
      INSERT INTO prescriptions (patient_id, stay_id, medication_name, dosage, status, screening_result, reviewed_by, review_notes) VALUES
        (1, 1, 'DrugApproved', '5mg', 'AUTHORIZED', '{"x":1}', 40, 'internal note'),
        (1, 1, 'DrugPending',  '5mg', 'PENDING_REVIEW', '{"x":2}', NULL, NULL),
        (1, 1, 'DrugRejected', '5mg', 'REJECTED', '{"x":3}', 40, 'no');`);
  } else {
    await client.query(`
      INSERT INTO stay_doctor_assignments (stay_id, doctor_user_id, assigned_by, status) VALUES
        (1, 40, 1, 'ACTIVE'), (1, 41, 1, 'ENDED');
      INSERT INTO prescriptions (patient_id, stay_id, medication_name, dosage) VALUES (1, 1, 'DrugOld', '5mg');`);
  }
  clearSchemaCache();
}

(async () => {
  const client = await pool.connect();
  pool.query = client.query.bind(client);
  const policy = require("./services/accessPolicy");
  const { getPrescriptions } = require("./services/prescriptionService");
  const { getAssignedDoctor } = require("./services/postErService");

  try {
    // ---------- OLDER layout (what your Neon database has today) ----------
    console.log("--- older layout: no ended_at / assigned_at / prescription status ---");
    await build(client, { newer: false });
    check("doctor 40 assigned (no ended_at column)", await policy.isDoctorActivelyAssigned(client, 1, 40), true);
    check("doctor 41 inactive status", await policy.isDoctorActivelyAssigned(client, 1, 41), false);
    const f = await policy.stayListFilter({ user_id: 40, role: "DOCTOR" });
    check("doctor list filter builds and runs", (await client.query(`SELECT 1 WHERE 1 IN (SELECT 1 WHERE ${f.clause.replace("s.stay_id","1")})`, f.params)).rowCount, 1);
    check("assigned doctor read works without assigned_at", (await getAssignedDoctor(1)).doctor_user_id, 40);
    check("assigned doctor falls back to created_at", "assigned_at" in (await getAssignedDoctor(1)), true);
    check("PATIENT sees no prescriptions (cannot tell what is approved)", await getPrescriptions(1, { role: "PATIENT" }), []);
    const staffOld = await getPrescriptions(1, { role: "DOCTOR" });
    check("staff still see prescriptions", staffOld.map((r) => r.medication_name), ["DrugOld"]);

    // ---------- NEWER layout (what the GitHub Post-ER code expects) ----------
    console.log("--- newer layout: ended_at, assigned_at, prescription status ---");
    await build(client, { newer: true });
    check("doctor 40 assigned", await policy.isDoctorActivelyAssigned(client, 1, 40), true);
    check("doctor 41 ended_at set -> denied", await policy.isDoctorActivelyAssigned(client, 1, 41), false);
    check("assigned doctor read works with assigned_at", (await getAssignedDoctor(1)).doctor_user_id, 40);
    const pat = await getPrescriptions(1, { role: "PATIENT" });
    check("PATIENT sees only AUTHORIZED", pat.map((r) => r.medication_name), ["DrugApproved"]);
    check("PATIENT gets no internal fields",
      ["screening_result", "review_notes", "reviewed_by", "status", "patient_id"].some((c) => c in pat[0]), false);
    const staff = await getPrescriptions(1, { role: "DOCTOR" });
    check("DOCTOR sees all 3 with review fields", [staff.length, "review_notes" in staff[0], "status" in staff[0]], [3, true, true]);
  } catch (err) {
    failed++;
    console.error("TEST ERROR:", err.message);
  } finally {
    try { await client.query("SET search_path TO public"); await client.query("DROP SCHEMA IF EXISTS acl_tol CASCADE"); } catch (_) {}
    client.release();
    await pool.end();
    console.log(`\n${failed} FAILED / ${total} CHECKS`);
    process.exit(failed ? 1 : 0);
  }
})();
