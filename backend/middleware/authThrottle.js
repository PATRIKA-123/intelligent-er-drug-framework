"use strict";

// B15: In-process second layer for login, scoped to both client IP and an
// HMAC of the normalized login identifier. The existing IP-only limiter is
// retained separately. This DOES NOT replace a shared/edge limiter on a
// horizontally scaled deployment; see docs/B15_B18_BATCH_GUIDE.md.
const { createHmac, randomBytes } = require("node:crypto");

function createAuthThrottle({ windowMs = 15 * 60 * 1000, max = 10, now = Date.now,
  secret = randomBytes(32), maxEntries = 10000 } = {}) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1 ||
      !Number.isSafeInteger(max) || max < 1) throw new TypeError("Invalid auth throttle limits");
  const hits = new Map();
  const digest = (value) => createHmac("sha256", secret).update(value).digest("hex");

  return function authThrottle(req, res, next) {
    const username = typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase().slice(0, 256) : "";
    // IP-only rate limiter must always run before this middleware.
    // Empty usernames are handled by the IP limiter + input validation.
    if (!username) return next();
    const ip = typeof req.ip === "string" && req.ip ? req.ip : "unknown";
    const key = digest(`${ip}\u0000${username}`);
    const time = now();
    let entry = hits.get(key);
    if (entry && entry.resetAt <= time) { hits.delete(key); entry = null; }
    if (!entry) {
      if (hits.size >= maxEntries) {
        // Bound memory rather than let arbitrary usernames exhaust it.
        for (const [k, v] of hits) if (v.resetAt <= time) hits.delete(k);
        if (hits.size >= maxEntries) {
          res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
          return res.status(429).json({ error: "Too many attempts. Please try again later." });
        }
      }
      entry = { count: 0, resetAt: time + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - time) / 1000))));
      return res.status(429).json({ error: "Too many attempts. Please try again later." });
    }
    return next();
  };
}

module.exports = { createAuthThrottle };
