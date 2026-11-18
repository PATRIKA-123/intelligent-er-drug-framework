// One import for the whole app: `import { api } from "../api"`.
// VITE_USE_MOCK=true uses sample data; anything else calls the real backend.
import { real } from "./real.js";
import { mock } from "./mock.js";

export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? "true") === "true";
export const api = USE_MOCK ? mock : real;
export { configureClient, ApiError } from "./client.js";
