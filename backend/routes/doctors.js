
const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { sendEmail } = require("../utils/mailer");
const inv = require("../services/invitationService");

const router = express.Router();
router.post("/validate-invitation", async (req, res) => {
  const { token } = req.body;

  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/i.test(token)
  ) {
    return res.status(400).json({
      valid: false,
      error: "A valid invitation token is required"
    });
  }

  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const result = await pool.query(
      `SELECT COALESCE(dp.full_name, sp.full_name, u.username) AS full_name,
              u.role, di.expires_at
       FROM doctor_invitations di
       JOIN users u ON u.user_id = di.user_id
       LEFT JOIN doctor_profiles dp ON dp.user_id = u.user_id
       LEFT JOIN staff_profiles sp ON sp.user_id = u.user_id
       WHERE di.token_hash = $1
         AND di.expires_at > NOW()
         AND di.accepted_at IS NULL
         AND di.revoked_at IS NULL
         AND u.role IN ('DOCTOR', 'PARAMEDIC', 'ER_STAFF')
         AND u.is_active = FALSE`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        valid: false,
        error: "Invitation is invalid, expired, or already used"
      });
    }

    return res.status(200).json({
      valid: true,
      // doctor_name kept so existing clients keep working; full_name and role
      // are the general names for doctors, paramedics and ER staff.
      doctor_name: result.rows[0].full_name,
      full_name: result.rows[0].full_name,
      role: result.rows[0].role,
      expires_at: result.rows[0].expires_at
    });

  } catch (error) {
    console.error("Invitation validation error:", error.message);

    return res.status(500).json({
      valid: false,
      error: "Failed to validate invitation"
    });
  }
});
router.post("/accept-invitation", async (req, res) => {
  const { token, password } = req.body;

  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/i.test(token)
  ) {
    return res.status(400).json({
      error: "A valid invitation token is required"
    });
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  ) {
    return res.status(400).json({
      error: "Password must contain 12 to 128 characters"
    });
  }

  let client;

  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const passwordHash = await bcrypt.hash(password, 10);

    client = await pool.connect();

    await client.query("BEGIN");

    // Find and lock a valid invitation.
    const invitationResult = await client.query(
      `SELECT invitation_id, user_id
       FROM doctor_invitations
       WHERE token_hash = $1
         AND expires_at > NOW()
         AND accepted_at IS NULL
         AND revoked_at IS NULL
       FOR UPDATE`,
      [tokenHash]
    );

    if (invitationResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Invitation is invalid, expired, or already used"
      });
    }

    const invitation = invitationResult.rows[0];

    // Activate the account (doctor, paramedic or ER staff) and set the password.
    const userResult = await client.query(
      `UPDATE users
       SET password_hash = $1,
           is_active = TRUE
       WHERE user_id = $2
         AND role IN ('DOCTOR', 'PARAMEDIC', 'ER_STAFF')
         AND is_active = FALSE
       RETURNING user_id, username, email, role, is_active`,
      [passwordHash, invitation.user_id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Account is invalid or already activated"
      });
    }

    // Mark invitation as accepted.
    await client.query(
      `UPDATE doctor_invitations
       SET accepted_at = NOW()
       WHERE invitation_id = $1`,
      [invitation.invitation_id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Invitation accepted. You can now log in.",
      doctor: userResult.rows[0], // kept for existing clients
      user: userResult.rows[0]
    });

  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError.message);
      }
    }

    console.error("Invitation acceptance error:", error.message);

    return res.status(500).json({
      error: "Failed to accept invitation"
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});

// T3: list of doctors. ADMIN sees every doctor with a status; ER_STAFF sees
// only active doctors (used to assign a doctor to a visit).
router.get(
  "/",
  authMiddleware,
  authMiddleware.requireRole("ADMIN", "ER_STAFF"),
  async (req, res) => {
    try {
      const isAdmin = req.user.role === "ADMIN";
      const result = await pool.query(
        `SELECT u.user_id, u.username, u.email, dp.full_name, dp.qualification,
                dp.specialization,
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
         JOIN doctor_profiles dp ON dp.user_id = u.user_id
         WHERE u.role = 'DOCTOR'
           AND ($1::boolean OR u.is_active = TRUE)
         ORDER BY dp.full_name`,
        [isAdmin]
      );

      const doctors = result.rows.map((row) => {
        const { email, ...rest } = row;
        return isAdmin ? { ...rest, email } : rest; // only admins see email addresses
      });
      return res.json({ doctors });
    } catch (error) {
      console.error("Doctor list error:", error.message);
      return res.status(500).json({ error: "Failed to list doctors" });
    }
  }
);

// 3. Authentication middleware
router.use(authMiddleware);
router.use(authMiddleware.requireRole("ADMIN"));

