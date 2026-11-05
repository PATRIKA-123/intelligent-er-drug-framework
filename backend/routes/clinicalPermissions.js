const express = require("express");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const PERMISSION_CODE = "NEWS2_SPO2_SCALE_2";

// Verify the administrator against the current database state.
// Do not rely only on the role stored in an older JWT.
const requireActiveAdmin = async (req, res, next) => {
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
  } catch (err) {
    console.error("Admin verification error:", err.message);

    return res.status(500).json({
      error: "Failed to verify administrator"
    });
  }
};

const validateUserId = (value) => {
  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const requireReason = (value) => {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 500
  );
};

// Every endpoint in this router requires an authenticated,
// currently active ADMIN account.
router.use(authMiddleware);
router.use(authMiddleware.requireRole("ADMIN"));
router.use(requireActiveAdmin);

// View current permission and previous grant/revocation records.
router.get("/users/:userId", async (req, res) => {
  try {
    const userId = validateUserId(req.params.userId);

    if (!userId) {
      return res.status(400).json({
        error: "Invalid user ID"
      });
    }

    const result = await pool.query(
      `SELECT
         permission_id,
         user_id,
         permission_code,
         granted_by,
         granted_at,
         grant_reason,
         revoked_by,
         revoked_at,
         revocation_reason,
         (revoked_at IS NULL) AS is_active
       FROM user_clinical_permissions
       WHERE user_id = $1
       ORDER BY granted_at DESC`,
      [userId]
    );

    return res.status(200).json({
      user_id: userId,
      permissions: result.rows
    });
  } catch (err) {
    console.error("Permission lookup error:", err.message);

    return res.status(500).json({
      error: "Failed to retrieve clinical permissions"
    });
  }
});

// Grant NEWS2 Scale 2 permission.
router.post("/users/:userId/grant", async (req, res) => {
  try {
    const userId = validateUserId(req.params.userId);
    const { reason } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "Invalid user ID"
      });
    }

    if (!requireReason(reason)) {
      return res.status(400).json({
        error: "A grant reason between 1 and 500 characters is required"
      });
    }

    const targetUser = await pool.query(
      `SELECT user_id
       FROM users
       WHERE user_id = $1
         AND is_active = TRUE`,
      [userId]
    );

    if (targetUser.rows.length === 0) {
      return res.status(404).json({
        error: "Active target user not found"
      });
    }

    const result = await pool.query(
      `INSERT INTO user_clinical_permissions
        (user_id, permission_code, granted_by, grant_reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        userId,
        PERMISSION_CODE,
        req.user.user_id,
        reason.trim()
      ]
    );

    return res.status(201).json({
      message: "NEWS2 Scale 2 permission granted",
      permission: result.rows[0]
    });

  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        error: "User already has an active Scale 2 permission"
      });
    }

    console.error("Permission grant error:", err.message);

    return res.status(500).json({
      error: "Failed to grant clinical permission"
    });
  }
});

// Revoke the currently active NEWS2 Scale 2 permission.
router.post("/users/:userId/revoke", async (req, res) => {
  try {
    const userId = validateUserId(req.params.userId);
    const { reason } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: "Invalid user ID"
      });
    }

    if (!requireReason(reason)) {
      return res.status(400).json({
        error: "A revocation reason between 1 and 500 characters is required"
      });
    }

    const result = await pool.query(
      `UPDATE user_clinical_permissions
       SET revoked_by = $1,
           revoked_at = NOW(),
           revocation_reason = $2
       WHERE user_id = $3
         AND permission_code = $4
         AND revoked_at IS NULL
       RETURNING *`,
      [
        req.user.user_id,
        reason.trim(),
        userId,
        PERMISSION_CODE
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "No active Scale 2 permission found for this user"
      });
    }

    return res.status(200).json({
      message: "NEWS2 Scale 2 permission revoked",
      permission: result.rows[0]
    });

  } catch (err) {
    console.error("Permission revocation error:", err.message);

    return res.status(500).json({
      error: "Failed to revoke clinical permission"
    });
  }
});

module.exports = router;
