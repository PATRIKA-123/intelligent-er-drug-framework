"use strict";

// B18: validate configuration without ever printing secret values.
// Pure function: unit tests can supply a fake environment without a database.
const PLACEHOLDERS = new Set([
  "changeme", "change-me", "replace_me", "replace-me", "your_password",
  "your_secret", "your_database", "your_user", "localhost-example",
]);

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlaceholder(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return PLACEHOLDERS.has(s) || s.includes("replace_with") || s.includes("your-");
}

function validateStartupEnvironment(env) {
  const errors = [];
  for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"]) {
    if (!present(env[key])) errors.push(`${key} is required`);
    else if (isPlaceholder(env[key])) errors.push(`${key} must not be a placeholder`);
  }

  if (!present(env.JWT_SECRET)) {
    errors.push("JWT_SECRET is required");
  } else if (env.JWT_SECRET.length < 32 || isPlaceholder(env.JWT_SECRET)) {
    errors.push("JWT_SECRET must be a non-placeholder value of at least 32 characters");
  }

  for (const key of ["PORT", "DB_PORT"]) {
    if (env[key] !== undefined && env[key] !== "") {
      const raw = String(env[key]);
      if (!/^[0-9]+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
        errors.push(`${key} must be an integer from 1 to 65535`);
      }
    }
  }

  if (env.DB_SSL !== undefined && !["true", "false"].includes(env.DB_SSL)) {
    errors.push("DB_SSL must be true or false");
  }

  if (errors.length > 0) {
    const error = new Error(errors.join("; "));
    error.name = "StartupConfigurationError";
    throw error;
  }
  return true;
}

module.exports = { validateStartupEnvironment };
