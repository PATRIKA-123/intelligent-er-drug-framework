// Real-database test for services/accessPolicy.js (audit finding F01).
//
// It creates a throw-away schema called acl_test with its own small tables,
// runs every rule against real SQL, then drops the schema. It never reads or
// changes your real tables.
//
// Run on your TEST database only:
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (same as your other tests)
//   node test-access-policy-db.js

const pool = require("./db");

let failed = 0;
let total = 0;
function check(name, got, expected) {
  total++;
  const ok = got === expected;
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `   (got ${got}, expected ${expected})`));
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS acl_test CASCADE");
    await client.query("CREATE SCHEMA acl_test");
    await client.query("SET search_path TO acl_test");

    await client.query(`
      CREATE TABLE patients (patient_id INT PRIMARY KEY, subject_id INT);
      CREATE TABLE users (user_id INT PRIMARY KEY, role TEXT, patient_id INT);
      CREATE TABLE ed_stays (stay_id INT PRIMARY KEY, subject_id INT);
      CREATE TABLE emergency_cases (
        case_id INT PRIMARY KEY, patient_id INT, stay_id INT,
        case_status TEXT, created_by INT);
      CREATE TABLE stay_doctor_assignments (
        assignment_id SERIAL PRIMARY KEY, stay_id INT, doctor_user_id INT,
        status TEXT);

      -- Patient A (subject 1000, stay 1) and Patient B (subject 2000, stay 2)
      INSERT INTO patients VALUES (1, 1000), (2, 2000);
      INSERT INTO ed_stays VALUES (1, 1000), (2, 2000), (3, 3000);
      INSERT INTO users VALUES
        (10,'PATIENT',1), (11,'PATIENT',2),
        (20,'PARAMEDIC',NULL), (21,'PARAMEDIC',NULL),
        (30,'ER_STAFF',NULL), (40,'DOCTOR',NULL), (41,'DOCTOR',NULL),
        (50,'ADMIN',NULL);
      -- case 1: PRE_ER by paramedic 20 (stay 1) | case 2: ACTIVE_ER by paramedic 21 (stay 2)
      -- case 3: CLOSED by paramedic 20 (stay 3)
      INSERT INTO emergency_cases VALUES
        (1, 1, 1, 'PRE_ER', 20),
        (2, 2, 2, 'ACTIVE_ER', 21),
        (3, 1, 3, 'CLOSED', 20);
      -- doctor 40 active on stay 1; doctor 41 ended on stay 1, active on stay 2
      INSERT INTO stay_doctor_assignments (stay_id, doctor_user_id, status) VALUES
        (1, 40, 'ACTIVE'),
        (1, 41, 'ENDED'),
        (2, 41, 'ACTIVE');
    `);

    // Send every query from accessPolicy through this one client (search_path acl_test).
    pool.query = client.query.bind(client);
    const { canAccessStay, canAccessCase, stayListFilter } = require("./services/accessPolicy");
    const U = (user_id, role) => ({ user_id, role });
    const listFor = async (user) => {
      const f = await stayListFilter(user);
      const r = await client.query(
        `SELECT s.stay_id FROM ed_stays s WHERE ${f.clause} ORDER BY s.stay_id`, f.params);
      return r.rows.map((x) => x.stay_id).join(",");
    };

    console.log("--- stays ---");
    check("ADMIN any stay", await canAccessStay(U(50,"ADMIN"), 3), true);
    check("Patient A own stay 1", await canAccessStay(U(10,"PATIENT"), 1), true);
    check("Patient A -> Patient B stay 2 (cross-patient)", await canAccessStay(U(10,"PATIENT"), 2), false);
    check("Patient B -> Patient A stay 1 (cross-patient)", await canAccessStay(U(11,"PATIENT"), 1), false);
    check("Paramedic 20 own case stay 1", await canAccessStay(U(20,"PARAMEDIC"), 1), true);
    check("Paramedic 20 -> stay 2 (other's case)", await canAccessStay(U(20,"PARAMEDIC"), 2), false);
    check("ER_STAFF live case stay 2 (ACTIVE_ER)", await canAccessStay(U(30,"ER_STAFF"), 2), true);
    check("ER_STAFF PRE_ER stay 1", await canAccessStay(U(30,"ER_STAFF"), 1), false);
    check("ER_STAFF CLOSED stay 3 (normal route)", await canAccessStay(U(30,"ER_STAFF"), 3), false);
    check("ER_STAFF CLOSED stay 3 (Post-ER route)", await canAccessStay(U(30,"ER_STAFF"), 3, { postEr: true }), true);
    check("ER_STAFF PRE_ER stay 1 even on Post-ER route", await canAccessStay(U(30,"ER_STAFF"), 1, { postEr: true }), false);
    check("Paramedic gets no extra access on Post-ER route", await canAccessStay(U(20,"PARAMEDIC"), 2, { postEr: true }), false);
    check("Patient A -> Patient B stay on Post-ER route", await canAccessStay(U(10,"PATIENT"), 2, { postEr: true }), false);
    check("ER_STAFF CLOSED stay 3 on Post-ER route", await canAccessStay(U(30,"ER_STAFF"), 3, { postEr: true }), true);
    check("ER_STAFF PRE_ER stay 1 even on Post-ER route", await canAccessStay(U(30,"ER_STAFF"), 1, { postEr: true }), false);
    check("Paramedic CLOSED stay 3 unchanged by postEr flag (own case)", await canAccessStay(U(20,"PARAMEDIC"), 3, { postEr: true }), true);
    check("Paramedic 21 -> stay 3 with postEr flag (not creator)", await canAccessStay(U(21,"PARAMEDIC"), 3, { postEr: true }), false);
    check("Patient A -> stay 2 with postEr flag", await canAccessStay(U(10,"PATIENT"), 2, { postEr: true }), false);
    check("Doctor 40 assigned stay 1", await canAccessStay(U(40,"DOCTOR"), 1), true);
    check("Doctor 40 -> stay 2 (not assigned)", await canAccessStay(U(40,"DOCTOR"), 2), false);
    check("Doctor 41 inactive assignment stay 1", await canAccessStay(U(41,"DOCTOR"), 1), false);
    check("Doctor 41 active stay 2", await canAccessStay(U(41,"DOCTOR"), 2), true);
    check("unknown role", await canAccessStay(U(99,"VISITOR"), 1), false);
    check("non-numeric stay id", await canAccessStay(U(50,"ADMIN"), "1; DROP"), false);

    console.log("--- cases ---");
    check("ADMIN any case", await canAccessCase(U(50,"ADMIN"), 3), true);
    check("Patient A own case (PATIENT_CAN_VIEW_CASES=false)", await canAccessCase(U(10,"PATIENT"), 1), false);
    check("Paramedic 20 own case 1", await canAccessCase(U(20,"PARAMEDIC"), 1), true);
    check("Paramedic 20 -> case 2 (other's)", await canAccessCase(U(20,"PARAMEDIC"), 2), false);
    check("ER_STAFF case 2 ACTIVE_ER", await canAccessCase(U(30,"ER_STAFF"), 2), true);
    check("ER_STAFF case 1 PRE_ER (normal route)", await canAccessCase(U(30,"ER_STAFF"), 1), false);
    check("ER_STAFF case 1 PRE_ER (er-arrival route)", await canAccessCase(U(30,"ER_STAFF"), 1, ["PRE_ER"]), true);
    check("ER_STAFF case 3 CLOSED even on er-arrival route", await canAccessCase(U(30,"ER_STAFF"), 3, ["PRE_ER"]), false);
    check("Doctor 40 case 1 (assigned stay)", await canAccessCase(U(40,"DOCTOR"), 1), true);
    check("Doctor 40 case 2 (not assigned)", await canAccessCase(U(40,"DOCTOR"), 2), false);

    console.log("--- stay lists ---");
    check("ADMIN list", await listFor(U(50,"ADMIN")), "1,2,3");
    check("Patient A list", await listFor(U(10,"PATIENT")), "1");
    check("Patient B list", await listFor(U(11,"PATIENT")), "2");
    check("Paramedic 20 list", await listFor(U(20,"PARAMEDIC")), "1,3");
    check("ER_STAFF list", await listFor(U(30,"ER_STAFF")), "2");
    check("Doctor 40 list", await listFor(U(40,"DOCTOR")), "1");
    check("Doctor 41 list", await listFor(U(41,"DOCTOR")), "2");
    check("unknown role list", await listFor(U(99,"VISITOR")), "");
  } catch (err) {
    failed++;
    console.error("TEST ERROR:", err.message);
  } finally {
    try {
      await client.query("SET search_path TO public");
      await client.query("DROP SCHEMA IF EXISTS acl_test CASCADE");
    } catch (_) {}
    client.release();
    await pool.end();
    console.log(`\n${failed} FAILED / ${total} CHECKS`);
    process.exit(failed ? 1 : 0);
  }
})();
