"use strict";

// B16: small, dependency-free HTTP security policy. Keep the CORS contract
// separate from Express so it is unit-testable without a database.
const LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "Idempotency-Key"];

function parseAllowedOrigins(env = process.env) {
  const production = env.NODE_ENV === "production";
  const configured = String(env.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const values = configured.length ? configured : (production ? [] : LOCAL_ORIGINS);
  if (!values.length) {
    throw new Error("CORS_ORIGINS must list the exact frontend origin(s) in production");
  }
  const origins = new Set();
  for (const value of values) {
    if (value === "*" || value === "null") {
      throw new Error("CORS_ORIGINS must not include wildcard or null origins");
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch (_) {
      throw new Error("CORS_ORIGINS must contain valid absolute http(s) origins");
    }
    if (!['http:', 'https:'].includes(parsed.protocol) ||
        !parsed.hostname || parsed.username || parsed.password ||
        parsed.pathname !== "/" || parsed.search || parsed.hash ||
        value !== parsed.origin) {
      throw new Error("CORS_ORIGINS entries must be exact http(s) origins without paths or credentials");
    }
    if (production && parsed.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      throw new Error("CORS_ORIGINS must use HTTPS for non-local production frontends");
    }
    origins.add(parsed.origin);
  }
  return origins;
}

function isOriginAllowed(origin, origins) {
  // A missing Origin can be a direct service-to-service request (curl, health checks).
  // Origin: null is an actual opaque browser origin and must be denied.
  return origin === undefined || origins.has(origin);
}

function applyApiSecurityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
}

module.exports = {
  ALLOWED_METHODS,
  ALLOWED_HEADERS,
  parseAllowedOrigins,
  isOriginAllowed,
  applyApiSecurityHeaders,
};
