
const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// All doctor-management routes require authentication.
router.use(authMiddleware);

// Only ADMIN accounts can create doctors.
router.use(authMiddleware.requireRole("ADMIN"));

// Verify that the administrator is still active in the database.
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
// Create a DOCTOR account and its profile in one transaction.
router.post("/", async (req, res) => {
  const {
    username,
    email,
    password,
    full_name,
    qualification,
    specialization,
    registration_number
  } = req.body;

  // Validate required fields.
  if (
    typeof username !== "string" ||
    username.trim().length < 3 ||
    username.trim().length > 100
  ) {
    return res.status(400).json({
      error: "Username must contain 3 to 100 characters"
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

  if (
    typeof full_name !== "string" ||
    full_name.trim().length < 1 ||
    full_name.trim().length > 150
  ) {
    return res.status(400).json({
      error: "Doctor full name is required (maximum 150 characters)"
    });
  }

  // Validate optional text fields.
  const optionalFields = [
    { name: "email", value: email, max: 150 },
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

  const cleanEmail =
    typeof email === "string" && email.trim()
      ? email.trim().toLowerCase()
      : null;

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

    const passwordHash = await bcrypt.hash(password, 10);

    // Create the user account.
    const userResult = await client.query(
      `INSERT INTO users (
         username,
         email,
         password_hash,
         role,
         is_active
       )
       VALUES ($1, $2, $3, 'DOCTOR', TRUE)
       RETURNING user_id, username, email, role, is_active, created_at`,
      [
        username.trim(),
        cleanEmail,
        passwordHash
      ]
    );

    const doctor = userResult.rows[0];

    // Create the associated doctor profile.
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
        full_name.trim(),
        cleanQualification,
        cleanSpecialization,
        cleanRegistrationNumber
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(201).json({
      message: "Doctor account and profile created successfully",
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
        error: "Username, email, or registration number already exists"
      });
    }

    console.error("Doctor creation error:", error.message);

    return res.status(500).json({
      error: "Failed to create doctor account"
    });

  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
