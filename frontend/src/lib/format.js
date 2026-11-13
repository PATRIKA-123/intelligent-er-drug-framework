// Dates in the MIMIC demo data are shifted to ~2147, so show them as given.
export function formatTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function formatDateTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

export function minutesAgo(n) {
  if (n == null) return "–";
  return n < 1 ? "just now" : `${n} min ago`;
}
