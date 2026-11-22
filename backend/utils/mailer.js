"use strict";

// HTTPS transactional email transport for Render Free (SMTP ports are blocked).
// Requires RESEND_API_KEY and RESEND_FROM_EMAIL on the backend.
const API_URL = "https://api.resend.com/emails";

function config() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and RESEND_FROM_EMAIL must be configured");
  }
  return { apiKey, from };
}

async function requestResend(path, options) {
  const { apiKey } = config();
  let response;
  try {
    response = await fetch(`https://api.resend.com${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(options?.headers || {}),
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(error.name === "TimeoutError"
      ? "Resend HTTPS request timed out"
      : "Resend HTTPS request failed");
  }

  let body;
  try { body = await response.json(); }
  catch { body = {}; }

  if (!response.ok) {
    // Do not log or expose invitation tokens, provider credentials, or email body.
    const code = typeof body?.name === "string" ? ` (${body.name})` : "";
    throw new Error(`Resend API rejected request: HTTP ${response.status}${code}`);
  }
  return body;
}

async function sendEmail({ to, subject, html }) {
  const { from } = config();
  const result = await requestResend("/emails", {
    method: "POST",
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!result?.id) throw new Error("Resend returned no email identifier");
  return result;
}

// Keep the existing exported function name for compatibility.
// This checks API authentication over HTTPS, not inbox delivery.
async function verifyEmailConnection() {
  await requestResend("/domains", { method: "GET" });
  return true;
}

module.exports = { sendEmail, verifyEmailConnection };
