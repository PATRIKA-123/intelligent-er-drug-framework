"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { parseStayQuery } = require("./validators/stayQuery");
const { addErrorCode, apiErrorContract, apiErrorHandler } = require("./middleware/apiErrorContract");

const q = (x) => parseStayQuery(x);
test("B20 accepts defaults and legal boundary pages", () => {
  assert.deepEqual(q({}), { limit: 20, offset: 0, search: null });
  assert.deepEqual(q({ limit: "100", offset: "1000000" }), { limit: 100, offset: 1000000, search: null });
  assert.deepEqual(q({ limit: "1", offset: "0", search: " flu " }), { limit: 1, offset: 0, search: "flu" });
});
test("B19/B20 strict validation rejects malformed, unknown or ambiguous query params", () => {
  for (const bad of [{ limit: "0" }, { limit: "101" }, { limit: "12x" }, { limit: "1.5" },
    { limit: "-1" }, { limit: "1e3" }, { limit: ["1", "2"] }, { offset: "-1" },
    { offset: "1000001" }, { offset: "Infinity" }, { offset: "01" }, { unknown: "1" },
    { search: "" }, { search: "z".repeat(101) }, { search: ["x", "y"] },
  ]) assert.equal(typeof q(bad).error, "string", JSON.stringify(bad));
});
test("B19 codes preserve existing legacy message and successful responses", () => {
  assert.deepEqual(addErrorCode(400, { error: "bad id" }), { error: "bad id", code: "INVALID_REQUEST" });
  assert.deepEqual(addErrorCode(403, { error: "Denied" }), { error: "Denied", code: "FORBIDDEN" });
  assert.deepEqual(addErrorCode(422, { error: "mapping", reason_code: "AMBIGUOUS_MEDICATION_MAPPING" }),
    { error: "mapping", reason_code: "AMBIGUOUS_MEDICATION_MAPPING", code: "UNPROCESSABLE_ENTITY" });
  assert.deepEqual(addErrorCode(200, { error: "domain field" }), { error: "domain field" });
});
test("B19 response middleware adds code and JSON parse errors have stable contract", () => {
  const res = { statusCode: 403, json(v) { this.payload = v; return this; },
    status(n) { this.statusCode = n; return this; } };
  apiErrorContract({}, res, () => {});
  res.json({ error: "Blocked" });
  assert.equal(res.payload.code, "FORBIDDEN");
  apiErrorHandler({ type: "entity.parse.failed", status: 400 }, {}, res, () => {});
  assert.deepEqual(res.payload, { error: "Malformed JSON request body", code: "INVALID_JSON" });
});

// Load the real route with only its external dependencies mocked. No DB/server.
const routeFile = path.join(__dirname, "routes/stays.js");
async function routeCase(options = {}) {
  const routes = new Map();
  const calls = [];
  const fakeRouter = { get(p, ...handlers) { routes.set(p, handlers.at(-1)); } };
  const pool = { async query(sql, args) {
    calls.push({ sql, args });
    if (sql.includes("COUNT(*)")) return { rows: [{ total: options.total ?? 4 }] };
    return { rows: options.rows || [
      { stay_id: "1", intime: "2020-01-01" }, { stay_id: "2", intime: "2020-01-01" },
    ], rowCount: 2 };
  } };
  const replacements = new Map([
    ["express", { Router: () => fakeRouter }],
    ["../db", pool],
    ["../validators/idValidator", { isValidStayId: () => true }],
    ["../middleware/authMiddleware", () => {}],
    ["../services/inputProvenance", { assumedInputsSql: async () => ({ columns: "", basedOn: "" }) }],
    ["../services/accessPolicy", {
      requireStayAccess: () => (_r, _s, n) => n(),
      stayListFilter: async () => ({ clause: "s.subject_id = $1", params: [123] }),
    }],
  ]);
  const load = Module._load;
  try {
    Module._load = function(request, parent, isMain) {
      if (parent?.filename === routeFile && replacements.has(request)) return replacements.get(request);
      return load.call(this, request, parent, isMain);
    };
    delete require.cache[require.resolve(routeFile)];
    require(routeFile);
  } finally { Module._load = load; delete require.cache[require.resolve(routeFile)]; }
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } };
  await routes.get("/")({ query: options.query || {}, user: { user_id: 9, role: "PATIENT" } }, res);
  return { res, calls };
}
test("B20 rejects invalid paging before any database calls", async () => {
  const x = await routeCase({ query: { limit: "10cats" } });
  assert.equal(x.res.statusCode, 400);
  assert.equal(x.res.body.code, "INVALID_PAGINATION");
  assert.equal(x.calls.length, 0);
});
test("B20 list and total queries both carry scoped predicate; stable tie-break", async () => {
  const x = await routeCase({ query: { limit: "2", offset: "1" }, total: 4 });
  assert.equal(x.res.statusCode, 200);
  assert.deepEqual(x.res.body, { limit: 2, offset: 1, count: 2, total: 4, has_more: true,
    stays: [{ stay_id: "1", intime: "2020-01-01" }, { stay_id: "2", intime: "2020-01-01" }] });
  assert.equal(x.calls.length, 2);
  for (const call of x.calls) assert.match(call.sql, /s\.subject_id = \$1/);
  assert.match(x.calls[1].sql, /ORDER BY s\.intime ASC NULLS LAST, s\.stay_id ASC/);
  assert.deepEqual(x.calls[1].args, [123, 2, 1]);
});
test("B20 search is parameterized in both queries; no SQL interpolation", async () => {
  const search = "%' OR 1=1 --";
  const x = await routeCase({ query: { search }, total: 0, rows: [] });
  assert.equal(x.res.statusCode, 200);
  assert.deepEqual(x.res.body.stays, []);
  assert.equal(x.res.body.has_more, false);
  assert.equal(x.calls.length, 2);
  for (const call of x.calls) {
    assert.ok(!call.sql.includes(search));
    assert.match(call.sql, /ILIKE \$2/);
    assert.equal(call.args[0], 123);
    assert.equal(call.args[2], search);
    assert.equal(call.args[1], "%\\%\' OR 1=1 --%");
  }
});
