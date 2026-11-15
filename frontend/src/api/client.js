// Thin fetch wrapper: adds the token, turns errors into ApiError,
// and tells the app to sign out when the backend says 401 (token expired).

// Deployed builds: set VITE_API_BASE to the backend URL (no trailing slash). Dev uses the Vite proxy.
const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let getToken = () => null;
let onUnauthorized = () => {};

export function configureClient({ tokenGetter, unauthorizedHandler }) {
  getToken = tokenGetter;
  onUnauthorized = unauthorizedHandler;
}

export async function request(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection.");
  }

  let data = null;
  let notJson = false;
  const raw = await res.text().catch(() => "");
  if (raw.trim()) {
    try {
      data = JSON.parse(raw);
    } catch {
      notJson = true; // for example an error page from a proxy
    }
  }

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.error || data?.message || "Request failed", data);
  }
  if (notJson) throw new ApiError(res.status, "The server sent a reply the app could not read. Try again in a moment.");
  return data;
}
