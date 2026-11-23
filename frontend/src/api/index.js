// One import for the whole app: `import { api } from "../api"`.
// VITE_USE_MOCK=true uses sample data; anything else calls the real backend.
import { real } from "./real.js";
import { mock } from "./mock.js";

// Production may never silently fall back to synthetic/mock patient data.
export const USE_MOCK = import.meta.env.DEV && String(import.meta.env.VITE_USE_MOCK ?? "false") === "true";
export const api = USE_MOCK ? mock : real;
export { configureClient, ApiError } from "./client.js";
