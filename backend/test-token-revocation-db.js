// B03 regression test: an old (still valid) token must NOT keep old privileges.
// The user's CURRENT role and is_active in the database decide, not the token.
// Real PostgreSQL in a throw-away schema (acl_auth), dropped at the end.
//
//   set PRE_ER_TEST_ENV_FILE=path\to\your\test.env   (TEST database only)
//   node test-token-revocation-db.js

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-not-real";
const path = require("path");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

require("dotenv").config({
  path: path.resolve(process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env")),
  override: true,
});
const dbConfig = () => ({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

let failed = 0, total = 0;
function check(name, got, expected) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : `   (got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)})`));
}

(async () => {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query("DROP SCHEMA IF EXISTS acl_auth CASCADE");
  await admin.query("CREATE SCHEMA acl_auth");
  await admin.query("SET search_path TO acl_auth");
  await admin.query(`
    CREATE TABLE users (user_id INT PRIMARY KEY, username TEXT, password_hash TEXT,
                        role TEXT, is_active BOOLEAN DEFAULT TRUE, patient_id INT);
    INSERT INTO users (user_id, username, password_hash, role, is_active) VALUES
      (1,'para','x','PARAMEDIC',TRUE), (2,'adm','x','ADMIN',TRUE),
      (3,'doc','x','DOCTOR',TRUE),     (4,'gone','x','PARAMEDIC',TRUE);
  `);

  process.env.PGOPTIONS = "-c search_path=acl_auth";
  const pool = require("./db");
  const probe = await pool.query("SELECT current_schema() AS s");
  if (probe.rows[0].s !== "acl_auth") {
    console.error(`ABORTED: connections are using schema "${probe.rows[0].s}", not acl_auth. ` +
      "No app code was run. Use a direct (non-pooled) connection string for this test.");
    await admin.query("DROP SCHEMA IF EXISTS acl_auth CASCADE");
    await admin.end(); await pool.end();
    process.exit(2);
  }

  const authMiddleware = require("./middleware/authMiddleware");
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", require("./routes/auth"));

  const sign = (claims, opts = { expiresIn: "2h" }) => jwt.sign(claims, process.env.JWT_SECRET, opts);
  const realLog = console.log, realErr = console.error;
  console.error = () => {};

  const server = app.listen(0, async () => {
    const base = `http://localhost:${server.address().port}/api/auth`;
    const call = async (route, token) => {
      const r = await fetch(`${base}${route}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      let body = null; try { body = await r.json(); } catch (_) {}
      return { status: r.status, body };
    };
    const sql = (q, p) => pool.query(q, p);

    try {
      // Tokens issued ONCE, while the users still had these roles/status.
      const paraToken = sign({ user_id: 1, username: "para", role: "PARAMEDIC" });
      const admToken  = sign({ user_id: 2, username: "adm",  role: "ADMIN" });
      const goneToken = sign({ user_id: 4, username: "gone", role: "PARAMEDIC" });

      check("no token -> 401", (await call("/me", null)).status, 401);
      check("garbage token -> 401", (await call("/me", "not.a.token")).status, 401);
      check("expired token -> 401", (await call("/me", sign({ user_id: 1, role: "PARAMEDIC" }, { expiresIn: -10 }))).status, 401);
      check("token without user_id -> 401", (await call("/me", sign({ role: "ADMIN" }))).status, 401);
      check("token with non-numeric user_id -> 401", (await call("/me", sign({ user_id: "1; DROP", role: "ADMIN" }))).status, 401);

      check("active paramedic -> 200", (await call("/paramedic-only", paraToken)).status, 200);
      check("/me returns database role", (await call("/me", paraToken)).body.user.role, "PARAMEDIC");

      // ---- deactivation ----
      await sql("UPDATE users SET is_active = FALSE WHERE user_id = 1");
      check("deactivated user, old token -> 401 on /me", (await call("/me", paraToken)).status, 401);
      check("deactivated user, old token -> 401 on role route", (await call("/paramedic-only", paraToken)).status, 401);
      await sql("UPDATE users SET is_active = TRUE WHERE user_id = 1");
      check("re-activated user works again (live check)", (await call("/paramedic-only", paraToken)).status, 200);

      // ---- demotion ----
      await sql("UPDATE users SET role = 'PATIENT' WHERE user_id = 1");
      check("demoted paramedic loses paramedic route -> 403", (await call("/paramedic-only", paraToken)).status, 403);
      check("/me shows the NEW role, not the token's", (await call("/me", paraToken)).body.user.role, "PATIENT");
      await sql("UPDATE users SET role = 'DOCTOR' WHERE user_id = 2");
      check("demoted admin loses admin-only access -> 403", (await call("/er-staff-only", admToken)).status, 403);
      await sql("UPDATE users SET role = 'ADMIN' WHERE user_id = 2");
      check("unchanged/restored admin -> 200", (await call("/er-staff-only", admToken)).status, 200);

      // ---- deleted user ----
      await sql("DELETE FROM users WHERE user_id = 4");
      check("deleted user, old token -> 401", (await call("/me", goneToken)).status, 401);

      // ---- database failure: deny, never trust the token ----
      const original = authMiddleware.lookupUser;
      authMiddleware.lookupUser = async () => { throw new Error("database unavailable"); };
      const down = await call("/er-staff-only", admToken);
      authMiddleware.lookupUser = original;
      check("account lookup fails -> 503 (access denied)", down.status, 503);
      check("failure response leaks no internal detail", JSON.stringify(down.body).includes("database unavailable"), false);
      check("works again after lookup recovers", (await call("/er-staff-only", admToken)).status, 200);
    } catch (err) {
      failed++; realErr("TEST ERROR:", err.message);
    } finally {
      console.error = realErr;
      server.close();
      try { await pool.query("DROP SCHEMA IF EXISTS acl_auth CASCADE"); } catch (_) {}
      try { await admin.query("DROP SCHEMA IF EXISTS acl_auth CASCADE"); } catch (_) {}
      await admin.end(); await pool.end();
      realLog(`\n${failed} FAILED / ${total} CHECKS`);
      process.exit(failed ? 1 : 0);
    }
  });
})();
