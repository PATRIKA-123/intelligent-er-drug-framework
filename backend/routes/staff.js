"use strict";

// T1: administrators invite paramedics and ER staff (same flow as doctors).
//   POST   /api/staff                              create + email an invitation
//   GET    /api/staff                              list invited and active staff
//   POST   /api/staff/:user_id/resend-invitation   new invitation (optional new email)
//   DELETE /api/staff/:user_id                     remove an account that never accepted

const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { sendEmail } = require("../utils/mailer");
const inv = require("../services/invitationService");

const router = express.Router();

router.use(authMiddleware);
router.use(authMiddleware.requireRole("ADMIN"));

async function sendInvitation({ invitationId, to, fullName, role, token, base }) {
  const url = inv.buildInvitationUrl(base, token);
  const message = inv.invitationEmail({ fullName, role, url });
  try {
    await sendEmail({ to, subject: message.subject, html: message.html });
    return null;
  } catch (emailError) {
    await pool.query(
      `UPDATE doctor_invitations SET revoked_at = NOW() WHERE invitation_id = $1`,
      [invitationId]
    );
    console.error("Staff invitation email error:", emailError.message);
    return emailError;
  }
}

async function rollbackQuietly(client) {
  try {
    await client.query("ROLLBACK");
  } catch (e) {
    console.error("Rollback error:", e.message);
  }
}

// POST /api/staff
router.post("/", async (req, res) => {
  const { username, email, full_name, role } = req.body || {};

  if (!inv.STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: "role must be PARAMEDIC or ER_STAFF" });
  }
  const problem =
    inv.validateUsername(username) ||
    inv.validateEmail(email, "staff email address") ||
    inv.validateFullName(full_name, "Full name");
  if (problem) return res.status(400).json({ error: problem });

  const { base, error: urlError } = inv.getInvitationBaseUrl();
  if (urlError) return res.status(500).json({ error: urlError });

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanFullName = full_name.trim();

  let client;
  let inTransaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    const admin = await client.query(
      `SELECT user_id FROM users
       WHERE user_id = $1 AND role = 'ADMIN' AND is_active = TRUE
       FOR SHARE`,
      [req.user.user_id]
    );
    if (admin.rows.length === 0) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(403).json({ error: "Administrator account is no longer active" });
    }

    await inv.revokeExpiredInvitations(client);

    // Random, unusable password: the person sets their own after accepting.
    const unusableHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

    const userResult = await client.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING user_id, username, email, role, is_active, created_at`,
      [cleanUsername, cleanEmail, unusableHash, role]
    );
    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO staff_profiles (user_id, full_name) VALUES ($1, $2)`,
      [user.user_id, cleanFullName]
    );

    const { token, invitationId } = await inv.createInvitation(client, user.user_id, req.user.user_id);

    await client.query("COMMIT");
    inTransaction = false;

    const emailError = await sendInvitation({
      invitationId, to: cleanEmail, fullName: cleanFullName, role, token, base,
    });
    if (emailError) {
      return res.status(502).json({
        error: "The account was created, but the invitation email could not be sent. Use resend-invitation after checking the email settings.",
        user_id: user.user_id,
      });
    }

    return res.status(201).json({
      message: "Account created and invitation email sent",
      user: { ...user, full_name: cleanFullName },
    });
  } catch (error) {
    if (client && inTransaction) await rollbackQuietly(client);
    if (error.code === "23505") {
      return res.status(409).json({ error: "Username or email already exists" });
    }
    console.error("Staff creation error:", error.message);
    return res.status(500).json({ error: "Failed to create staff invitation" });
  } finally {
    if (client) client.release();
  }
});

