
const jwt = require("jsonwebtoken");
const pool = require("../db");

// The DATABASE decides what a user may do right now - not the token.
// A token only proves who the user is. Role and active status are read fresh
// on every request, so a deactivated or demoted account loses access at once.
async function loadCurrentUser(userId) {
  const result = await pool.query(
    `SELECT user_id, username, role, is_active
     FROM users
     WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

const authMiddleware = async (req, res, next) => {
  let decoded;

  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication token required"
      });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        error: "Authentication token required"
      });
    }

    decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );
  } catch (err) {
    console.error("Authentication error:", err.message);

    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }

  // The token must identify a user by a plain positive integer id.
  const userId = Number(decoded.user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !/^\d+$/.test(String(decoded.user_id))) {
    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }

  let current;
  try {
    current = await authMiddleware.lookupUser(userId);
  } catch (err) {
    // If we cannot check the account, we do NOT trust the token's old claims.
    console.error("Account verification error:", err.message);

    return res.status(503).json({
      error: "Unable to verify your account right now. Please try again."
    });
  }

  if (!current) {
    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }

  if (!current.is_active) {
    return res.status(401).json({
      error: "This account is no longer active"
    });
  }

  // Keep the same fields as before, but role/username come from the database.
  req.user = {
    ...decoded,
    user_id: current.user_id,
    username: current.username,
    role: current.role
  };

  next();
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: "Not authenticated"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: "You don't have permission to access this resource"
      });
    }

    next();
  };
};

authMiddleware.requireRole = requireRole;
// Exposed so tests can replace the account lookup.
authMiddleware.lookupUser = loadCurrentUser;

module.exports = authMiddleware;
