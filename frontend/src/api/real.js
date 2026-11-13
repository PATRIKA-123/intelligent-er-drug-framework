// Calls the real backend. Paths and response shapes come from reading the
// backend code (see the contract report). Fields marked "needs backend" in
// mock.js are not returned by the real API yet.
import { request } from "./client.js";
import { rememberCase, rememberedCases } from "../lib/myCases.js";

export const real = {
  // Auth
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: { username, password } }),

  // ER stays
  // The stays list has no latest NEWS2 yet, so fill it from each stay's summary
  // (max 20 stays). Remove this once the backend adds it to the list.
  listStays: async () => {
    const data = await request("/stays");
    const stays = data.stays || [];
    await Promise.all(
      stays.map(async (s) => {
        if (s.latest_news2) return;
        try {
          const sum = await request(`/clinical-summary/${s.stay_id}`);
          s.latest_news2 = sum.latest_news2 || null;
          s.latest_observation = sum.latest_observation || null;
          if (sum.stay?.case_status) s.case_status = sum.stay.case_status;
          if (sum.stay?.case_code) s.case_code = sum.stay.case_code;
        } catch {
          /* leave this row unscored */
        }
      })
    );
    return { ...data, stays };
  },
  getStaySummary: (stayId) => request(`/clinical-summary/${stayId}`),
  getObservations: (stayId) => request(`/stays/${stayId}/observations`),
  getNews2Results: (stayId) => request(`/stays/${stayId}/news2`),
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
  // The backend has no "list my cases" endpoint yet, so this lists the cases
  // created or opened on this device. Replace when the backend adds one.
  listCases: async () => {
    const results = await Promise.allSettled(rememberedCases().map((id) => real.getCase(id)));
    const cases = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    return { count: cases.length, cases };
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
