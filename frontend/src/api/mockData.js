// Sample data shaped like the real API responses. Nothing here is a real patient.
// Fields marked NEEDS-BACKEND are not returned by the real API today.

export const MOCK_USERS = {
  paramedic1: { user_id: 11, username: "paramedic1", role: "PARAMEDIC" },
  nurse1: { user_id: 12, username: "nurse1", role: "ER_STAFF" },
  doctor1: { user_id: 13, username: "doctor1", role: "DOCTOR" },
  admin1: { user_id: 14, username: "admin1", role: "ADMIN" },
};

const T = (hhmm) => `2147-11-14T${hhmm}:00.000Z`;

// One row per stay. Scores follow the NEWS2 rules (scale 1, alert, room air).
const base = [
  { stay_id: "30094124", subject_id: "10014354", case_code: "ER-2041", case_status: "ACTIVE_ER", gender: "F", chiefcomplaint: "Shortness of breath", acuity: 2, score: 8, risk: "High Risk", rr: 24, spo2: 93, sbp: 105, hr: 118, temp: 38.6, s: [2, 2, 1, 2, 1], ago: 3, time: "19:10" },
  { stay_id: "30112876", subject_id: "10021487", case_code: "ER-2038", case_status: "ACTIVE_ER", gender: "M", chiefcomplaint: "Abdominal pain", acuity: 3, score: 5, risk: "Medium Risk", rr: 18, spo2: 95, sbp: 98, hr: 112, temp: 37.2, s: [0, 1, 2, 2, 0], ago: 11, time: "19:02" },
  { stay_id: "30097315", subject_id: "10030553", case_code: "ER-2036", case_status: "ARRIVED_ER", gender: "F", chiefcomplaint: "Fever and cough", acuity: 3, score: 5, risk: "Medium Risk", rr: 22, spo2: 92, sbp: 118, hr: 104, temp: 37.9, s: [2, 2, 0, 1, 0], ago: 18, time: "18:55" },
  { stay_id: "30120492", subject_id: "10009872", case_code: "ER-2033", case_status: "ACTIVE_ER", gender: "M", chiefcomplaint: "Palpitations", acuity: 3, score: 3, risk: "Low-Medium Risk", rr: 16, spo2: 97, sbp: 126, hr: 133, temp: 36.8, s: [0, 0, 0, 3, 0], ago: 26, time: "18:47" },
  { stay_id: "30133058", subject_id: "10027711", case_code: "ER-2029", case_status: "ACTIVE_ER", gender: "F", chiefcomplaint: "Ankle injury", acuity: 4, score: 0, risk: "Low Risk", rr: 16, spo2: 97, sbp: 126, hr: 72, temp: 36.9, s: [0, 0, 0, 0, 0], ago: 34, time: "18:39" },
  { stay_id: "30141620", subject_id: "10036209", case_code: "ER-2027", case_status: "ARRIVED_ER", gender: "M", chiefcomplaint: "Headache", acuity: 4, score: 0, risk: "Low Risk", rr: 19, spo2: 96, sbp: 134, hr: 88, temp: 37.4, s: [0, 0, 0, 0, 0], ago: 41, time: "18:32" },
];

export function stayRow(b) {
  return {
    stay_id: b.stay_id,
    subject_id: b.subject_id,
    intime: T("17:40"),
    outtime: null,
    gender: b.gender,
    disposition: null,
    chiefcomplaint: b.chiefcomplaint,
    acuity: b.acuity,
    // NEEDS-BACKEND: the real list has none of these three.
    case_code: b.case_code,
    case_status: b.case_status,
    latest_news2: {
      total_news2_score: b.score,
      risk_level: b.risk,
      observation_time: T(b.time),
      minutes_ago: b.ago,
    },
    latest_observation: {
      respiratory_rate: b.rr,
      spo2: b.spo2,
      systolic_bp: b.sbp,
      heart_rate: b.hr,
      temperature_celsius: b.temp,
    },
  };
}

export const STAYS = base.map(stayRow);

