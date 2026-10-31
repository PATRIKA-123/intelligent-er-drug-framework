const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication token required"
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    req.user = decoded;

    next();
  } catch (err) {
    console.error("Authentication error:", err.message);

    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }
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

module.exports = authMiddleware;