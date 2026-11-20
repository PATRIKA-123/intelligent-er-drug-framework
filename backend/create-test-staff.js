"use strict";
// Round 2 test-only role seeder. NEVER use against production or a shared/remote database.
// Usage (from backend): TEST_STAFF_PASSWORD set in environment; node create-test-staff.js --env .env.rebuild2-test
const path = require("path");
const net = require("node:net");
const args = process.argv.slice(2);
if (args.includes("--force") || args.some(a => a !== "--env" && a.startsWith("--"))) {
  console.error("SAFETY STOP: --force and unknown options are not permitted for test-account seeding");
  process.exit(1);
}
const envIdx = args.indexOf("--env");
if (envIdx < 0 || args.length !== 2 || envIdx !== 0 || !args[1] || args[1].startsWith("--")) {
  console.error("Usage: node create-test-staff.js --env <explicit disposable local test .env file>");
  process.exit(1);
}
const envFile = path.resolve(__dirname, args[1]);
require("dotenv").config({ path: envFile, override: true });

function safeTarget(e) {
  const host = String(e.DB_HOST || "").trim().toLowerCase();
  const database = String(e.DB_NAME || "");
  return !["production", "prod"].includes(String(e.NODE_ENV || "").toLowerCase()) &&
    e.DB_SSL !== "true" && e.DATABASE_URL === undefined &&
    ["localhost", "127.0.0.1", "::1"].includes(host) &&
    (!e.DB_PORT || e.DB_PORT === "5432") &&
    /^intelligent_er_(?:rebuild\d*_test|drug_test|[a-z0-9_]+_test)$/.test(database) &&
    e.PRE_ER_TEST_DATABASE_NAME === database &&
    e.ROUND2_CONFIRM_DISPOSABLE_SEED === database;
}
if (!safeTarget(process.env)) {
  console.error("SAFETY STOP: requires exact confirmed disposable local test database; production/remote refused");
  process.exit(1);
}
const password = process.env.TEST_STAFF_PASSWORD;
if (typeof password !== "string" || password.length < 12 || password.length > 128) {
  console.error("Set TEST_STAFF_PASSWORD (12 to 128 characters) in the environment; do not put it in Git");
  process.exit(1);
}
const bcrypt = require("bcrypt");
const pool = require("./db");
const USERS = [
  { username: "test_paramedic", email: "test_paramedic@example.test", role: "PARAMEDIC", name: "Test Paramedic" },
  { username: "test_er_staff", email: "test_er_staff@example.test", role: "ER_STAFF", name: "Test ER Staff" },
  { username: "test_doctor", email: "test_doctor@example.test", role: "DOCTOR", name: "Test Doctor" },
];
async function main() {
  const client = await pool.connect();
  try {
    const identity = await client.query("SELECT current_database() AS name, inet_server_addr()::text AS address");
    const row = identity.rows[0];
    const actual = String(row.name || "");
    const ip = String(row.address || "").toLowerCase();
    // Local postgres may report either IPv4 loopback, native IPv6 or an IPv4-mapped IPv6 address.
    const serverLocal = ip === "::1" || ip === "0:0:0:0:0:0:0:1" ||
      (net.isIP(ip) === 4 && ip.startsWith("127.")) ||
      ip.startsWith("::ffff:127.") || ip.startsWith("::ffff:7f00:");
    if (actual !== process.env.DB_NAME || !serverLocal) throw Error("SAFETY STOP: connection identity mismatch or non-loopback server");
    const hash = await bcrypt.hash(password, 10);
    await client.query("BEGIN");
    const results = [];
    for (const user of USERS) {
      const existing = await client.query("SELECT user_id, role, is_active FROM users WHERE username = $1 FOR UPDATE", [user.username]);
      if (existing.rows.length) {
        if (existing.rows[0].role !== user.role || existing.rows[0].is_active !== true) throw Error("SAFETY STOP: existing test username does not match expected active role");
        results.push({ username: user.username, role: user.role, result: "already exists" });
        continue;
      }
      const inserted = await client.query(
        "INSERT INTO users (username, email, password_hash, role, is_active) VALUES ($1,$2,$3,$4,TRUE) RETURNING user_id",
        [user.username, user.email, hash, user.role]);
      const id = inserted.rows[0].user_id;
      if (user.role === "DOCTOR") {
        await client.query("INSERT INTO doctor_profiles (user_id, full_name, qualification, specialization) VALUES ($1,$2,'MD','Emergency Medicine')", [id, user.name]);
      } else {
        await client.query("INSERT INTO staff_profiles (user_id, full_name) VALUES ($1,$2)", [id, user.name]);
      }
      results.push({ username: user.username, role: user.role, result: "created" });
    }
    await client.query("COMMIT");
    console.table(results);
    console.log("Seed complete on explicitly confirmed local test database");
  } catch(err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw err;
  } finally { client.release(); }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => pool.end());
