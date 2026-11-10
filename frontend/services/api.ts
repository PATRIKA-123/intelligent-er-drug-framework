import { apiClient } from "@/config/api";

export const authApi = { login: (payload: { email: string; password: string }) => apiClient.post("/auth/login", payload) };
export const patientsApi = { list: () => apiClient.get("/stays"), detail: (id: string) => apiClient.get(`/stays/${id}`) };
export const emergencyApi = { list: () => apiClient.get("/emergency-cases"), preEr: (id: string) => apiClient.get(`/emergency-cases/${id}/pre-er`) };
export const doctorsApi = { list: () => apiClient.get("/doctors") };
export const postErApi = { list: () => apiClient.get("/post-er") };

// Backend route inventory currently has no standalone medication endpoint; medication safety remains integration-ready.