// Verify that administrator is active.
router.use(async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT user_id
       FROM users
       WHERE user_id = $1
         AND role = 'ADMIN'
         AND is_active = TRUE`,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: "An active administrator account is required"
      });
    }

    next();
  } catch (error) {
    console.error("Admin verification error:", error.message);

    return res.status(500).json({
      error: "Failed to verify administrator"
    });
  }
});

// POST /api/doctors
// Create a pending doctor account and send an invitation email.
router.post("/", async (req, res) => {
  const {
    username,
    email,
    full_name,
    qualification,
    specialization,
    registration_number
  } = req.body;

  // Validate username.
  if (
    typeof username !== "string" ||
    username.trim().length < 3 ||
    username.trim().length > 100
  ) {
    return res.status(400).json({
      error: "Username must contain 3 to 100 characters"
    });
  }

  // Email is mandatory because the invitation will be sent there.
  if (
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    email.trim().length > 150
  ) {
    return res.status(400).json({
      error: "A valid doctor email address is required"
    });
  }

  // Validate doctor's full name.
  if (
    typeof full_name !== "string" ||
    !full_name.trim() ||
    full_name.trim().length > 150
  ) {
    return res.status(400).json({
      error: "Doctor full name is required (maximum 150 characters)"
    });
  }

  // Validate optional fields.
  const optionalFields = [
    { name: "qualification", value: qualification, max: 150 },
    { name: "specialization", value: specialization, max: 150 },
    { name: "registration_number", value: registration_number, max: 100 }
  ];

  for (const field of optionalFields) {
    if (
      field.value !== undefined &&
      field.value !== null &&
      (typeof field.value !== "string" ||
        field.value.trim().length > field.max)
    ) {
      return res.status(400).json({
        error: `Invalid ${field.name}; maximum ${field.max} characters`
      });
    }
  }

  // Invitation links must point to the frontend application.
  const frontendUrl = process.env.FRONTEND_URL;

  if (!frontendUrl) {
    return res.status(500).json({
      error: "FRONTEND_URL is not configured"
    });
  }

  let invitationBaseUrl;

  try {
    invitationBaseUrl = new URL(frontendUrl);

    if (!["http:", "https:"].includes(invitationBaseUrl.protocol)) {
      throw new Error("Invalid URL protocol");
    }
  } catch {
    return res.status(500).json({
      error: "FRONTEND_URL must be a valid HTTP or HTTPS URL"
    });
  }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  const cleanFullName = full_name.trim();

  const cleanQualification =
    typeof qualification === "string" && qualification.trim()
      ? qualification.trim()
      : null;

  const cleanSpecialization =
    typeof specialization === "string" && specialization.trim()
      ? specialization.trim()
      : null;

  const cleanRegistrationNumber =
    typeof registration_number === "string" && registration_number.trim()
      ? registration_number.trim()
      : null;

  let client;
  let transactionStarted = false;
  let invitationId = null;
  let doctor = null;

  try {
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Recheck administrator status inside the transaction.
    const adminResult = await client.query(
      `SELECT user_id
       FROM users
       WHERE user_id = $1
         AND role = 'ADMIN'
         AND is_active = TRUE
       FOR SHARE`,
      [req.user.user_id]
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "Administrator account is no longer active"
      });
    }

    // Revoke expired invitations so a replacement can be created.
    await client.query(
      `UPDATE doctor_invitations
       SET revoked_at = NOW()
       WHERE expires_at <= NOW()
         AND accepted_at IS NULL
         AND revoked_at IS NULL`
    );

    // Create a random, unusable initial password.
    // The doctor will set their real password after accepting the invitation.
    const temporaryPassword = crypto.randomBytes(32).toString("hex");
    const temporaryPasswordHash = await bcrypt.hash(
      temporaryPassword,
      10
    );

    // Create an inactive DOCTOR account.
    const userResult = await client.query(
      `INSERT INTO users (
         username,
         email,
         password_hash,
         role,
         is_active
       )
       VALUES ($1, $2, $3, 'DOCTOR', FALSE)
       RETURNING user_id, username, email, role, is_active, created_at`,
      [
        cleanUsername,
        cleanEmail,
        temporaryPasswordHash
      ]
    );

    doctor = userResult.rows[0];

    // Create doctor profile.
    await client.query(
      `INSERT INTO doctor_profiles (
         user_id,
         full_name,
         qualification,
         specialization,
         registration_number
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        doctor.user_id,
        cleanFullName,
        cleanQualification,
        cleanSpecialization,
        cleanRegistrationNumber
      ]
    );

    // Generate a secure one-time invitation token.
    const invitationToken = crypto.randomBytes(32).toString("hex");

    // Store only the SHA-256 hash in the database.
    const tokenHash = crypto
      .createHash("sha256")
      .update(invitationToken)
      .digest("hex");

    // Invitation expires after 24 hours.
    const invitationResult = await client.query(
      `INSERT INTO doctor_invitations (
         user_id,
         token_hash,
         expires_at,
         created_by
       )
       VALUES ($1, $2, NOW() + INTERVAL '24 hours', $3)
       RETURNING invitation_id`,
      [
        doctor.user_id,
        tokenHash,
        req.user.user_id
      ]
    );

    invitationId = invitationResult.rows[0].invitation_id;

    await client.query("COMMIT");
    transactionStarted = false;

    // Build invitation URL.
    const invitationUrl = new URL(
      "/accept-invitation",
      invitationBaseUrl
    );

    invitationUrl.searchParams.set("token", invitationToken);

    // Send invitation email.
    try {
      const message = inv.invitationEmail({
        fullName: cleanFullName,
        role: "DOCTOR",
        url: invitationUrl.toString()
      });

      await sendEmail({
        to: cleanEmail,
        subject: message.subject,
        html: message.html
      });
    } catch (emailError) {
      // Revoke the invitation if email delivery fails.
      await pool.query(
        `UPDATE doctor_invitations
         SET revoked_at = NOW()
         WHERE invitation_id = $1`,
        [invitationId]
      );

      console.error("Doctor invitation email error:", emailError.message);

      return res.status(502).json({
        error: "Doctor account was created, but the invitation email could not be sent. Check email configuration before retrying.",
        doctor_id: doctor.user_id
      });
    }

    return res.status(201).json({
      message: "Doctor account created and invitation email sent successfully",
      doctor
    });

  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError.message);
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Username, email, registration number, or pending invitation already exists"
      });
    }

    console.error("Doctor creation error:", error.message);

    return res.status(500).json({
      error: "Failed to create doctor invitation"
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});

