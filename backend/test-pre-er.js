const path = require("path");
const { randomUUID } = require("crypto");
const dotenv = require("dotenv");
const envFile = path.resolve(process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env"));
const envLoad = dotenv.config({ path: envFile, override: true });
const pool = require("./db");
const { getNormalizedMedications } = require("./services/medicationNormalizationService");
const { findDrugInteractions } = require("./services/ddinterService");

const BASE_URL = process.env.PRE_ER_TEST_BASE_URL || "http://localhost:5000";

function assertEnvironmentLoaded() {
  if (envLoad.error) {
    throw new Error(`Could not load test environment file ${envFile}: ${envLoad.error.message}`);
  }

  const required = ["DB_HOST", "DB_NAME", "DB_USER", "JWT_SECRET"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Test environment is missing required settings: ${missing.join(", ")}`);
  }
  if (process.env.DB_PORT && !/^\d+$/.test(process.env.DB_PORT)) {
    throw new Error("Test environment DB_PORT must be numeric when specified.");
  }

  const expectedDatabase = process.env.PRE_ER_TEST_DATABASE_NAME;
  if (!expectedDatabase || !/(?:^|[_-])test$/i.test(expectedDatabase)) {
    throw new Error("Refusing to run: set PRE_ER_TEST_DATABASE_NAME to the dedicated isolated database name ending in _test or -test.");
  }
  if (process.env.DB_NAME !== expectedDatabase) {
    throw new Error(`Refusing to run against DB_NAME=${process.env.DB_NAME}; configured test database is ${expectedDatabase}.`);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { non_json_response: text.slice(0, 2000) };
  }
}

function assertStatus(response, body, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label}: expected HTTP ${expectedStatus}, received HTTP ${response.status}; ` +
      `content-type=${response.headers.get("content-type") || "(missing)"}; ` +
      `body=${JSON.stringify(body)}`
    );
  }
}

async function findInteractionFixture() {
  const reusable = await pool.query(
    `SELECT c.case_id, c.stay_id, c.patient_id
     FROM emergency_cases c
     WHERE c.source = 'PRE_ER_INTEGRATION_TEST'
       AND c.temporary_case_code LIKE 'PREERTEST-%'
       AND c.stay_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM medications m WHERE m.stay_id = c.stay_id)
       AND EXISTS (SELECT 1 FROM news2_results_real n WHERE n.stay_id = c.stay_id)
     ORDER BY c.case_id DESC
     LIMIT 1`
  );

  const reusableUnlinked = await pool.query(
    `SELECT c.case_id, e.stay_id, p.patient_id
     FROM emergency_cases c
     JOIN patients p ON p.patient_id = c.patient_id
     JOIN ed_stays e ON e.subject_id = p.subject_id
     WHERE c.source = 'PRE_ER_INTEGRATION_TEST'
       AND c.temporary_case_code LIKE 'PREERTEST-%'
       AND c.stay_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM emergency_cases linked WHERE linked.stay_id = e.stay_id)
       AND EXISTS (SELECT 1 FROM medications m WHERE m.stay_id = e.stay_id)
       AND EXISTS (SELECT 1 FROM news2_results_real n WHERE n.stay_id = e.stay_id)
     ORDER BY c.case_id DESC, e.stay_id
     LIMIT 1`
  );

  const candidates = await pool.query(
    `SELECT NULL::integer AS case_id, e.stay_id, p.patient_id
     FROM ed_stays e
     JOIN patients p ON p.subject_id = e.subject_id
     WHERE NOT EXISTS (
       SELECT 1 FROM emergency_cases c WHERE c.stay_id = e.stay_id
     )
       AND EXISTS (SELECT 1 FROM medications m WHERE m.stay_id = e.stay_id)
       AND EXISTS (SELECT 1 FROM news2_results_real n WHERE n.stay_id = e.stay_id)
     ORDER BY e.stay_id
     LIMIT 100`
  );

    for (const candidate of [...reusable.rows, ...reusableUnlinked.rows, ...candidates.rows]) {
    const stayId = String(candidate.stay_id);
    const normalized = await getNormalizedMedications(stayId);
    if (normalized.canonical_identities.length < 2) continue;

    const interactions = await findDrugInteractions(normalized.canonical_identities);
    if (interactions.interactions_found.length > 0) {
      return {
        case_id: candidate.case_id,
        stay_id: stayId,
        patient_id: candidate.patient_id,
        normalized,
        interactions: interactions.interactions_found,
      };
    }
  }

  throw new Error("No unlinked fixture stay with NEWS2, mapped ER medications, and a DDInter finding exists in the isolated test database.");
}

