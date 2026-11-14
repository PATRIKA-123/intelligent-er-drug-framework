// Same function names as real.js, backed by sample data. Used when VITE_USE_MOCK=true.
import { ApiError } from "./client.js";
import { MOCK_USERS, STAYS, summaryFor, observationsFor } from "./mockData.js";

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

let prescriptions = []; // in memory only
let nextPrescriptionId = 1;
const mockInvites = {};
const mockFollowUps = {};
const mockAssigned = {};
const mockDischarge = {};
const mockDoctors = [];

export const mock = {
  login: async (username, password) => {
    await wait();
    const user = MOCK_USERS[username];
    if (!user || !password) throw new ApiError(401, "Invalid username or password");
    return { message: "Login successful", token: `mock-token-${user.role}`, user };
  },

  listStays: async () => {
    await wait();
    return { count: STAYS.length, stays: STAYS };
  },
  listDoctors: async () => {
    await wait(200);
    return [
      { user_id: 201, full_name: "Dr. Meera Nair", specialization: "Emergency Medicine" },
      { user_id: 202, full_name: "Dr. Arjun Rao", specialization: "Cardiology" },
      { user_id: 203, full_name: "Dr. Sana Iqbal", specialization: "Internal Medicine" },
    ];
  },
  assignDoctor: async (stayId, doctorUserId) => {
    await wait(350);
    const d = (await mock.listDoctors()).find((x) => String(x.user_id) === String(doctorUserId));
    if (!d) throw new ApiError(404, "Doctor not found");
    mockAssigned[String(stayId)] = d;
    return { message: "Doctor assigned successfully" };
  },
  createDischarge: async (stayId, body) => {
    await wait(400);
    const id = String(stayId);
    if (!STAYS.some((s) => String(s.stay_id) === id)) throw new ApiError(404, "Stay or linked patient not found");
    if (!mockAssigned[id]) throw new ApiError(403, "Only the actively assigned doctor can authorize discharge");
    if (mockDischarge[id]) throw new ApiError(409, "A discharge record already exists for this stay");
    if (!(body.discharge_status || "").trim()) throw new ApiError(400, "discharge_status is required");
    mockDischarge[id] = { discharge_id: 1, discharge_time: body.discharge_time || new Date().toISOString(), prescribed_followup: body.prescribed_followup === true, ...body, created_at: new Date().toISOString() };
    return { message: "Discharge record created", discharge: mockDischarge[id] };
  },
  recordDeparture: async (stayId) => {
    await wait(350);
    const d = mockDischarge[String(stayId)];
    if (!d) throw new ApiError(409, "The doctor has not authorized a discharge for this visit yet");
    if (d.departed_at) throw new ApiError(409, "This patient is already marked as left");
    d.departed_at = new Date().toISOString();
    return { message: "Departure recorded", departed_at: d.departed_at };
  },
  getPostEr: async (stayId) => {
    await wait(200);
    if (!STAYS.some((s) => String(s.stay_id) === String(stayId))) throw new ApiError(404, "ED stay not found");
    return {
      assigned_doctor: mockAssigned[String(stayId)] || null,
      follow_ups: mockFollowUps[String(stayId)] || [],
      prescriptions: prescriptions.filter((p) => p.stay_id === String(stayId)),
      discharge: mockDischarge[String(stayId)] || null,
    };
  },
  createFollowUp: async (stayId, body) => {
    await wait(350);
    if (!STAYS.some((s) => String(s.stay_id) === String(stayId))) throw new ApiError(404, "ED stay not found");
    if (typeof body.follow_up_date !== "string" || Number.isNaN(Date.parse(body.follow_up_date))) throw new ApiError(400, "A valid follow_up_date is required");
    if (!(body.follow_up_type || "").trim()) throw new ApiError(400, "follow_up_type is required");
    const list = (mockFollowUps[String(stayId)] ||= []);
    const row = { follow_up_id: list.length + 1, status: null, ...body, created_at: new Date().toISOString() };
    list.push(row);
    list.sort((a, b) => new Date(a.follow_up_date) - new Date(b.follow_up_date));
    return { message: "Follow-up created", follow_up: row };
  },
  getStaySummary: async (stayId) => {
    await wait();
    const s = summaryFor(String(stayId));
    if (!s) throw new ApiError(404, "Stay not found");
    return s;
  },
  getObservations: async (stayId) => {
    await wait(150);
    const o = observationsFor(String(stayId));
    if (!o) throw new ApiError(404, "Stay not found");
    return o;
  },
  getNews2Results: async (stayId) => ({ stay_id: stayId, count: 0, results: [] }),
  runDecisionSupport: async (stayId) => {
    await wait(500);
    return { message: "Decision support run complete", stay_id: stayId };
  },

  listPrescriptions: async (stayId) => {
    await wait(150);
    return { stay_id: stayId, prescriptions: prescriptions.filter((p) => p.stay_id === String(stayId)) };
  },
  createPrescription: async (stayId, body) => {
    await wait(600);
    const name = (body.medication_name || "").trim();
    if (!name) throw new ApiError(400, "medication_name is required");
    const risky = /ibuprofen|nsaid|aspirin/i.test(name) && String(stayId) === "30094124";
    const screening = {
      screening_status: "SCREENED",
      mapping_reason: null,
      checked_pairs_count: 1,
      interactions_found: risky
        ? [{ interaction_id: 1, drug_a: "warfarin", drug_b: name.toLowerCase(), interaction_level: "Major" }]
        : [],
      existing_unmapped_medications: [],
    };
    const prescription = {
      prescription_id: nextPrescriptionId++,
      stay_id: String(stayId),
      medication_name: name,
      dosage: body.dosage || null,
      frequency: body.frequency || null,
      route: body.route || null,
      duration: body.duration || null,
      instructions: body.instructions || null,
      status: "PENDING_REVIEW",
      screening_result: screening,
    };
    prescriptions.push(prescription);
    return { message: "Prescription created", prescription, screening };
  },
  reviewPrescription: async (stayId, prescriptionId, body) => {
    await wait(300);
    const p = prescriptions.find((x) => x.prescription_id === Number(prescriptionId));
    if (!p) throw new ApiError(404, "Prescription not found for this stay");
    if (p.status !== "PENDING_REVIEW") throw new ApiError(409, "This prescription has already been reviewed.");
    p.status = body.status;
    p.review_notes = body.review_notes || null;
    return { message: "Prescription reviewed", prescription: p };
  },

  // Admin. Mirrors the backend rules; there is no list-doctors endpoint.
  createDoctor: async (body) => {
    await wait(500);
    const u = (body.username || "").trim();
    if (u.length < 3) throw new ApiError(400, "Username must contain 3 to 100 characters");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((body.email || "").trim())) throw new ApiError(400, "A valid doctor email address is required");
    if (!(body.full_name || "").trim()) throw new ApiError(400, "Doctor full name is required (maximum 150 characters)");
    if (u === "doctor1" || mockDoctors.includes(u)) throw new ApiError(409, "Username, email, or registration number already exists");
    mockDoctors.push(u);
    // Sample mode has no email, so the link is returned for testing only.
    const token = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    mockInvites[token] = { name: body.full_name.trim(), used: false };
    return {
      message: "Doctor account created and invitation email sent successfully",
      doctor: { user_id: 100 + mockDoctors.length, username: u, email: body.email.trim(), role: "DOCTOR", is_active: false },
      sample_invite_path: `/accept-invitation?token=${token}`,
    };
  },
  createStaff: async (role, body) => {
    if (role === "DOCTOR") return mock.createDoctor(body);
    await wait(500);
    const u = (body.username || "").trim();
    if (u.length < 3) throw new ApiError(400, "Username must contain 3 to 100 characters");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((body.email || "").trim())) throw new ApiError(400, "A valid email address is required");
    if (!(body.full_name || "").trim()) throw new ApiError(400, "Full name is required");
    if (mockDoctors.includes(u)) throw new ApiError(409, "Username or email already exists");
    mockDoctors.push(u);
    const token = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    mockInvites[token] = { name: body.full_name.trim(), used: false };
    return {
      message: "Account created and invitation email sent successfully",
      doctor: { username: u, email: body.email.trim(), role, is_active: false },
      sample_invite_path: `/accept-invitation?token=${token}`,
    };
  },
  listFollowUps: async () => {
    await wait(200);
    const rows = Object.entries(mockFollowUps).flatMap(([stayId, list]) => list.map((f) => ({ ...f, stay_id: stayId })));
    rows.sort((a, b) => new Date(a.follow_up_date) - new Date(b.follow_up_date));
    return rows;
  },
  listPendingReviews: async () => {
    await wait(200);
    return prescriptions.filter((p) => p.status === "PENDING_REVIEW");
  },
  validateInvitation: async (token) => {
    await wait(300);
    const i = mockInvites[token];
    if (!i || i.used) throw new ApiError(400, "Invitation is invalid, expired, or already used");
    return { valid: true, doctor_name: i.name };
  },
  acceptInvitation: async (token, password) => {
    await wait(400);
    const i = mockInvites[token];
    if (!i || i.used) throw new ApiError(400, "Invitation is invalid, expired, or already used");
    if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new ApiError(400, "Password must contain 12 to 128 characters");
    i.used = true;
    return { message: "Invitation accepted. You can now log in." };
  },

  // Paramedic side (sample data). The NEWS2 scoring below only exists for sample mode;
  // in real mode the server calculates it.
  createCase: async (body) => {
    await wait(300);
    const code = (body.temporary_case_code || "").trim();
    if (!code) throw new ApiError(400, "temporary_case_code is required");
    if (store.some((c) => c.temporary_case_code === code)) throw new ApiError(409, "temporary_case_code already exists");
    const c = { case_id: nextCaseId++, temporary_case_code: code, status: "PRE_ER", stay_id: null, assessment: null, vital: null, transport: null };
    store.unshift(c);
    return { message: "Emergency case created successfully", case: { case_id: c.case_id, temporary_case_code: code, case_status: "PRE_ER" } };
  },
  listCases: async () => {
    await wait();
    const cases = store.map(view);
    return { count: cases.length, cases };
  },
  getCase: async (caseId) => {
    await wait(150);
    return view(find(caseId));
  },
  recordAssessment: async (caseId, body) => {
    await wait(300);
    find(caseId).assessment = { ...body, assessment_time: new Date().toISOString() };
    return { message: "Pre-ER assessment recorded successfully" };
  },
  recordVitals: async (caseId, body) => {
    await wait(300);
    const c = find(caseId);
    const has = ["heart_rate", "systolic_bp", "respiratory_rate", "spo2", "temperature", "diastolic_bp"].some((k) => body[k] != null);
    if (!has) throw new ApiError(400, "At least one vital measurement is required");
    c.vital = { ...(c.vital || {}), ...body, recorded_at: new Date().toISOString() };
    c.vitals = [...(c.vitals || []), { ...c.vital }];
    return { message: "Pre-ER vital signs recorded successfully" };
  },
  saveTransport: async (caseId, body) => {
    await wait(300);
    if (!body.ambulance_id) throw new ApiError(400, "ambulance_id is required");
    find(caseId).transport = { ...body, transport_status: "DISPATCHED", created_at: new Date().toISOString() };
    return { message: "Ambulance transport details recorded successfully" };
  },
  setTransportStatus: async (caseId, status) => {
    await wait(250);
    const c = find(caseId);
    if (!c.transport) throw new ApiError(404, "Ambulance transport record not found");
    const next = TRANSITIONS[c.transport.transport_status] || [];
    if (!next.includes(status)) throw new ApiError(409, `Cannot move transport from ${c.transport.transport_status} to ${status}`);
    c.transport.transport_status = status;
    c.transport.updated_at = new Date().toISOString();
    return { message: "Transport status updated" };
  },
  markArrived: async (caseId, stayId) => {
    await wait(400);
    const c = find(caseId);
    if (!STAYS.some((s) => String(s.stay_id) === String(stayId))) throw new ApiError(404, "ED stay or linked patient not found");
    if (store.some((x) => x !== c && String(x.stay_id) === String(stayId))) throw new ApiError(409, "ER stay is already linked to another emergency case");
    c.stay_id = Number(stayId);
    c.status = "ARRIVED_ER";
    if (c.transport) c.transport.transport_status = "ARRIVED_AT_DESTINATION";
    return { message: "Emergency case linked to ER stay" };
  },
};