// GET /api/staff
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.user_id, u.username, u.email, u.role, sp.full_name,
              CASE
                WHEN u.is_active THEN 'ACTIVE'
                WHEN EXISTS (
                  SELECT 1 FROM doctor_invitations di
                  WHERE di.user_id = u.user_id
                    AND di.accepted_at IS NULL AND di.revoked_at IS NULL
                    AND di.expires_at > NOW()
                ) THEN 'PENDING'
                ELSE 'EXPIRED'
              END AS status
       FROM users u
       LEFT JOIN staff_profiles sp ON sp.user_id = u.user_id
       WHERE u.role IN ('PARAMEDIC', 'ER_STAFF')
       ORDER BY u.role, u.username`
    );
    return res.json({ staff: result.rows });
  } catch (error) {
    console.error("Staff list error:", error.message);
    return res.status(500).json({ error: "Failed to list staff" });
  }
});

// POST /api/staff/:user_id/resend-invitation
router.post("/:user_id/resend-invitation", async (req, res) => {
  const userId = inv.parseUserId(req.params.user_id);
  if (userId === null) return res.status(400).json({ error: "user_id must be a positive whole number" });

  const newEmail = req.body && req.body.email;
  if (newEmail !== undefined) {
    const problem = inv.validateEmail(newEmail, "staff email address");
    if (problem) return res.status(400).json({ error: problem });
  }

  const { base, error: urlError } = inv.getInvitationBaseUrl();
  if (urlError) return res.status(500).json({ error: urlError });

  let client;
  let inTransaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    const found = await client.query(
      `SELECT u.user_id, u.email, u.role, u.is_active, sp.full_name
       FROM users u LEFT JOIN staff_profiles sp ON sp.user_id = u.user_id
       WHERE u.user_id = $1 AND u.role IN ('PARAMEDIC', 'ER_STAFF')
       FOR UPDATE OF u`,
      [userId]
    );
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(404).json({ error: "Staff account not found" });
    }
    const user = found.rows[0];
    if (user.is_active) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(409).json({ error: "This account is already active" });
    }

    const email = newEmail !== undefined ? newEmail.trim().toLowerCase() : user.email;
    if (email !== user.email) {
      await client.query(`UPDATE users SET email = $1 WHERE user_id = $2`, [email, userId]);
    }

    await inv.revokeOpenInvitationsForUser(client, userId);
    const { token, invitationId } = await inv.createInvitation(client, userId, req.user.user_id);
    await client.query("COMMIT");
    inTransaction = false;

    const fullName = user.full_name || email;
    const emailError = await sendInvitation({
      invitationId, to: email, fullName, role: user.role, token, base,
    });
    if (emailError) {
      return res.status(502).json({ error: "A new invitation was created, but the email could not be sent.", user_id: userId });
    }
    return res.status(200).json({ message: "New invitation sent", user_id: userId });
  } catch (error) {
    if (client && inTransaction) await rollbackQuietly(client);
    if (error.code === "23505") {
      return res.status(409).json({ error: "That email address is already used by another account" });
    }
    console.error("Staff resend error:", error.message);
    return res.status(500).json({ error: "Failed to resend invitation" });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/staff/:user_id  (only for an account that never accepted)
router.delete("/:user_id", async (req, res) => {
  const userId = inv.parseUserId(req.params.user_id);
  if (userId === null) return res.status(400).json({ error: "user_id must be a positive whole number" });

  let client;
  let inTransaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    const found = await client.query(
      `SELECT user_id, is_active FROM users
       WHERE user_id = $1 AND role IN ('PARAMEDIC', 'ER_STAFF')
       FOR UPDATE`,
      [userId]
    );
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(404).json({ error: "Staff account not found" });
    }
    if (found.rows[0].is_active) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(409).json({ error: "Only an account that never accepted its invitation can be deleted" });
    }
    const accepted = await client.query(
      `SELECT 1 FROM doctor_invitations WHERE user_id = $1 AND accepted_at IS NOT NULL LIMIT 1`,
      [userId]
    );
    if (accepted.rows.length > 0) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(409).json({ error: "This account has already been used and cannot be deleted" });
    }

    await client.query(`DELETE FROM doctor_invitations WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM staff_profiles WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE user_id = $1`, [userId]);
    await client.query("COMMIT");
    inTransaction = false;
    return res.status(200).json({ message: "Account deleted" });
  } catch (error) {
    if (client && inTransaction) await rollbackQuietly(client);
    if (error.code === "23503") {
      return res.status(409).json({ error: "This account is referenced by other records and cannot be deleted" });
    }
    console.error("Staff delete error:", error.message);
    return res.status(500).json({ error: "Failed to delete account" });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
