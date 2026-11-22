"use strict";

// PARVAH transactional mail transport via Brevo HTTPS API.
// This module intentionally preserves the existing mailer exports used by
// doctors.js and staff.js. No SMTP ports or additional npm packages needed.

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

function config() {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Parvah";
  if (!apiKey || !senderEmail) {
    throw new Error("Brevo email configuration missing: BREVO_API_KEY or BREVO_SENDER_EMAIL");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
    throw new Error("BREVO_SENDER_EMAIL is invalid");
  }
  return { apiKey, senderEmail, senderName };
}

// Checks local configuration. It does NOT claim that Brevo has approved
// transactional sending or that an actual message can be delivered.
async function verifyEmailConnection() {
  config();
  return true;
}

async function sendEmail({ to, subject, html }) {
  const { apiKey, senderEmail, senderName } = config();
  if (typeof to !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
    throw new Error("Invalid invitation recipient email");
  }
  if (typeof subject !== "string" || !subject.trim() || typeof html !== "string" || !html.trim()) {
    throw new Error("Email subject and HTML content are required");
  }

  let response;
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "accept": "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to.trim() }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    // Don't log API keys or invitation tokens.
    throw new Error(`Brevo HTTPS request failed (${error.name === "TimeoutError" ? "timeout" : "network error"})`);
  }

  if (!response.ok) {
    let code = "unknown";
    try {
      const result = await response.json();
      if (typeof result?.code === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(result.code)) code = result.code;
    } catch { /* Brevo may return a non-JSON error */ }
    throw new Error(`Brevo API rejected email: HTTP ${response.status} (${code})`);
  }

  // HTTP 201 means Brevo accepted the request, not necessarily delivered.
  const result = await response.json().catch(() => ({}));
  return { messageId: result.messageId || null, accepted: [to.trim()] };
}

module.exports = { sendEmail, verifyEmailConnection };