// POST /api/doctors/:user_id/resend-invitation  (T3)
// For a doctor who has not accepted yet: revoke old invitations, send a new
// one, and optionally correct a mistyped email address.
router.post("/:user_id/resend-invitation", async (req, res) => {
  const userId = inv.parseUserId(req.params.user_id);
  if (userId === null) {
    return res.status(400).json({ error: "user_id must be a positive whole number" });
  }

  const newEmail = req.body && req.body.email;
  if (newEmail !== undefined) {
    const problem = inv.validateEmail(newEmail, "doctor email address");
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
      `SELECT u.user_id, u.email, u.is_active, dp.full_name
       FROM users u
       JOIN doctor_profiles dp ON dp.user_id = u.user_id
       WHERE u.user_id = $1 AND u.role = 'DOCTOR'
       FOR UPDATE OF u`,
      [userId]
    );
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(404).json({ error: "Doctor not found" });
    }
    const doctor = found.rows[0];
    if (doctor.is_active) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(409).json({ error: "This doctor account is already active" });
    }

    const email = newEmail !== undefined ? newEmail.trim().toLowerCase() : doctor.email;
    if (email !== doctor.email) {
      await client.query(`UPDATE users SET email = $1 WHERE user_id = $2`, [email, userId]);
    }

    await inv.revokeOpenInvitationsForUser(client, userId);
    const { token, invitationId } = await inv.createInvitation(client, userId, req.user.user_id);
    await client.query("COMMIT");
    inTransaction = false;

    const message = inv.invitationEmail({
      fullName: doctor.full_name,
      role: "DOCTOR",
      url: inv.buildInvitationUrl(base, token)
    });
    try {
      await sendEmail({ to: email, subject: message.subject, html: message.html });
    } catch (emailError) {
      await pool.query(
        `UPDATE doctor_invitations SET revoked_at = NOW() WHERE invitation_id = $1`,
        [invitationId]
      );
      console.error("Doctor invitation email error:", emailError.message);
      return res.status(502).json({
        error: "A new invitation was created, but the email could not be sent.",
        user_id: userId
      });
    }

    return res.status(200).json({ message: "New invitation sent", user_id: userId });
  } catch (error) {
    if (client && inTransaction) {
      try { await client.query("ROLLBACK"); } catch (e) { console.error("Rollback error:", e.message); }
    }
    if (error.code === "23505") {
      return res.status(409).json({ error: "That email address is already used by another account" });
    }
    console.error("Doctor resend error:", error.message);
    return res.status(500).json({ error: "Failed to resend invitation" });
  } finally {
    if (client) client.release();
  }
});

// DELETE /api/doctors/:user_id  (T3)
// Only for a doctor who never accepted the invitation. Frees the username.
router.delete("/:user_id", async (req, res) => {
  const userId = inv.parseUserId(req.params.user_id);
  if (userId === null) {
    return res.status(400).json({ error: "user_id must be a positive whole number" });
  }

  let client;
  let inTransaction = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;

    const found = await client.query(
      `SELECT user_id, is_active FROM users
       WHERE user_id = $1 AND role = 'DOCTOR'
       FOR UPDATE`,
      [userId]
    );
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(404).json({ error: "Doctor not found" });
    }
    if (found.rows[0].is_active) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(409).json({ error: "Only a doctor who never accepted the invitation can be deleted" });
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
    await client.query(`DELETE FROM doctor_profiles WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM users WHERE user_id = $1`, [userId]);
    await client.query("COMMIT");
    inTransaction = false;
    return res.status(200).json({ message: "Doctor account deleted" });
  } catch (error) {
    if (client && inTransaction) {
      try { await client.query("ROLLBACK"); } catch (e) { console.error("Rollback error:", e.message); }
    }
    if (error.code === "23503") {
      return res.status(409).json({ error: "This account is referenced by other records and cannot be deleted" });
    }
    console.error("Doctor delete error:", error.message);
    return res.status(500).json({ error: "Failed to delete doctor" });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
