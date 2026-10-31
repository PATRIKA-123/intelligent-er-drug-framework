const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Register a new user
router.post("/register", async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({
        error: "Username, password and role are required"
      });
    }

    const allowedRoles = ["PARAMEDIC", "ER_STAFF", "PATIENT", "ADMIN"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        error: "Invalid role"
      });
    }

    const existingUser = await pool.query(
      `SELECT user_id
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: "Username already exists"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
        (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, username, email, role, is_active, created_at`,
      [username, email || null, passwordHash, role]
    );

    res.status(201).json({
      message: "User registered successfully",
      user: result.rows[0]
    });

  } catch (err) {
    console.error("Registration error:", err.message);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// Log in an existing user
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: "Username and password are required"
      });
    }

    const result = await pool.query(
      `SELECT user_id, username, password_hash, role, is_active
       FROM users
       WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Invalid username or password"
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        error: "This account has been deactivated"
      });
    }

    const token = jwt.sign(
      {
        user_id: user.user_id,
        username: user.username,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role
      }
    });

  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Failed to log in" });
  }
});

router.get("/me", authMiddleware, (req, res) => {
  res.status(200).json({
    user: req.user
  });
});

// Role authorization test routes

router.get(
  "/paramedic-only",
  authMiddleware,
  authMiddleware.requireRole("PARAMEDIC", "ADMIN"),
  (req, res) => {
    res.status(200).json({
      message: "Role access verified",
      user: req.user
    });
  }
);

router.get(
  "/er-staff-only",
  authMiddleware,
  authMiddleware.requireRole("ER_STAFF", "ADMIN"),
  (req, res) => {
    res.status(200).json({
      message: "Role access verified",
      user: req.user
    });
  }
);

router.get(
  "/patient-only",
  authMiddleware,
  authMiddleware.requireRole("PATIENT"),
  (req, res) => {
    res.status(200).json({
      message: "Role access verified",
      user: req.user
    });
  }
);

router.get(
  "/admin-only",
  authMiddleware,
  authMiddleware.requireRole("ADMIN"),
  (req, res) => {
    res.status(200).json({
      message: "Role access verified",
      user: req.user
    });
  }
);



module.exports = router;