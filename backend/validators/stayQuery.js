"use strict";

// Public GET /api/stays query contract. No coercive parseInt, NaN or offset overflow.
const MAX_OFFSET = 1000000;
function parseStayQuery(query = {}) {
  const allowed = new Set(["limit", "offset", "search"]);
  if (Object.keys(query).some((k) => !allowed.has(k))) {
    return { error: "Unsupported query parameter", code: "INVALID_QUERY" };
  }
  const integer = (value, defaultValue, min, max) => {
    if (value === undefined) return defaultValue;
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
  };
  const limit = integer(query.limit, 20, 1, 100);
  const offset = integer(query.offset, 0, 0, MAX_OFFSET);
  if (limit === null || offset === null) {
    return { error: "limit must be 1–100 and offset must be 0–1000000 (whole numbers)", code: "INVALID_PAGINATION" };
  }
  let search = null;
  if (query.search !== undefined) {
    if (typeof query.search !== "string" || query.search.trim().length < 1 || query.search.trim().length > 100 || query.search.includes("\0")) {
      return { error: "search must be 1–100 characters", code: "INVALID_SEARCH" };
    }
    search = query.search.trim();
  }
  return { limit, offset, search };
}

module.exports = { parseStayQuery, MAX_OFFSET };
