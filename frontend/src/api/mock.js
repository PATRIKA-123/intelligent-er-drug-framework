// Same function names as real.js, backed by sample data. Used when VITE_USE_MOCK=true.
import { ApiError } from "./client.js";
import { MOCK_USERS, STAYS, CASES, summaryFor, observationsFor } from "./mockData.js";

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

let prescriptions = []; // in memory only
let nextPrescriptionId = 1;
const cases = CASES.map((c) => ({ ...c, steps: { ...c.steps } }));

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

  // Paramedic side. listCases is NEEDS-BACKEND.
  listCases: async () => {
    await wait();
    return { count: cases.length, cases };
  },
  getCase: async (caseId) => {
    await wait(150);
    const c = cases.find((x) => x.case_id === Number(caseId));
    if (!c) throw new ApiError(404, "Case not found");
    return c;
  },
  getCaseWorkflow: async (caseId) => mock.getCase(caseId),
  setCaseStep: async (caseId, step, done) => {
    const c = cases.find((x) => x.case_id === Number(caseId));
    if (c) c.steps[step] = done;
    return c;
  },
  setCaseStatus: async (caseId, status) => {
    await wait(300);
    const c = cases.find((x) => x.case_id === Number(caseId));
    if (!c) throw new ApiError(404, "Case not found");
    c.status = status;
    return { message: "Status updated", case: c };
  },
  markArrived: async (caseId) => mock.setCaseStatus(caseId, "ARRIVED_ER"),
};
