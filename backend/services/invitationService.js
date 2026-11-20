"use strict";

// Shared helpers for account invitations (doctors, paramedics, ER staff).
// The table is still called doctor_invitations; it now holds invitations for
// every invited role. The role itself lives on users.role.

const crypto = require("crypto");

const INVITE_ROLES = ["DOCTOR", "PARAMEDIC", "ER_STAFF"];
const STAFF_ROLES = ["PARAMEDIC", "ER_STAFF"];
const ROLE_LABELS = {
  DOCTOR: "doctor",
  PARAMEDIC: "paramedic",
  ER_STAFF: "ER staff member",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value).replace(/[&<>"']/g, (c) => entities[c]);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Returns { error } or { base } where base is a URL object.
function getInvitationBaseUrl() {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) return { error: "FRONTEND_URL is not configured" };
  try {
    const base = new URL(frontendUrl);
    if (!["http:", "https:"].includes(base.protocol)) throw new Error("protocol");
    return { base };
  } catch {
    return { error: "FRONTEND_URL must be a valid HTTP or HTTPS URL" };
  }
}

function buildInvitationUrl(base, token) {
  const url = new URL("/accept-invitation", base);
  url.searchParams.set("token", token);
  return url.toString();
}

function validateUsername(value) {
  if (typeof value !== "string" || value.trim().length < 3 || value.trim().length > 100) {
    return "Username must contain 3 to 100 characters";
  }
  return null;
}

function validateEmail(value, label = "email address") {
  if (typeof value !== "string" || !EMAIL_PATTERN.test(value.trim()) || value.trim().length > 150) {
    return `A valid ${label} is required`;
  }
  return null;
}

function validateFullName(value, label = "Full name") {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 150) {
    return `${label} is required (maximum 150 characters)`;
  }
  return null;
}

// Parses a positive whole number path parameter. Returns null if invalid.
function parseUserId(value) {
  if (!/^\d{1,9}$/.test(String(value))) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

// Marks invitations that have run out as revoked, so a replacement can be made.
async function revokeExpiredInvitations(client) {
  await client.query(
    `UPDATE doctor_invitations
     SET revoked_at = NOW()
     WHERE expires_at <= NOW()
       AND accepted_at IS NULL
       AND revoked_at IS NULL`
  );
}

async function revokeOpenInvitationsForUser(client, userId) {
  await client.query(
    `UPDATE doctor_invitations
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND accepted_at IS NULL
       AND revoked_at IS NULL`,
    [userId]
  );
}

// Creates a single-use token valid for 24 hours. Only the SHA-256 hash is stored.
async function createInvitation(client, userId, createdBy) {
  const token = crypto.randomBytes(32).toString("hex");
  const result = await client.query(
    `INSERT INTO doctor_invitations (user_id, token_hash, expires_at, created_by)
     VALUES ($1, $2, NOW() + INTERVAL '24 hours', $3)
     RETURNING invitation_id`,
    [userId, hashToken(token), createdBy]
  );
  return { token, invitationId: result.rows[0].invitation_id };
}

function invitationEmail({ fullName, role, url }) {
  const roleLabel = ROLE_LABELS[role] || "team member";
  const greeting = role === "DOCTOR" ? `Hello Dr. ${escapeHtml(fullName)},` : `Hello ${escapeHtml(fullName)},`;
  return {
    subject: `Your Parvah invitation (${roleLabel})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
        <h2>Welcome to Parvah</h2>
        <p>${greeting}</p>
        <p>An administrator has invited you to join Parvah as a ${roleLabel}.</p>
        <p>Click the button below to accept your invitation and create your password.</p>
        <p style="margin: 30px 0;">
          <a href="${url}" style="background: #15171c; color: white; padding: 12px 20px;
             text-decoration: none; border-radius: 8px;">Accept invitation</a>
        </p>
        <p>This invitation expires in 24 hours and can only be used once.</p>
        <p>If you were not expecting this invitation, you can ignore this email.</p>
        <p>Regards,<br>The Parvah team<br><small>Intelligent Emergency Care</small></p>
      </div>
    `,
  };
}

module.exports = {
  INVITE_ROLES,
  STAFF_ROLES,
  ROLE_LABELS,
  escapeHtml,
  hashToken,
  getInvitationBaseUrl,
  buildInvitationUrl,
  validateUsername,
  validateEmail,
  validateFullName,
  parseUserId,
  revokeExpiredInvitations,
  revokeOpenInvitationsForUser,
  createInvitation,
  invitationEmail,
};
