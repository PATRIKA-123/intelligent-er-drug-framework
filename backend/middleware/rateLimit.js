"use strict";

// Small in-memory rate limiter (no extra package). Counts requests per client
// address in a time window. State is per server process: fine for one Render
// instance; use a shared store if the API is ever scaled to several instances.
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message } = {}) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({
        error: message || "Too many attempts. Please wait and try again.",
      });
    }
    return next();
  };
}

module.exports = rateLimit;
