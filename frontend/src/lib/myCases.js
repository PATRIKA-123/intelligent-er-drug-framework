// The backend cannot list a paramedic's cases yet, so remember the case IDs
// created or opened on this device. Storage can be blocked, so every access is guarded.
const KEY = "er.myCases";

export function rememberedCases() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function rememberCase(id) {
  try {
    const list = rememberedCases().filter((x) => x !== id);
    list.unshift(id);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage unavailable: the list just will not persist */
  }
}