const TRANSITIONS = {
  DISPATCHED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["ARRIVED_AT_DESTINATION", "CANCELLED"],
  ARRIVED_AT_DESTINATION: ["HANDOVER_COMPLETE"],
  HANDOVER_COMPLETE: [],
  CANCELLED: [],
};

const store = [
  { case_id: 2044, temporary_case_code: "ER-2044", status: "PRE_ER", stay_id: null,
    assessment: { chief_complaint: "Chest pain, 62 y", consciousness_status: "ALERT", allergy_status: "ALLERGIES_REPORTED", notes: "Allergies: penicillin", current_medications: [{ medication_name: "Aspirin", dose: "81mg" }], assessment_time: new Date(Date.now() - 38 * 60000).toISOString() },
    vital: { heart_rate: 108, respiratory_rate: 22, systolic_bp: 100, spo2: 94, temperature: 37.4, oxygen_support: false, consciousness_level: "ALERT", recorded_at: new Date(Date.now() - 22 * 60000).toISOString() },
    vitals: [
      { heart_rate: 118, respiratory_rate: 24, systolic_bp: 96, diastolic_bp: 60, spo2: 92, temperature: 37.6, recorded_at: new Date(Date.now() - 35 * 60000).toISOString() },
      { heart_rate: 108, respiratory_rate: 22, systolic_bp: 100, diastolic_bp: 64, spo2: 94, temperature: 37.4, recorded_at: new Date(Date.now() - 22 * 60000).toISOString() },
    ],
    transport: { ambulance_id: "AMB-12", destination_hospital: "City General", transport_status: "EN_ROUTE", created_at: new Date(Date.now() - 30 * 60000).toISOString(), updated_at: new Date(Date.now() - 25 * 60000).toISOString() } },
  { case_id: 2043, temporary_case_code: "ER-2043", status: "ARRIVED_ER", stay_id: 30112876,
    assessment: { chief_complaint: "Fall at home, 78 y", consciousness_status: "ALERT" },
    vital: { heart_rate: 84, respiratory_rate: 18, systolic_bp: 128, spo2: 96, temperature: 36.9, oxygen_support: false, consciousness_level: "ALERT" },
    transport: { ambulance_id: "AMB-07", destination_hospital: "City General", transport_status: "ARRIVED_AT_DESTINATION" } },
];
let nextCaseId = 2050;

