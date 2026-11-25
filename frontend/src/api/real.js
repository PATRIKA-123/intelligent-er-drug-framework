// ROUND2_E_ADAPTER_V1
// Calls the real backend. Paths and response shapes come from reading the
// backend code (see the contract report). Fields marked "needs backend" in
// mock.js are not returned by the real API yet.
import { request } from "./client.js";
import { rememberCase } from "../lib/myCases.js";

export const real = {
  // Auth
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: { username, password } }),

  // ER stays
  // Board API already returns scoped latest NEWS2 and observation data.
  listStays: () => request('/stays?limit=100'),
  // Assigned doctor, follow-ups, prescriptions and discharge for a stay.
  // The server has no "list doctors" route yet; the screen falls back to typing a doctor ID.
  listDoctors: async () => { const r = await request("/doctors"); return r.doctors || r; },
  assignDoctor: (stayId, doctorUserId, notes) =>
    request(`/post-er/${stayId}/assign-doctor`, { method: "POST", body: { doctor_user_id: Number(doctorUserId), ...(notes ? { notes } : {}) } }),
  createDischarge: (stayId, body) => request(`/post-er/${stayId}/discharge`, { method: "POST", body }),
  // Not in the server yet: ER staff confirm the patient has left after discharge.
  recordDeparture: (stayId) => request(`/stays/${stayId}/departure`, { method: "POST", body: {} }),
  getPostEr: (stayId) => request(`/post-er/${stayId}`),
  createFollowUp: (stayId, body) => request(`/post-er/${stayId}/follow-ups`, { method: "POST", body }),
  getStaySummary: (stayId) => request(`/clinical-summary/${stayId}`),
  getObservations: (stayId) => request(`/stays/${stayId}/observations`),
  recordStayObservation: (stayId, body) =>
    request(`/stays/${stayId}/observations`, { method: "POST", body }),
  getNews2Results: (stayId) => request(`/stays/${stayId}/news2`),
  getFhirBundle: (stayId) => request(`/stays/${stayId}/fhir`),
  acknowledgeAlert: (alertId) =>
    request(`/alerts/${alertId}/acknowledge`, { method: "PATCH", body: {} }),
  runDecisionSupport: (stayId) =>
    request(`/decision-support/${stayId}`, { method: "POST" }),

  // Post-ER (doctor)
  listPrescriptions: (stayId) => request(`/post-er/${stayId}/prescriptions`),
  createPrescription: (stayId, body) =>
    request(`/post-er/${stayId}/prescriptions`, { method: "POST", body }),
  reviewPrescription: (stayId, prescriptionId, body) =>
    request(`/post-er/${stayId}/prescriptions/${prescriptionId}/review`, {
      method: "PATCH",
      body,
    }),

  // Admin
  createDoctor: (body) => request("/doctors", { method: "POST", body }),
  createStaff: (role, body) => role === 'DOCTOR'
    ? real.createDoctor(body)
    : request('/staff', { method: 'POST', body: { ...body, role } }),
  listFollowUps: async () => { const r = await request('/post-er/follow-ups'); return r.follow_ups || []; },
  listPendingReviews: async () => { const r = await request('/post-er/prescriptions?status=PENDING_REVIEW'); return r.prescriptions || []; },
  registerPatient: (body) => request('/patient/register', { method: 'POST', body }),
  listMyVisits: async () => {
    const r = await request('/patient/me');
    return { ...r, profile: { ...r.profile, share: r.profile?.share ?? r.profile?.share_history,
      dob: r.profile?.dob ?? r.profile?.date_of_birth }, visits: r.visits || [] };
  },
  // The server returns 202 for a pending claim; review is required before visits are visible.
  claimVisit: (body) => request('/patient/claim-visit', { method: 'POST', body }),
  listClaimRequests: async () => { const r = await request('/patient/claim-requests'); return r.requests || []; },
  registerVisit: (caseId, body, idempotencyKey) => {
    if (!idempotencyKey) throw new Error('An idempotency key is required for visit registration');
    const patient = { full_name: body.patient_name, date_of_birth: body.dob || undefined,
      phone: body.phone || undefined, email: body.email || undefined };
    return request('/stays', { method: 'POST',
      body: { case_id: Number(caseId), patient, chiefcomplaint: body.chief_complaint,
        ...(body.doctor_user_id ? { doctor_user_id: Number(body.doctor_user_id) } : {}) },
      extraHeaders: { 'Idempotency-Key': idempotencyKey } });
  },
  listMyHealth: () => request('/patient/health'),
  addMyHealthItem: (kind, body) => {
    if (!['allergies', 'medications', 'conditions'].includes(kind)) throw new Error('Unknown health list');
    const key = kind === 'allergies' ? 'reaction' : kind === 'medications' ? 'dose' : 'note';
    return request('/patient/' + kind, { method: 'POST', body: { name: body.name, [key]: body[key] ?? body.extra ?? '' } });
  },
  removeMyHealthItem: (kind, id) => {
    if (!['allergies', 'medications', 'conditions'].includes(kind)) throw new Error('Unknown health list');
    return request('/patient/' + kind + '/' + encodeURIComponent(String(id)), { method: 'DELETE' });
  },
  updateMyProfile: (body) => request('/patient/profile', { method: 'PATCH', body }),
  changeMyPassword: (body) => request('/patient/password', { method: 'POST', body }),
  newAccessCode: (stayId) => request('/stays/' + encodeURIComponent(String(stayId)) + '/access-code', { method: 'POST', body: {} }),
  getPatientDetails: (stayId) => request('/stays/' + encodeURIComponent(String(stayId)) + '/patient-details'),
  updatePatientDetails: (stayId, body) => request('/stays/' + encodeURIComponent(String(stayId)) + '/patient-details', { method: 'PATCH', body }),
  getPatientHistory: (stayId) => request('/stays/' + encodeURIComponent(String(stayId)) + '/patient-history'),
  listIdentityReviews: async () => { const r = await request('/admin/identity-reviews'); return r.reviews || []; },
  reviewIdentity: (reviewId, body) => request('/admin/identity-reviews/' + encodeURIComponent(String(reviewId)) + '/decision', { method: 'POST', body }),
  // Public (no sign-in): the doctor opens the emailed link.
  validateInvitation: (token) => request("/doctors/validate-invitation", { method: "POST", body: { token } }),
  acceptInvitation: (token, password) => request("/doctors/accept-invitation", { method: "POST", body: { token, password } }),

  // Paramedic side. The case page reads the backend's "workflow" snapshot.
  createCase: async (body) => {
    const res = await request("/emergency-cases", { method: "POST", body });
    rememberCase(res.case.case_id);
    return res;
  },
  getCase: async (caseId) => {
    const [w, v] = await Promise.all([
      request(`/emergency-cases/${caseId}/workflow`),
      request(`/emergency-cases/${caseId}/vitals`).catch(() => ({ vitals: [] })),
    ]);
    const c = normalizeCase(w, v.vitals || []);
    rememberCase(c.case_id);
    return c;
  },
  recordAssessment: (caseId, body) =>
    request(`/emergency-cases/${caseId}/assessments`, { method: "POST", body }),
  recordVitals: (caseId, body) =>
    request(`/emergency-cases/${caseId}/vitals`, { method: "POST", body }),
  saveTransport: (caseId, body) =>
    request(`/emergency-cases/${caseId}/transport`, { method: "POST", body }),
  setTransportStatus: (caseId, transport_status) =>
    request(`/emergency-cases/${caseId}/transport`, { method: "PATCH", body: { transport_status } }),
  markArrived: (caseId, stayId) =>
    request(`/emergency-cases/${caseId}/er-arrival`, { method: "POST", body: { stay_id: Number(stayId) } }),
  listCases: async () => {
    const r = await request('/emergency-cases?limit=100');
    return { count: r.count ?? (r.cases || []).length, cases: (r.cases || []).map(c => ({
      ...c, status: c.case_status || c.status,
      latest_assessment: c.chief_complaint ? { chief_complaint: c.chief_complaint } : null,
      news2: c.latest_news2 ? {complete: true, ...c.latest_news2} : {complete: false},
      steps: { assessment: Boolean(c.chief_complaint), vitals: Boolean(c.latest_news2),
        transport: Boolean(c.transport), handover: c.transport?.transport_status === 'HANDOVER_COMPLETE' },
    })) };
  },
};

function normalizeCase(w, vitals = []) {
  const t = w.transport || null;
  const risk = w.clinical_risk || {};
  return {
    case_id: w.case_id,
    temporary_case_code: w.case?.temporary_case_code,
    status: w.case?.case_status,
    stay_id: w.linked_stay_id || null,
    steps: {
      assessment: !!w.latest_assessment,
      vitals: !!w.latest_vital,
      transport: !!t,
      handover: t?.transport_status === "HANDOVER_COMPLETE",
    },
    transport: t,
    latest_vital: w.latest_vital || null,
    vitals_history: vitals,
    latest_assessment: w.latest_assessment || null,
    news2:
      risk.status === "complete"
        ? { complete: true, ...risk.news2 }
        : { complete: false, missing: risk.missing_fields || [], message: risk.message || risk.error || "" },
  };
}
