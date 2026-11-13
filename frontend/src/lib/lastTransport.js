// Remember the last ambulance details on this device so the next case is prefilled.
// Storage can be blocked, so every access is guarded.
const KEY = "er.lastTransport";

export function lastTransport() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function rememberTransport({ ambulance_id, transport_type, destination_hospital }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ambulance_id, transport_type, destination_hospital }));
  } catch {
    /* storage unavailable: nothing is remembered */
  }
}