async function persistedStaySnapshot(stayId) {
  const [decisions, drugSafety, alerts, medicationIds] = await Promise.all([
    pool.query(
      `SELECT news2_score, news2_category, trend_classification, drug_alert_count,
              major_interaction_count, moderate_interaction_count, overall_risk,
              decision_priority, decision_summary, evidence_source
       FROM decision_support_results
       WHERE stay_id = $1 AND evidence_source LIKE '%Phase 6 engine%'
       ORDER BY decision_id`,
      [stayId]
    ),
    pool.query(
      `SELECT medication_id_a, medication_id_b, LOWER(component_a) AS component_a,
              LOWER(component_b) AS component_b, interaction_id, interaction_level,
              result_status, source
       FROM drug_safety_results
       WHERE stay_id = $1
       ORDER BY medication_id_a, medication_id_b, interaction_id, component_a, component_b`,
      [stayId]
    ),
    pool.query(
      `SELECT alert_type, alert_source, medication_id_a, medication_id_b, severity,
              priority, alert_title, alert_message, status
       FROM clinical_alerts
       WHERE stay_id = $1
       ORDER BY alert_type, alert_source, medication_id_a NULLS FIRST,
                medication_id_b NULLS FIRST, alert_title, alert_message`,
      [stayId]
    ),
    pool.query(
      `SELECT medication_id, medication_name, normalized_name
       FROM medications
       WHERE stay_id = $1
       ORDER BY medication_id`,
      [stayId]
    ),
  ]);

  return {
    decisions: decisions.rows,
    drug_safety: drugSafety.rows,
    alerts: alerts.rows,
    medication_ids: medicationIds.rows,
  };
}

async function registerAndLogin(role = "PARAMEDIC") {
  const username = `preer_integration_${role.toLowerCase()}`;
  const password = "TestPass123!";

  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role }),
  });
  const registerData = await readJson(registerRes);
  if (registerRes.status !== 409) {
    assertStatus(registerRes, registerData, 201, `Register ${role} test user`);
  }
  if (registerRes.status === 201 && registerData.user?.role !== role) {
    throw new Error(`Registration requested role ${role}, but database returned ${registerData.user?.role || "no role"}.`);
  }

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const loginData = await readJson(loginRes);
  assertStatus(loginRes, loginData, 200, `Login ${role} test user`);
  if (loginData.user?.role !== role || !loginData.token) {
    throw new Error(`Login did not return the intended ${role} role and token: ${JSON.stringify(loginData)}`);
  }

  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  const meData = await readJson(meRes);
  assertStatus(meRes, meData, 200, `Verify /api/auth/me for ${role} user`);
  if (meData.user?.role !== role || String(meData.user?.user_id) !== String(loginData.user.user_id)) {
    throw new Error(`Authenticated token role/user mismatch for ${role}: ${JSON.stringify(meData)}`);
  }

  const storedUser = await pool.query(
    "SELECT user_id, role FROM users WHERE user_id = $1 AND username = $2",
    [loginData.user.user_id, username]
  );
  if (storedUser.rows.length !== 1 || storedUser.rows[0].role !== role) {
    throw new Error(`Test user role in the configured database does not match ${role}.`);
  }

  return { token: loginData.token, user: loginData.user };
}

