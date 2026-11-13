// Calls the real backend. Paths and response shapes come from reading the
// backend code (see the contract report). Fields marked "needs backend" in
// mock.js are not returned by the real API yet.
import { request } from "./client.js";

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

  // Paramedic side
  getCase: (caseId) => request(`/emergency-cases/${caseId}`),
  getCaseWorkflow: (caseId) => request(`/emergency-cases/${caseId}/workflow`),
  setCaseStatus: (caseId, status) =>
    request(`/emergency-cases/${caseId}/status`, { method: "PATCH", body: { status } }),
  markArrived: (caseId, body) =>
    request(`/emergency-cases/${caseId}/er-arrival`, { method: "POST", body }),
  // Not in the backend yet: a list of cases. The mock provides it so the UI can be built.
  listCases: async () => {
    throw new Error("Backend has no endpoint to list emergency cases yet (see ask 1 in the contract report).");
  },
};
