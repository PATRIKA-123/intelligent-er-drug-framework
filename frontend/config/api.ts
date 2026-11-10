import axios from "axios";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000/api";

export const apiClient = axios.create({ baseURL: API_BASE_URL, headers: { "Content-Type": "application/json" } });

export function setAuthToken(token?: string) {
  if (token) apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete apiClient.defaults.headers.common.Authorization;
}