async function run() {
  try {
    assertEnvironmentLoaded();
    const database = await pool.query("SELECT current_database() AS name");
    if (database.rows[0]?.name !== process.env.PRE_ER_TEST_DATABASE_NAME) {
      throw new Error(
        `Refusing to run: PostgreSQL connected to ${database.rows[0]?.name || "unknown"}, not PRE_ER_TEST_DATABASE_NAME.`
      );
    }
    console.log(`Environment verified; connected to isolated database ${database.rows[0].name}.`);

    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await readJson(healthRes);
    assertStatus(healthRes, healthData, 200, "Check API health");
    if (healthData.database_name !== process.env.PRE_ER_TEST_DATABASE_NAME) {
      throw new Error(
        `Refusing to run: API is connected to ${healthData.database_name || "unknown"}, not the isolated test database.`
      );
    }

    const fixture = await findInteractionFixture();
    console.log(`Selected isolated ER fixture stay ${fixture.stay_id} with ${fixture.interactions.length} DDInter finding(s).`);

    console.log("=== STEP 1: Authenticating test user (Paramedic) ===");
    const paramedic = await registerAndLogin("PARAMEDIC");
    const token = paramedic.token;
    console.log("Authentication successful. Token acquired.\n");

    let caseId = fixture.case_id;
    if (caseId) {
      console.log(`Reusing test-owned case ${caseId} linked to stay ${fixture.stay_id}.`);
    } else {
      console.log("=== STEP 2: Creating a new emergency case (POST /api/emergency-cases) ===");
      const caseRes = await fetch(`${BASE_URL}/api/emergency-cases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          temporary_case_code: `PREERTEST-${randomUUID().replace(/-/g, "").slice(0, 20)}`,
          patient_id: fixture.patient_id,
          source: "PRE_ER_INTEGRATION_TEST"
        }),
      });

      const caseData = await readJson(caseRes);
      assertStatus(caseRes, caseData, 201, "Create Pre-ER case");
      caseId = caseData.case.case_id;
      if (String(caseData.case.patient_id) !== String(fixture.patient_id)) {
        throw new Error(`New test case patient_id did not match ER fixture: ${JSON.stringify(caseData.case)}`);
      }
      console.log(`Success! Created test-owned emergency case with ID: ${caseId}\n`);
    }

    const existingSetup = fixture.case_id
      ? await (async () => {
          const response = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/workflow`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const body = await readJson(response);
          assertStatus(response, body, 200, "Read test-owned case before setup");
          return body;
        })()
      : null;

    let assessmentData = existingSetup?.latest_assessment
      ? { assessment: existingSetup.latest_assessment }
      : null;
    if (!assessmentData) {
      console.log("=== STEP 3: Recording initial patient assessment ===");
      const assessmentRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/assessments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          chief_complaint: "Integration-test assessment",
          consciousness_status: "ALERT",
          breathing_status: "Labored",
          circulation_status: "Stable",
          pain_score: 8,
          initial_severity: "HIGH",
          heart_rate: 115,
          respiratory_rate: 24,
          systolic_bp: 140,
          spo2: 92,
          temperature: 37.2,
          oxygen_support: true,
          allergy_status: "UNKNOWN",
          current_medications: [
            { medication_name: "TEST-REPORTED-ASPIRIN", dose: "81mg" },
            { medication_name: "TEST-REPORTED-METOPROLOL", dose: "50mg" }
          ],
          notes: "Test-only reported medications; must not enter ER medication records."
        }),
      });
      assessmentData = await readJson(assessmentRes);
      assertStatus(assessmentRes, assessmentData, 201, "Record Pre-ER assessment");
    }

    let transportData = existingSetup?.transport
      ? { transport: existingSetup.transport }
      : null;
    if (!transportData) {
      console.log("=== STEP 4: Recording ambulance transport logistics ===");
      const transportRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/transport`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          ambulance_id: "TEST-AMBULANCE",
          transport_type: "TEST",
          pickup_location: "Test location",
          destination_hospital: "Test ER",
          transport_status: "IN_TRANSIT",
          notes: "Test-only transport record."
        }),
      });
      transportData = await readJson(transportRes);
      assertStatus(transportRes, transportData, 201, "Record ambulance transport");
    }

    console.log("=== STEP 5: Checking Pre-ER state before ER arrival ===");
    const workflowRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/workflow`, {
      method: "GET",
      headers: { 
        "Authorization": `Bearer ${token}`
      },
    });

    const workflowData = await readJson(workflowRes);
    assertStatus(workflowRes, workflowData, 200, "Read Pre-ER workflow");
    if (!workflowRes.ok) throw new Error(`Failed to fetch workflow summary: ${JSON.stringify(workflowData)}`);
    if (!workflowData.case_id || !workflowData.case || !workflowData.clinical_risk || !workflowData.handover_summary) {
      throw new Error(`Workflow summary missing required fields: ${JSON.stringify(workflowData)}`);
    }
    const expectedLinkStatus = fixture.case_id ? "COMPLETED" : "PENDING";
    const expectedSafetyStatus = fixture.case_id ? "COMPLETED" : "PENDING";
    if (
      workflowData.er_linkage.status !== expectedLinkStatus ||
      workflowData.medication_safety.status !== expectedSafetyStatus ||
      String(workflowData.case.patient_id) !== String(fixture.patient_id)
    ) throw new Error(`Unexpected workflow state for ${fixture.case_id ? "reused" : "new"} fixture: ${JSON.stringify(workflowData)}`);
    if (
      workflowData.case.patient_id !== fixture.patient_id ||
      workflowData.latest_assessment?.assessment_id !== assessmentData.assessment.assessment_id ||
      workflowData.transport?.transport_id !== transportData.transport.transport_id ||
      workflowData.clinical_risk.status !== "complete" ||
      workflowData.medication_reconciliation.status !== "PENDING"
    ) {
      throw new Error(`Reported medications must remain pending explicit reconciliation: ${JSON.stringify(workflowData.medication_reconciliation)}`);
    }
    console.log("Pre-ER snapshot reports assessment, risk, transport, and pending ER linkage/reconciliation.");

    console.log("=== STEP 6: Rejecting invalid ER stay identifiers ===");
    const unauthenticatedArrival = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/er-arrival`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stay_id: fixture.stay_id }),
    });
    const unauthenticatedBody = await readJson(unauthenticatedArrival);
    assertStatus(unauthenticatedArrival, unauthenticatedBody, 401, "Unauthenticated ER arrival");

    const patientUser = await registerAndLogin("PATIENT");
    const unauthorizedArrival = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/er-arrival`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${patientUser.token}`
      },
      body: JSON.stringify({ stay_id: fixture.stay_id }),
    });
    const unauthorizedBody = await readJson(unauthorizedArrival);
    assertStatus(unauthorizedArrival, unauthorizedBody, 403, "PATIENT role ER arrival");

    for (const invalidStayId of ["abc", "9223372036854775808"]) {
      const invalidRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/er-arrival`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ stay_id: invalidStayId }),
      });
      const invalidBody = await readJson(invalidRes);
      assertStatus(invalidRes, invalidBody, 400, `Reject invalid stay_id ${invalidStayId}`);
    }

    const otherPatient = await pool.query(
      "SELECT patient_id FROM patients WHERE patient_id <> $1 ORDER BY patient_id LIMIT 1",
      [fixture.patient_id]
    );
    if (otherPatient.rows.length === 0) {
      throw new Error("Isolated test database needs a second patient to verify patient/stay mismatch rejection.");
    }
    const mismatchStayResult = await pool.query(
  `SELECT e.stay_id
   FROM ed_stays e
   JOIN patients p ON p.subject_id = e.subject_id
   WHERE p.patient_id = $1
     AND NOT EXISTS (
       SELECT 1
       FROM emergency_cases c
       WHERE c.stay_id = e.stay_id
     )
   ORDER BY e.stay_id
   LIMIT 1`,
  [fixture.patient_id]
);

