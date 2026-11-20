"use strict";
// T1 to T3: invitations for doctors, paramedics and ER staff; doctor list;
// resend and delete. No database and no email: the pool, the sign-in check
// and the mailer are replaced with stand-ins, and real HTTP requests are made
// to the real routers. Run: node test-staff-invitations.js
const assert = require("assert");
const http = require("http");
const path = require("path");
const Module = require("module");
const express = require("express");

process.env.FRONTEND_URL = "http://localhost:5173";

// ---- stand-ins -------------------------------------------------------------
const db = { rules: [], log: [] };
function run(sql, params) {
  const text = sql.replace(/\s+/g, " ").trim();
  db.log.push({ text, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(text)) return { rows: [], rowCount: 0 };
  for (const rule of db.rules) {
    if (rule.match.test(text)) {
      if (rule.throws) throw Object.assign(new Error("db error"), rule.throws);
      return { rows: rule.rows || [], rowCount: (rule.rows || []).length };
    }
  }
  return { rows: [], rowCount: 0 };
}
const fakeClient = { query: async (s, p) => run(s, p), release() {} };
const fakePool = { query: async (s, p) => run(s, p), connect: async () => fakeClient };

const mail = { sent: [], fail: false };
const fakeMailer = {
  sendEmail: async (m) => {
    if (mail.fail) throw new Error("smtp down");
    mail.sent.push(m);
  },
};

function fakeAuth(req, res, next) {
  const role = req.headers["x-role"];
  if (!role) return res.status(401).json({ error: "No token" });
  req.user = { user_id: 1, role };
  next();
}
fakeAuth.requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: "Forbidden" });

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  const from = parent && parent.filename ? path.basename(parent.filename) : "";
  if (/^(doctors|staff)\.js$/.test(from)) {
    if (request === "../db") return fakePool;
    if (request === "../middleware/authMiddleware") return fakeAuth;
    if (request === "../utils/mailer") return fakeMailer;
  }
  return origLoad.call(this, request, parent, ...rest);
};
const doctorsRouter = require("./routes/doctors");
const staffRouter = require("./routes/staff");
Module._load = origLoad;

const app = express();
app.use(express.json());
app.use("/api/doctors", doctorsRouter);
app.use("/api/staff", staffRouter);