function find(caseId) {
  const c = store.find((x) => x.case_id === Number(caseId));
  if (!c) throw new ApiError(404, "Emergency case not found");
  return c;
}

// Rough NEWS2 (scale 1) for sample mode only.
function score(v) {
  const need = ["respiratory_rate", "spo2", "systolic_bp", "heart_rate", "temperature", "consciousness_level", "oxygen_support"];
  const missing = need.filter((k) => v?.[k] == null || v?.[k] === "");
  if (missing.length) return { complete: false, missing, message: "NEWS2 calculation is incomplete because required clinical inputs are missing." };
  const rr = Number(v.respiratory_rate), sp = Number(v.spo2), sb = Number(v.systolic_bp), hr = Number(v.heart_rate), t = Number(v.temperature);
  const s = {
    respiratory_score: rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3,
    spo2_score: sp <= 91 ? 3 : sp <= 93 ? 2 : sp <= 95 ? 1 : 0,
    oxygen_score: v.oxygen_support ? 2 : 0,
    systolic_bp_score: sb <= 90 ? 3 : sb <= 100 ? 2 : sb <= 110 ? 1 : sb <= 219 ? 0 : 3,
    heart_rate_score: hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3,
    temperature_score: t <= 35 ? 3 : t <= 36 ? 1 : t <= 38 ? 0 : t <= 39 ? 1 : 2,
    consciousness_score: v.consciousness_level === "ALERT" ? 0 : 3,
  };
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const single3 = [s.respiratory_score, s.spo2_score, s.systolic_bp_score, s.heart_rate_score, s.temperature_score, s.consciousness_score].some((x) => x === 3);
  const risk_level = total >= 7 ? "High Risk" : total >= 5 ? "Medium Risk" : single3 ? "Low-Medium Risk" : "Low Risk";
  return { complete: true, ...s, total_news2_score: total, risk_level, is_clinical_decision: false };
}

function view(c) {
  const t = c.transport;
  return {
    case_id: c.case_id,
    temporary_case_code: c.temporary_case_code,
    status: c.status,
    stay_id: c.stay_id,
    steps: { assessment: !!c.assessment, vitals: !!c.vital, transport: !!t, handover: t?.transport_status === "HANDOVER_COMPLETE" },
    transport: t,
    latest_vital: c.vital,
    vitals_history: c.vitals || (c.vital ? [c.vital] : []),
    latest_assessment: c.assessment,
    news2: score(c.vital),
  };
}