if (mismatchStayResult.rows.length === 0) {
  throw new Error(
    `No unlinked ER stay found for fixture patient ${fixture.patient_id} to test patient/stay mismatch.`
  );
}

const mismatchStayId = String(mismatchStayResult.rows[0].stay_id);
console.log(
  `Using unlinked stay ${mismatchStayId} for patient/stay mismatch validation.`
);

    const existingMismatchCase = await pool.query(
      `SELECT case_id, patient_id, stay_id
       FROM emergency_cases
       WHERE source = 'PRE_ER_INTEGRATION_TEST'
         AND temporary_case_code LIKE 'PREERMIS-%'
       ORDER BY case_id DESC
       LIMIT 1`
    );
    let mismatchCaseData;
    if (existingMismatchCase.rows.length > 0) {
      mismatchCaseData = { case: existingMismatchCase.rows[0] };
    } else {
      const mismatchCaseRes = await fetch(`${BASE_URL}/api/emergency-cases`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          temporary_case_code: `PREERMIS-${randomUUID().replace(/-/g, "").slice(0, 21)}`,
          patient_id: otherPatient.rows[0].patient_id,
          source: "PRE_ER_INTEGRATION_TEST"
        }),
      });
      mismatchCaseData = await readJson(mismatchCaseRes);
      assertStatus(mismatchCaseRes, mismatchCaseData, 201, "Create mismatched-patient Pre-ER case");
    }
    if (
      String(mismatchCaseData.case.patient_id) === String(fixture.patient_id) ||
      mismatchCaseData.case.stay_id !== null
    ) {
      throw new Error(`Reusable mismatch case is not a valid unlinked different-patient case: ${JSON.stringify(mismatchCaseData.case)}`);
    }
    const missingStayRes = await fetch(`${BASE_URL}/api/emergency-cases/${mismatchCaseData.case.case_id}/er-arrival`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        stay_id: String((BigInt((await pool.query("SELECT COALESCE(MAX(stay_id), 0) AS max_stay_id FROM ed_stays")).rows[0].max_stay_id) + 1n)),
      }),
    });
    const missingStayBody = await readJson(missingStayRes);
    assertStatus(missingStayRes, missingStayBody, 404, "Reject nonexistent ER stay");

    const mismatchArrivalRes = await fetch(`${BASE_URL}/api/emergency-cases/${mismatchCaseData.case.case_id}/er-arrival`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ stay_id: mismatchStayId }),
    });
    const mismatchArrivalData = await readJson(mismatchArrivalRes);
    assertStatus(mismatchArrivalRes, mismatchArrivalData, 409, "Reject case patient/ER stay patient mismatch");
    if (mismatchArrivalData.error !== "Emergency case patient does not match the ER stay patient") {
      throw new Error(`Patient/stay mismatch returned an unexpected error: ${JSON.stringify(mismatchArrivalData)}`);
    }
    const mismatchLink = await pool.query(
      "SELECT stay_id FROM emergency_cases WHERE case_id = $1",
      [mismatchCaseData.case.case_id]
    );
    if (mismatchLink.rows[0]?.stay_id !== null) {
      throw new Error("Patient/stay mismatch rejection unexpectedly changed the case linkage.");
    }

    console.log("=== STEP 7: Linking an existing ER stay and processing available ER data ===");
    const stayId = fixture.stay_id;
    const beforeProcessing = await persistedStaySnapshot(stayId);
    const arrivalRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/er-arrival`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ stay_id: stayId }),
    });
    const arrivalData = await readJson(arrivalRes);
    assertStatus(arrivalRes, arrivalData, 200, "Link existing ER stay and run ER processing");
    if (arrivalData.processing?.status !== "COMPLETED") {
      throw new Error(`Expected ER processing to complete: ${JSON.stringify(arrivalData)}`);
    }
    if (
      String(arrivalData.case.case_id) !== String(caseId) ||
      String(arrivalData.case.stay_id) !== stayId ||
      String(arrivalData.case.patient_id) !== String(fixture.patient_id) ||
      arrivalData.case.case_status !== "ARRIVED_ER"
    ) {
      throw new Error(`Case/stay identifiers were not preserved: ${JSON.stringify(arrivalData.case)}`);
    }

    const persistedAfterArrival = await persistedStaySnapshot(stayId);
    const decision = arrivalData.processing.decision_support;
    const safetyCounts = arrivalData.processing.drug_safety;
    console.log("Drug safety counts:", safetyCounts);
     
console.log("Drug safety counts:", safetyCounts);

console.log(
  "Full drug safety response:",
  JSON.stringify(arrivalData.processing?.drug_safety ?? null, null, 2)
);

console.log(
  "Processing keys:",
  Object.keys(arrivalData.processing || {})
);

console.log(
  "Persisted row count:",
  persistedAfterArrival.drug_safety.length
);

console.log(
  "First 5 persisted rows:",
  persistedAfterArrival.drug_safety.slice(0, 5)
);

    const returnedAlerts = arrivalData.processing.alerts?.items;
    if (
      !decision?.decision_id ||
      String(decision.stay_id) !== stayId ||
      !decision.evidence_source?.includes("Phase 6 engine") ||
      persistedAfterArrival.decisions.length !== 1 ||
      persistedAfterArrival.decisions[0].decision_summary !== decision.decision_summary
    ) {
      throw new Error(`Decision-support service output was not persisted as expected: ${JSON.stringify({ decision, rows: persistedAfterArrival.decisions })}`);
    }
   
console.log("Drug safety counts:", safetyCounts);
console.log(
  "Full drug safety response:",
  JSON.stringify(arrivalData.processing?.drug_safety ?? null, null, 2)
);

console.log(
  "Processing keys:",
  Object.keys(arrivalData.processing || {})
);

console.log(
  "Persisted row count:",
  persistedAfterArrival.drug_safety.length
);
console.log("Persisted row count:", persistedAfterArrival.drug_safety.length);
console.log("First 5 persisted rows:", persistedAfterArrival.drug_safety.slice(0, 5));

console.log("Processing keys:", Object.keys(arrivalData.processing || {}));
console.log(
  "Full drug safety response:",
  JSON.stringify(arrivalData.processing?.drug_safety, null, 2)
);

    
if (
  safetyCounts?.inserted_count !== persistedAfterArrival.drug_safety.length ||
  persistedAfterArrival.drug_safety.length === 0 ||
  persistedAfterArrival.drug_safety.some(
    (row) =>
      row.source !== "DDInter_2.0" ||
      row.result_status !== "INTERACTION_FOUND"
  )
) {
  console.error("DEBUG safetyCounts:", safetyCounts);

  console.error(
    "DEBUG persisted row count:",
    persistedAfterArrival.drug_safety.length
  );

  console.error(
    "DEBUG invalid rows:",
    persistedAfterArrival.drug_safety.filter(
      (row) =>
        row.source !== "DDInter_2.0" ||
        row.result_status !== "INTERACTION_FOUND"
    ).slice(0, 10)
  );

  throw new Error(
    "Drug-safety outputs do not match persisted DDInter rows; see DEBUG lines above."
  );
}


    const expectedInteractionIds = new Set(fixture.interactions.map((finding) => String(finding.interaction_id)));
    if (persistedAfterArrival.drug_safety.some((row) => !expectedInteractionIds.has(String(row.interaction_id)))) {
      throw new Error("Persisted drug-safety rows include interaction IDs not returned by the DDInter service for the fixture.");
    }
    const expectedSafetyKeys = [];
    for (const finding of fixture.interactions) {
      const drugA = String(finding.drug_a).toLowerCase();
      const drugB = String(finding.drug_b).toLowerCase();
      const mappedA = fixture.normalized.mapped_medications.filter(
        (medication) => String(medication.canonical_name).toLowerCase() === drugA
      );
      const mappedB = fixture.normalized.mapped_medications.filter(
        (medication) => String(medication.canonical_name).toLowerCase() === drugB
      );
      for (const medicationA of mappedA) {
        for (const medicationB of mappedB) {
          expectedSafetyKeys.push(
            `${medicationA.medication_id}:${medicationB.medication_id}:${drugA}:${drugB}:${finding.interaction_id}`
          );
        }
      }
    }
    const actualSafetyKeys = persistedAfterArrival.drug_safety.map((row) =>
      `${row.medication_id_a}:${row.medication_id_b}:${row.component_a}:${row.component_b}:${row.interaction_id}`
    );
      
if (
  expectedSafetyKeys.length !== actualSafetyKeys.length ||
  expectedSafetyKeys.sort().join("|") !== actualSafetyKeys.sort().join("|")
) {
  const expectedSet = new Set(expectedSafetyKeys);
  const actualSet = new Set(actualSafetyKeys);

  console.error("Expected safety-key count:", expectedSafetyKeys.length);
  console.error("Actual safety-key count:", actualSafetyKeys.length);
  console.error(
    "Missing from persisted results:",
    [...expectedSet].filter((key) => !actualSet.has(key)).slice(0, 15)
  );
  console.error(
    "Unexpected persisted results:",
    [...actualSet].filter((key) => !expectedSet.has(key)).slice(0, 15)
  );

  throw new Error("Persisted drug-safety pairs do not match expected DDInter pairs.");
}

    if (JSON.stringify(beforeProcessing.medication_ids) !== JSON.stringify(persistedAfterArrival.medication_ids)) {
      throw new Error("ER medication records changed while processing; Pre-ER reports must not be copied into authoritative medication rows.");
    }
    if (persistedAfterArrival.medication_ids.some((medication) =>
      /TEST-REPORTED-(ASPIRIN|METOPROLOL)/i.test(`${medication.medication_name} ${medication.normalized_name}`)
    )) {
      throw new Error("Pre-ER reported medication names appeared in authoritative ER medication records.");
    }
    if (
      !Array.isArray(returnedAlerts) ||
      returnedAlerts.length !== arrivalData.processing.alerts.inserted_count ||
      returnedAlerts.length !== persistedAfterArrival.alerts.length ||
      returnedAlerts.some((alert) => alert.status !== "ACTIVE" || !alert.alert_id)
    ) {
      throw new Error(`Alert service output does not match persisted active alerts: ${JSON.stringify(arrivalData.processing.alerts)}`);
    }
    const alertIds = returnedAlerts.map((alert) => alert.alert_id);
    const savedAlertIds = await pool.query(
      "SELECT alert_id FROM clinical_alerts WHERE stay_id = $1 AND alert_id = ANY($2::int[]) ORDER BY alert_id",
      [stayId, alertIds]
    );
    if (savedAlertIds.rows.length !== alertIds.length) {
      throw new Error("One or more returned alert identifiers are not persisted for the linked stay.");
    }
    const drugAlertSafetyIds = new Set(
      persistedAfterArrival.drug_safety.map((row) => `${row.medication_id_a}:${row.medication_id_b}:${row.interaction_id}`)
    );
    const persistedAlertReferences = await pool.query(
      `SELECT medication_id_a, medication_id_b, safety_result_id
       FROM clinical_alerts
       WHERE stay_id = $1 AND alert_type = 'DRUG_INTERACTION'`,
      [stayId]
    );
    if (persistedAlertReferences.rows.length !== persistedAfterArrival.drug_safety.length) {
      throw new Error("Persisted drug-interaction alert count does not match persisted drug-safety result count.");
    }
    const safetyResultRows = await pool.query(
      "SELECT safety_result_id, medication_id_a, medication_id_b, interaction_id FROM drug_safety_results WHERE stay_id = $1",
      [stayId]
    );
    const safetyIdsByKey = new Map(safetyResultRows.rows.map((row) => [
      `${row.medication_id_a}:${row.medication_id_b}:${row.interaction_id}`,
      row.safety_result_id,
    ]));
    for (const alert of persistedAlertReferences.rows) {
      const key = `${alert.medication_id_a}:${alert.medication_id_b}:${safetyResultRows.rows.find((row) => row.safety_result_id === alert.safety_result_id)?.interaction_id}`;
      if (!drugAlertSafetyIds.has(key) || safetyIdsByKey.get(key) !== alert.safety_result_id) {
        throw new Error("A persisted drug alert does not reference its corresponding persisted safety finding.");
      }
    }

    const decisionById = await pool.query(
      `SELECT decision_id, patient_id, stay_id, evidence_source
       FROM decision_support_results
       WHERE decision_id = $1 AND stay_id = $2`,
      [decision.decision_id, stayId]
    );
    if (
      decisionById.rows.length !== 1 ||
      String(decisionById.rows[0].patient_id) !== String(fixture.patient_id) ||
      !decisionById.rows[0].evidence_source.includes("Phase 6 engine")
    ) {
      throw new Error("Returned decision-support identifier does not point to the persisted current-engine row.");
    }

    const otherStay = await pool.query(
      "SELECT stay_id FROM ed_stays WHERE stay_id <> $1 ORDER BY stay_id LIMIT 1",
      [stayId]
    );
    if (otherStay.rows.length === 0) {
      throw new Error("Isolated test database needs a second ER stay to verify relink rejection.");
    }
    const relinkRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/er-arrival`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ stay_id: String(otherStay.rows[0].stay_id) }),
    });
    const relinkData = await readJson(relinkRes);
    assertStatus(relinkRes, relinkData, 409, "Reject different stay for an already-linked case");
    if (relinkData.error !== "Emergency case is already linked to a different ER stay") {
      throw new Error(`Different-stay relink returned an unexpected error: ${JSON.stringify(relinkData)}`);
    }

    const alreadyOwnedStayRes = await fetch(`${BASE_URL}/api/emergency-cases/${mismatchCaseData.case.case_id}/er-arrival`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ stay_id: stayId }),
    });
    const alreadyOwnedStayData = await readJson(alreadyOwnedStayRes);
    assertStatus(alreadyOwnedStayRes, alreadyOwnedStayData, 409, "Reject an ER stay already owned by another case");
    if (alreadyOwnedStayData.error !== "ER stay is already linked to another emergency case") {
      throw new Error(`Already-owned stay returned an unexpected error: ${JSON.stringify(alreadyOwnedStayData)}`);
    }

    const afterRejectedRelink = await persistedStaySnapshot(stayId);
    if (JSON.stringify(afterRejectedRelink) !== JSON.stringify(persistedAfterArrival)) {
      throw new Error("Rejected relinking modified persisted clinical results.");
    }

    console.log("=== STEP 8: Verifying integrated workflow and summary after processing ===");
    const linkedWorkflowRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/workflow`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const linkedWorkflow = await readJson(linkedWorkflowRes);
    assertStatus(linkedWorkflowRes, linkedWorkflow, 200, "Read linked workflow");
    if (String(linkedWorkflow.case.case_id) !== String(caseId) || String(linkedWorkflow.linked_stay_id) !== stayId) {
      throw new Error(`Linked workflow lost case/stay identity: ${JSON.stringify(linkedWorkflow)}`);
    }
    if (
      linkedWorkflow.clinical_processing.status !== "COMPLETED" ||
      linkedWorkflow.decision_support.status !== "COMPLETED" ||
      linkedWorkflow.alerts.status !== "COMPLETED" ||
      linkedWorkflow.medication_reconciliation.status !== "PENDING" ||
      linkedWorkflow.medication_safety.authoritative_medication_count !== persistedAfterArrival.medication_ids.length ||
      linkedWorkflow.medication_safety.findings.length !== persistedAfterArrival.drug_safety.length ||
      linkedWorkflow.alerts.count !== persistedAfterArrival.alerts.length ||
      linkedWorkflow.decision_support.result.decision_id !== decision.decision_id
    ) {
      throw new Error(`Unexpected linked workflow state: ${JSON.stringify(linkedWorkflow)}`);
    }
    if (linkedWorkflow.handover_summary.handover_status === "COMPLETED") {
      throw new Error("ER arrival must not be reported as completed ambulance handover");
    }

    console.log("=== STEP 9: Fetching ER Handover Summary ===");
    const summaryRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/handover-summary`, {
      method: "GET",
      headers: { 
        "Authorization": `Bearer ${token}`
      },
    });

    const summaryData = await readJson(summaryRes);
    assertStatus(summaryRes, summaryData, 200, "Read handover summary");
    if (summaryData.arrival_status !== "COMPLETED" || summaryData.completed_handover) {
      throw new Error(`Arrival and handover states were conflated: ${JSON.stringify(summaryData)}`);
    }
    if (
      summaryData.handover_status !== "PENDING" ||
      summaryData.decision_support.result.decision_id !== decision.decision_id ||
      summaryData.alerts.count !== persistedAfterArrival.alerts.length ||
      summaryData.medication_reconciliation.status !== "PENDING"
    ) {
      throw new Error(`Handover summary does not reflect actual processing and reconciliation states: ${JSON.stringify(summaryData)}`);
    }

    const integratedRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/integrated-summary`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const integratedData = await readJson(integratedRes);
    assertStatus(integratedRes, integratedData, 200, "Read integrated clinical summary");
    const summary = integratedData.integrated_summary;
    if (
      integratedData.clinical_processing.status !== "COMPLETED" ||
      String(summary?.stay?.stay_id) !== stayId ||
      String(summary?.patient?.patient_id) !== String(fixture.patient_id) ||
      summary?.decision_support?.computed_by_current_engine !== true ||
      summary?.decision_support?.result?.decision_id !== decision.decision_id ||
      String(summary?.latest_news2?.total_news2_score) !== String(decision.news2_score) ||
      summary?.latest_news2?.risk_level !== decision.news2_category ||
      summary?.latest_trend?.trend_classification !== decision.trend_classification ||
      summary?.drug_safety?.computed_by_current_engine !== true ||
      summary?.drug_safety?.findings?.length !== persistedAfterArrival.drug_safety.length ||
      summary?.clinical_alerts?.computed_by_current_engine !== true ||
      summary?.clinical_alerts?.alerts?.length !== persistedAfterArrival.alerts.length ||
      summary?.medications?.length !== persistedAfterArrival.medication_ids.length
    ) {
      throw new Error(`Integrated summary did not report persisted processing: ${JSON.stringify(integratedData)}`);
    }

    console.log("=== STEP 10: Repeating ER arrival to verify idempotency ===");
    const erStaff = await registerAndLogin("ER_STAFF");
    const retryRes = await fetch(`${BASE_URL}/api/emergency-cases/${caseId}/er-arrival`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${erStaff.token}`
      },
      body: JSON.stringify({ stay_id: stayId }),
    });
    const retryData = await readJson(retryRes);
    assertStatus(retryRes, retryData, 200, "Repeat ER arrival as ER_STAFF");
    if (retryData.processing?.status !== "COMPLETED") {
      throw new Error(`Idempotent ER-arrival retry failed: ${JSON.stringify(retryData)}`);
    }
    const afterRetry = await persistedStaySnapshot(stayId);
    if (JSON.stringify(persistedAfterArrival) !== JSON.stringify(afterRetry)) {
      throw new Error(`Repeated processing changed stable persisted records: ${JSON.stringify({ before: persistedAfterArrival, after: afterRetry })}`);
    }
    
    console.log("=== HANDOVER SUMMARY FETCHED SUCCESSFULLY ===");
    console.log(JSON.stringify(summaryData, null, 2));

    console.log("\nPASS: Pre-ER integration contract checks completed successfully.");
    console.log("Verified: test DB/env/API alignment; registration, login, token, and stored roles; PARAMEDIC/ER_STAFF authorization and PATIENT denial; stay ID validation; patient/stay match; one-case-per-stay relink protection; DDInter mapping and persisted medication-level safety rows; decision-support persistence; alert persistence and safety-result references; integrated summary contents; no promotion of reported medications; stable persisted natural-key snapshot after retry.");
  } catch (err) {
    console.error("Test script error:", err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();