let base;
async function call(method, url, { role, body } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...(role ? { "x-role": role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json };
}
function reset(rules = []) { db.rules = rules; db.log = []; mail.sent = []; mail.fail = false; }
const logged = (re) => db.log.filter((q) => re.test(q.text));

let n = 0;
async function test(name, fn) { await fn(); n++; console.log("PASS  " + name); }

const ADMIN_OK = { match: /FROM users WHERE user_id = \$1 AND role = 'ADMIN'/i, rows: [{ user_id: 1 }] };
const NEW_USER = (role) => ({ match: /INSERT INTO users/i, rows: [{ user_id: 42, username: "x", email: "a@b.co", role, is_active: false }] });
const NEW_INVITATION = { match: /INSERT INTO doctor_invitations/i, rows: [{ invitation_id: 7 }] };
const good = { username: "para_one", email: "Para@Example.com", full_name: "Asha Rao", role: "PARAMEDIC" };

(async () => {
  const server = http.createServer(app).listen(0);
  base = "http://127.0.0.1:" + server.address().port;

  // ======================= T1: POST /api/staff =======================
  await test("staff create: no sign-in gets 401", async () => {
    reset();
    assert.strictEqual((await call("POST", "/api/staff", { body: good })).status, 401);
  });
  for (const role of ["ER_STAFF", "DOCTOR", "PARAMEDIC", "PATIENT"]) {
    await test(`staff create: ${role} gets 403`, async () => {
      reset();
      assert.strictEqual((await call("POST", "/api/staff", { role, body: good })).status, 403);
      assert.strictEqual(logged(/INSERT/i).length, 0);
    });
  }
  for (const bad of ["ADMIN", "DOCTOR", "PATIENT", "", undefined, "paramedic"]) {
    await test(`staff create: role ${JSON.stringify(bad)} is rejected with 400`, async () => {
      reset();
      const r = await call("POST", "/api/staff", { role: "ADMIN", body: { ...good, role: bad } });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(logged(/INSERT/i).length, 0);
    });
  }
  await test("staff create: bad username, email or name get 400", async () => {
    reset();
    for (const patch of [{ username: "ab" }, { email: "not-an-email" }, { email: undefined }, { full_name: "  " }, { full_name: "x".repeat(151) }]) {
      const r = await call("POST", "/api/staff", { role: "ADMIN", body: { ...good, ...patch } });
      assert.strictEqual(r.status, 400, JSON.stringify(patch));
    }
  });
  await test("staff create: FRONTEND_URL missing gives 500 and creates nothing", async () => {
    reset();
    const saved = process.env.FRONTEND_URL; delete process.env.FRONTEND_URL;
    const r = await call("POST", "/api/staff", { role: "ADMIN", body: good });
    process.env.FRONTEND_URL = saved;
    assert.strictEqual(r.status, 500);
    assert.strictEqual(logged(/INSERT/i).length, 0);
  });
  await test("staff create: admin creates an inactive paramedic, name stored, email sent with a one-time link", async () => {
    reset([ADMIN_OK, NEW_USER("PARAMEDIC"), NEW_INVITATION]);
    const r = await call("POST", "/api/staff", { role: "ADMIN", body: good });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.user.full_name, "Asha Rao");
    const insert = logged(/INSERT INTO users/i)[0];
    assert.ok(/FALSE\)/.test(insert.text), "account starts inactive");
    assert.deepStrictEqual([insert.params[0], insert.params[1], insert.params[3]], ["para_one", "para@example.com", "PARAMEDIC"]);
    assert.ok(insert.params[2].startsWith("$2"), "random unusable password is stored as a bcrypt hash");
    assert.strictEqual(logged(/INSERT INTO staff_profiles/i)[0].params[1], "Asha Rao");
    assert.strictEqual(mail.sent.length, 1);
    assert.strictEqual(mail.sent[0].to, "para@example.com");
    assert.ok(/Parvah/.test(mail.sent[0].subject) && /Parvah/.test(mail.sent[0].html));
    assert.ok(!/ER-Drug/i.test(mail.sent[0].html), "old product name is gone");
    const link = /href="([^"]+)"/.exec(mail.sent[0].html)[1];
    const url = new URL(link);
    assert.strictEqual(url.origin + url.pathname, "http://localhost:5173/accept-invitation");
    assert.ok(/^[a-f0-9]{64}$/.test(url.searchParams.get("token")), "64 hex character token");
    const stored = logged(/INSERT INTO doctor_invitations/i)[0].params[1];
    assert.ok(/^[a-f0-9]{64}$/.test(stored) && stored !== url.searchParams.get("token"), "only the hash is stored");
    assert.ok(/24 hours/.test(logged(/INSERT INTO doctor_invitations/i)[0].text));
  });
  await test("staff create: ER_STAFF role works the same way", async () => {
    reset([ADMIN_OK, NEW_USER("ER_STAFF"), NEW_INVITATION]);
    const r = await call("POST", "/api/staff", { role: "ADMIN", body: { ...good, role: "ER_STAFF" } });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(logged(/INSERT INTO users/i)[0].params[3], "ER_STAFF");
  });
  await test("staff create: duplicate username or email gets 409 and the transaction is rolled back", async () => {
    reset([ADMIN_OK, { match: /INSERT INTO users/i, throws: { code: "23505" } }]);
    const r = await call("POST", "/api/staff", { role: "ADMIN", body: good });
    assert.strictEqual(r.status, 409);
    assert.ok(logged(/^ROLLBACK/i).length === 1);
    assert.strictEqual(mail.sent.length, 0);
  });
  await test("staff create: if the email cannot be sent the invitation is revoked and the admin is told (502)", async () => {
    reset([ADMIN_OK, NEW_USER("PARAMEDIC"), NEW_INVITATION]);
    mail.fail = true;
    const r = await call("POST", "/api/staff", { role: "ADMIN", body: good });
    assert.strictEqual(r.status, 502);
    assert.strictEqual(r.body.user_id, 42);
    const revoke = logged(/UPDATE doctor_invitations SET revoked_at = NOW\(\) WHERE invitation_id/i);
    assert.strictEqual(revoke.length, 1);
    assert.deepStrictEqual(revoke[0].params, [7]);
  });
  await test("staff create: an admin who is no longer active gets 403", async () => {
    reset([]);
    const r = await call("POST", "/api/staff", { role: "ADMIN", body: good });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(logged(/INSERT INTO users/i).length, 0);
  });

  // ======================= T1: staff list, resend, delete =======================
  await test("staff list: admin only", async () => {
    reset([{ match: /FROM users u LEFT JOIN staff_profiles/i, rows: [{ user_id: 5, role: "PARAMEDIC", status: "PENDING" }] }]);
    assert.strictEqual((await call("GET", "/api/staff", { role: "ER_STAFF" })).status, 403);
    const r = await call("GET", "/api/staff", { role: "ADMIN" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.staff[0].status, "PENDING");
    assert.ok(/role IN \('PARAMEDIC', 'ER_STAFF'\)/.test(logged(/FROM users u/i)[0].text), "doctors, patients and admins are not listed");
  });
  await test("staff resend: sends a new invitation and revokes the old one", async () => {
    reset([{ match: /FROM users u LEFT JOIN staff_profiles/i, rows: [{ user_id: 5, email: "old@x.co", role: "ER_STAFF", is_active: false, full_name: "Ravi" }] }, NEW_INVITATION]);
    const r = await call("POST", "/api/staff/5/resend-invitation", { role: "ADMIN", body: { email: "New@X.co" } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(logged(/UPDATE users SET email/i)[0].params, ["new@x.co", 5]);
    assert.ok(logged(/SET revoked_at = NOW\(\) WHERE user_id = \$1/i).length === 1);
    assert.strictEqual(mail.sent[0].to, "new@x.co");
  });
  await test("staff resend: active account gets 409, unknown id 404, bad id 400, bad email 400, non-admin 403", async () => {
    reset([{ match: /FROM users u LEFT JOIN staff_profiles/i, rows: [{ user_id: 5, email: "a@x.co", role: "ER_STAFF", is_active: true }] }]);
    assert.strictEqual((await call("POST", "/api/staff/5/resend-invitation", { role: "ADMIN", body: {} })).status, 409);
    reset();
    assert.strictEqual((await call("POST", "/api/staff/5/resend-invitation", { role: "ADMIN", body: {} })).status, 404);
    assert.strictEqual((await call("POST", "/api/staff/abc/resend-invitation", { role: "ADMIN", body: {} })).status, 400);
    assert.strictEqual((await call("POST", "/api/staff/5/resend-invitation", { role: "ADMIN", body: { email: "nope" } })).status, 400);
    assert.strictEqual((await call("POST", "/api/staff/5/resend-invitation", { role: "ER_STAFF", body: {} })).status, 403);
  });
  await test("staff delete: only an account that never accepted can be removed", async () => {
    reset([{ match: /SELECT user_id, is_active FROM users/i, rows: [{ user_id: 5, is_active: true }] }]);
    assert.strictEqual((await call("DELETE", "/api/staff/5", { role: "ADMIN" })).status, 409);
    assert.strictEqual(logged(/DELETE/i).length, 0);

    reset([{ match: /SELECT user_id, is_active FROM users/i, rows: [{ user_id: 5, is_active: false }] }, { match: /accepted_at IS NOT NULL/i, rows: [{ "?column?": 1 }] }]);
    assert.strictEqual((await call("DELETE", "/api/staff/5", { role: "ADMIN" })).status, 409);
    assert.strictEqual(logged(/DELETE/i).length, 0);

    reset([{ match: /SELECT user_id, is_active FROM users/i, rows: [{ user_id: 5, is_active: false }] }]);
    const r = await call("DELETE", "/api/staff/5", { role: "ADMIN" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(logged(/^DELETE/i).map((q) => q.text.split(" ")[2]), ["doctor_invitations", "staff_profiles", "users"]);
    assert.strictEqual((await call("DELETE", "/api/staff/5", { role: "PATIENT" })).status, 403);
  });

  // ======================= public routes: validate and accept =======================
  const token = "a".repeat(64);
  await test("validate-invitation: works for a paramedic and returns role and name", async () => {
    reset([{ match: /FROM doctor_invitations di/i, rows: [{ full_name: "Asha Rao", role: "PARAMEDIC", expires_at: "2026-11-21" }] }]);
    const r = await call("POST", "/api/doctors/validate-invitation", { body: { token } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.valid, r.body.role, r.body.full_name, r.body.doctor_name], [true, "PARAMEDIC", "Asha Rao", "Asha Rao"]);
    const sql = logged(/FROM doctor_invitations di/i)[0].text;
    assert.ok(/u\.role IN \('DOCTOR', 'PARAMEDIC', 'ER_STAFF'\)/.test(sql));
    assert.ok(/LEFT JOIN doctor_profiles/.test(sql) && /LEFT JOIN staff_profiles/.test(sql));
    assert.ok(!/ADMIN|PATIENT/.test(sql.split("u.role IN")[1].split(")")[0]), "admin and patient accounts can never be activated by invitation");
  });
  await test("validate-invitation: unknown, malformed token is rejected", async () => {
    reset();
    assert.strictEqual((await call("POST", "/api/doctors/validate-invitation", { body: { token } })).status, 400);
    assert.strictEqual((await call("POST", "/api/doctors/validate-invitation", { body: { token: "short" } })).status, 400);
  });
  await test("accept-invitation: activates a paramedic, keeps the old response key", async () => {
    reset([
      { match: /SELECT invitation_id, user_id FROM doctor_invitations/i, rows: [{ invitation_id: 7, user_id: 42 }] },
      { match: /UPDATE users SET password_hash/i, rows: [{ user_id: 42, username: "para_one", email: "a@b.co", role: "PARAMEDIC", is_active: true }] },
    ]);
    const r = await call("POST", "/api/doctors/accept-invitation", { body: { token, password: "a-long-enough-pass" } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.user.role, "PARAMEDIC");
    assert.strictEqual(r.body.doctor.role, "PARAMEDIC");
    assert.ok(/role IN \('DOCTOR', 'PARAMEDIC', 'ER_STAFF'\)/.test(logged(/UPDATE users SET password_hash/i)[0].text));
    assert.strictEqual(logged(/SET accepted_at = NOW\(\)/i).length, 1);
    assert.strictEqual(logged(/^COMMIT/i).length, 1);
  });
  await test("accept-invitation: reused, expired or unknown token gets 400; short password gets 400", async () => {
    reset();
    assert.strictEqual((await call("POST", "/api/doctors/accept-invitation", { body: { token, password: "a-long-enough-pass" } })).status, 400);
    assert.strictEqual((await call("POST", "/api/doctors/accept-invitation", { body: { token, password: "short" } })).status, 400);
    assert.ok(/AND expires_at > NOW\(\)/.test(logged(/SELECT invitation_id/i)[0].text));
    assert.ok(/accepted_at IS NULL/.test(logged(/SELECT invitation_id/i)[0].text));
  });

  // ======================= T3: doctors list, resend, delete =======================
  const doctorRows = [
    { user_id: 3, username: "dr_a", email: "a@h.org", full_name: "Dr A", qualification: "MD", specialization: "EM", status: "ACTIVE" },
  ];
  await test("doctors list: ER staff sees only active doctors, without email addresses", async () => {
    reset([{ match: /FROM users u JOIN doctor_profiles dp/i, rows: doctorRows }]);
    const r = await call("GET", "/api/doctors", { role: "ER_STAFF" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(Object.keys(r.body.doctors[0]).sort(), ["full_name", "qualification", "specialization", "status", "user_id", "username"]);
    assert.strictEqual(logged(/FROM users u JOIN doctor_profiles/i)[0].params[0], false, "active-only filter on");
  });
  await test("doctors list: admin sees every doctor with status and email", async () => {
    reset([{ match: /FROM users u JOIN doctor_profiles dp/i, rows: doctorRows }]);
    const r = await call("GET", "/api/doctors", { role: "ADMIN" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.doctors[0].email, "a@h.org");
    assert.strictEqual(logged(/FROM users u JOIN doctor_profiles/i)[0].params[0], true);
    const sql = logged(/FROM users u JOIN doctor_profiles/i)[0].text;
    assert.ok(/'PENDING'/.test(sql) && /'EXPIRED'/.test(sql) && /'ACTIVE'/.test(sql));
  });
  for (const role of ["PATIENT", "PARAMEDIC", "DOCTOR"]) {
    await test(`doctors list: ${role} gets 403`, async () => {
      reset();
      assert.strictEqual((await call("GET", "/api/doctors", { role })).status, 403);
      assert.strictEqual(logged(/SELECT/i).length, 0);
    });
  }
  await test("doctors: ER staff cannot create, resend or delete (403)", async () => {
    reset();
    assert.strictEqual((await call("POST", "/api/doctors", { role: "ER_STAFF", body: {} })).status, 403);
    assert.strictEqual((await call("POST", "/api/doctors/3/resend-invitation", { role: "ER_STAFF", body: {} })).status, 403);
    assert.strictEqual((await call("DELETE", "/api/doctors/3", { role: "ER_STAFF" })).status, 403);
  });
  await test("doctor resend: after a failed email, a new invitation works and the old token is revoked", async () => {
    reset([ADMIN_OK, { match: /FROM users u JOIN doctor_profiles dp/i, rows: [{ user_id: 3, email: "typo@h.org", is_active: false, full_name: "Dr A" }] }, NEW_INVITATION]);
    const r = await call("POST", "/api/doctors/3/resend-invitation", { role: "ADMIN", body: { email: "fixed@h.org" } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(mail.sent[0].to, "fixed@h.org");
    assert.ok(/Hello Dr\. Dr A/.test(mail.sent[0].html));
    const revokeIndex = db.log.findIndex((q) => /SET revoked_at = NOW\(\) WHERE user_id = \$1/i.test(q.text));
    const createIndex = db.log.findIndex((q) => /INSERT INTO doctor_invitations/i.test(q.text));
    assert.ok(revokeIndex >= 0 && createIndex > revokeIndex, "old invitations revoked before the new one is created");
  });
  await test("doctor resend: active doctor 409, unknown 404, bad email 400, email failure 502", async () => {
    reset([ADMIN_OK, { match: /FROM users u JOIN doctor_profiles dp/i, rows: [{ user_id: 3, email: "a@h.org", is_active: true, full_name: "Dr A" }] }]);
    assert.strictEqual((await call("POST", "/api/doctors/3/resend-invitation", { role: "ADMIN", body: {} })).status, 409);
    reset([ADMIN_OK]);
    assert.strictEqual((await call("POST", "/api/doctors/3/resend-invitation", { role: "ADMIN", body: {} })).status, 404);
    assert.strictEqual((await call("POST", "/api/doctors/3/resend-invitation", { role: "ADMIN", body: { email: "x" } })).status, 400);
    reset([ADMIN_OK, { match: /FROM users u JOIN doctor_profiles dp/i, rows: [{ user_id: 3, email: "a@h.org", is_active: false, full_name: "Dr A" }] }, NEW_INVITATION]);
    mail.fail = true;
    assert.strictEqual((await call("POST", "/api/doctors/3/resend-invitation", { role: "ADMIN", body: {} })).status, 502);
  });
  await test("doctor delete: only a never-accepted doctor; removes invitation, profile and user", async () => {
    reset([ADMIN_OK, { match: /SELECT user_id, is_active FROM users/i, rows: [{ user_id: 3, is_active: true }] }]);
    assert.strictEqual((await call("DELETE", "/api/doctors/3", { role: "ADMIN" })).status, 409);
    reset([ADMIN_OK]);
    assert.strictEqual((await call("DELETE", "/api/doctors/3", { role: "ADMIN" })).status, 404);
    reset([ADMIN_OK, { match: /SELECT user_id, is_active FROM users/i, rows: [{ user_id: 3, is_active: false }] }]);
    const r = await call("DELETE", "/api/doctors/3", { role: "ADMIN" });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(logged(/^DELETE/i).map((q) => q.text.split(" ")[2]), ["doctor_invitations", "doctor_profiles", "users"]);
  });
  await test("doctor create: invitation email now says Parvah", async () => {
    reset([ADMIN_OK, NEW_USER("DOCTOR"), NEW_INVITATION]);
    const r = await call("POST", "/api/doctors", { role: "ADMIN", body: { username: "dr_new", email: "d@h.org", full_name: "Meera N" } });
    assert.strictEqual(r.status, 201);
    assert.ok(/Parvah/.test(mail.sent[0].subject) && !/ER-Drug/i.test(mail.sent[0].html));
    assert.ok(/Hello Dr\. Meera N/.test(mail.sent[0].html));
  });

  console.log(`Staff and doctor invitation tests passed (${n})`);
  server.close();
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
