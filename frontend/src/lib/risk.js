// Maps the backend's risk text ("High Risk", "Low-Medium Risk", ...) to one UI look.
// Every badge shows color + word + icon. Class names are written out in full
// so Tailwind keeps them.

const LEVELS = {
  high: {
    key: "high", label: "HIGH", icon: "octagon", iconColor: "#FFFFFF",
    badge: "bg-risk-high-bg text-white",
  },
  medium: {
    key: "medium", label: "MEDIUM", icon: "triangle", iconColor: "#D9622B",
    badge: "bg-risk-medium-bg text-risk-medium-fg",
  },
  lowmed: {
    key: "lowmed", label: "LOW-MED", icon: "alert", iconColor: "#B7791F",
    badge: "bg-risk-lowmed-bg text-risk-lowmed-fg",
  },
  low: {
    key: "low", label: "LOW", icon: "check", iconColor: "#187A41",
    badge: "bg-risk-low-bg text-risk-low-fg",
  },
};

export function riskLevel(riskText) {
  const t = String(riskText || "").toLowerCase();
  if (t.startsWith("high")) return LEVELS.high;
  if (t.startsWith("medium")) return LEVELS.medium;
  if (t.startsWith("low-medium") || t.startsWith("low medium")) return LEVELS.lowmed;
  if (t.startsWith("low")) return LEVELS.low;
  return null; // unknown or missing: the UI shows "Not scored"
}

export const CASE_STATUSES = ["PRE_ER", "ARRIVED_ER", "ACTIVE_ER", "CLOSED"];
