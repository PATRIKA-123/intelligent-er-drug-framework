"use strict";

// Add a machine-readable code to existing {error: "..."} responses without
// breaking frontend clients that already consume the `error` field.
const DEFAULT_CODES = Object.freeze({
  400: "INVALID_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN",
  404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE",
  422: "UNPROCESSABLE_ENTITY", 429: "RATE_LIMITED",
  500: "INTERNAL_ERROR", 503: "SERVICE_UNAVAILABLE",
});
function addErrorCode(status, payload) {
  if (status < 400 || !payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof payload.error !== "string") return payload;
  return { ...payload, code: payload.code || DEFAULT_CODES[status] || "REQUEST_FAILED" };
}
function apiErrorContract(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (payload) => json(addErrorCode(res.statusCode, payload));
  next();
}
function apiErrorHandler(err, _req, res, next) {
  if (res.headersSent) return next(err);
  if (err?.type === "entity.parse.failed" && err.status === 400) {
    return res.status(400).json({ error: "Malformed JSON request body", code: "INVALID_JSON" });
  }
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ error: "Request body too large", code: "PAYLOAD_TOO_LARGE" });
  }
  console.error("Unhandled API error:", err?.message || "unknown");
  return res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
}
module.exports = { addErrorCode, apiErrorContract, apiErrorHandler };
