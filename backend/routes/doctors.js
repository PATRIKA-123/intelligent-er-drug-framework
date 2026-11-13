
const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { sendEmail } = require("../utils/mailer");

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
      `SELECT dp.full_name, di.expires_at
       FROM doctor_invitations di
       JOIN users u ON u.user_id = di.user_id
       JOIN doctor_profiles dp ON dp.user_id = u.user_id
       WHERE di.token_hash = $1
         AND di.expires_at > NOW()
         AND di.accepted_at IS NULL
         AND di.revoked_at IS NULL
         AND u.role = 'DOCTOR'
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
      doctor_name: result.rows[0].full_name,
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

    // Activate the doctor and set their password.
    const userResult = await client.query(
      `UPDATE users
       SET password_hash = $1,
           is_active = TRUE
       WHERE user_id = $2
         AND role = 'DOCTOR'
         AND is_active = FALSE
       RETURNING user_id, username, email, role, is_active`,
      [passwordHash, invitation.user_id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "Doctor account is invalid or already activated"
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
      doctor: userResult.rows[0]
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

// Escape user-provided text before inserting it into email HTML.
const escapeHtml = (value) => {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
};

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
    const safeDoctorName = escapeHtml(cleanFullName);

    try {
      await sendEmail({
        to: cleanEmail,
        subject: "Doctor Invitation - Intelligent ER-Drug Framework",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2>Welcome to Intelligent ER-Drug Framework</h2>

            <p>Hello Dr. ${safeDoctorName},</p>

            <p>
              An administrator has invited you to join
              Intelligent ER-Drug Framework as a doctor.
            </p>

            <p>
              Click the button below to accept your invitation
              and create your password.
            </p>

            <p style="margin: 30px 0;">
              <a
                href="${invitationUrl.toString()}"
                style="background: #2563eb; color: white; padding: 12px 20px;
                text-decoration: none; border-radius: 5px;"
              >
                Accept Invitation
              </a>
            </p>

            <p>This invitation expires in 24 hours and can only be used once.</p>

            <p>If you were not expecting this invitation, you can ignore this email.</p>

            <p>Regards,<br>Intelligent ER-Drug Framework Team</p>
          </div>
        `
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

module.exports = router;
