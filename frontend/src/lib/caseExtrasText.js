import { minsSince } from './format';

export function repeatDue(c) {
  if (!c?.latest_vital?.recorded_at || c.steps?.handover) return null;
  const m = minsSince(c.latest_vital.recorded_at);
  return m != null && m >= 15 ? m : null;
}

export function allergyText(a) {
  if (!a) return "Not recorded";
  const named = /Allergies:\s*([^\n]+)/i.exec(a.notes || "")?.[1];
  if (a.allergy_status === "ALLERGIES_REPORTED") return named ? `Allergic to ${named}` : "Allergies reported";
  if (a.allergy_status === "NONE_REPORTED") return "No allergies reported";
  if (a.allergy_status === "UNKNOWN") return "Not known";
  return a.allergy_status || "Not recorded";
}
export function medsText(a) {
  const m = Array.isArray(a?.current_medications) ? a.current_medications : [];
  if (!m.length) return "None reported";
  return m.map((x) => [x.medication_name, x.dose].filter(Boolean).join(" ")).join(", ");
}