export function summaryFor(stayId) {
  const b = base.find((x) => x.stay_id === stayId);
  if (!b) return null;
  const first = b.stay_id === "30094124";
  const [rs, ss, bs, hs, ts] = b.s;
  const alerts = [];
  if (b.risk === "High Risk") {
    alerts.push({
      alert_id: 1, alert_type: "NEWS2", severity: "HIGH", priority: 1, status: "OPEN",
      alert_title: "High NEWS2 score",
      alert_message: `NEWS2 total is ${b.score}, in the high band. Clinician review required.`,
      created_at: T(b.time),
    });
  } else if (b.risk === "Medium Risk") {
    alerts.push({
      alert_id: 2, alert_type: "NEWS2", severity: "MEDIUM", priority: 2, status: "OPEN",
      alert_title: "Medium NEWS2 score",
      alert_message: `NEWS2 total is ${b.score}, in the medium band. Clinician review required.`,
      created_at: T(b.time),
    });
  }
  return {
    stay: stayRow(b),
    patient: { subject_id: b.subject_id, gender: b.gender },
    diagnoses: [],
    medications: first
      ? [{ medication_id: 1, medication_name: "Warfarin", dosage: "5 mg", frequency: "daily" }]
      : [],
    latest_observation: {
      observation_id: 900 + Number(b.stay_id.slice(-2)),
      observation_time: T(b.time),
      respiratory_rate: b.rr, spo2: b.spo2, systolic_bp: b.sbp, heart_rate: b.hr,
      temperature_celsius: b.temp,
      consciousness: "ALERT", oxygen_support: false, spo2_scale: 1,
      assumed_fields: ["consciousness", "oxygen_support", "spo2_scale"], // NEEDS-BACKEND flag
    },
    latest_news2: {
      total_news2_score: b.score,
      risk_level: b.risk,
      respiratory_score: rs, spo2_score: ss, systolic_bp_score: bs,
      heart_rate_score: hs, temperature_score: ts,
      consciousness_score: 0, oxygen_score: 0,
      observation_time: T(b.time),
      is_clinical_decision: false,
    },
    latest_trend: { classification: "NOT_CLASSIFIED" },
    allergies: first
      ? { status: "RECORDED", records: [{ allergy_id: 1, allergen: "Penicillin", reaction: "Rash", severity: "moderate" }] }
      : { status: "NO_DATA_RECORDED", records: [] },
    history: first
      ? { status: "RECORDED", records: [{ history_id: 1, condition: "Atrial fibrillation" }] }
      : { status: "NO_DATA_RECORDED", records: [] },
    decision_support: {
      computed_by_current_engine: true,
      result: { overall_risk: b.risk.startsWith("High") ? "HIGH" : b.risk.startsWith("Medium") ? "MEDIUM" : "LOW", decision_priority: b.risk.startsWith("High") ? "HIGH" : "ROUTINE", decision_summary: "Sample decision summary. Clinician review required.", engine_version: "phase6-v1" },
    },
    drug_safety: {
      computed_by_current_engine: true,
      provenance_status: "VERIFIED_CURRENT_RUN",
      findings: first
        ? [{ safety_result_id: 1, component_a: "Warfarin", component_b: "Ibuprofen", interaction_level: "Major", result_status: "SCREENED", source: "DDInter" }]
        : [],
    },
    clinical_alerts: { computed_by_current_engine: true, provenance_status: "VERIFIED_CURRENT_RUN", alerts },
  };
}

// Observation history for the chart (the first stay has six readings).
export function observationsFor(stayId) {
  const b = base.find((x) => x.stay_id === stayId);
  if (!b) return null;
  const times = ["17:50", "18:05", "18:23", "18:40", "18:55", b.time];
  const hrs = [b.hr - 22, b.hr - 16, b.hr - 10, b.hr - 6, b.hr - 2, b.hr];
  const sp = [b.spo2 + 4, b.spo2 + 3, b.spo2 + 2, b.spo2 + 1, b.spo2 + 1, b.spo2].map((v) => Math.min(100, v));
  return {
    stay_id: stayId,
    count: 6,
    observations: times.map((t, i) => ({
      observation_id: i + 1,
      observation_time: T(t),
      heart_rate: hrs[i],
      spo2: sp[i],
      respiratory_rate: b.rr,
      systolic_bp: b.sbp,
      temperature_celsius: b.temp,
    })),
  };
}

// Paramedic cases (NEEDS-BACKEND: the real API has no case list).
export const CASES = [
  { case_id: 2044, temporary_case_code: "ER-2044", status: "PRE_ER", chief_note: "Chest pain, 62 y", steps: { assessment: true, vitals: true, transport: false, handover: false }, news2: { total: 6, risk_level: "Medium Risk", rr: 22, spo2: 94, sbp: 100, hr: 108, temp: 37.4 } },
  { case_id: 2043, temporary_case_code: "ER-2043", status: "ARRIVED_ER", chief_note: "Fall at home, 78 y", steps: { assessment: true, vitals: true, transport: true, handover: true }, news2: { total: 2, risk_level: "Low Risk", rr: 18, spo2: 96, sbp: 128, hr: 84, temp: 36.9 } },
  { case_id: 2041, temporary_case_code: "ER-2041", status: "ACTIVE_ER", chief_note: "Shortness of breath, 67 y", steps: { assessment: true, vitals: true, transport: true, handover: true }, news2: { total: 8, risk_level: "High Risk", rr: 24, spo2: 93, sbp: 105, hr: 118, temp: 38.6 } },
];
