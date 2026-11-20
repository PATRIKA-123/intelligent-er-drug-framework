"use strict";

// Creates one ACTIVE test account for each of PARAMEDIC, ER_STAFF and DOCTOR,
// so every role can be tried in the frontend.
//
//   node create-test-staff.js [--env <file>] [--force]
//
// The password is read from TEST_STAFF_PASSWORD (at least 12 characters);
// it is never printed. Accounts that already exist are left unchanged.
// The script refuses to run on a database whose name does not contain
// "test", "dev" or "local" unless --force is given. Use --force only for a
// demo database, never for real patient data.

const path = require("path");
const args = process.argv.slice(2);
const envIndex = args.indexOf("--env");
const envFile = envIndex >= 0 ? args[envIndex + 1] : path.join(__dirname, "..", ".env");
require("dotenv").config({ path: envFile, override: true });

const bcrypt = require("bcrypt");
const pool = require("./db");

const ACCOUNTS = [
  { username: "test_paramedic", email: "test_paramedic@example.test", role: "PARAMEDIC", name: "Test Paramedic" },
  { username: "test_er_staff", email: "test_er_staff@example.test", role: "ER_STAFF", name: "Test ER Staff" },
  { username: "test_doctor", email: "test_doctor@example.test", role: "DOCTOR", name: "Test Doctor" },
];

async function main() {
  const password = process.env.TEST_STAFF_PASSWORD;
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error("Set TEST_STAFF_PASSWORD (12 to 128 characters) before running.");
  }

  const db = await pool.query("SELECT current_database() AS name");
  const dbName = db.rows[0].name;
  if (!/test|dev|local/i.test(dbName) && !args.includes("--force")) {
    throw new Error(
      `SAFETY STOP: database "${dbName}" does not look like a test database. Re-run with --force only if this is a demo database.`
    );
  }

  const hash = await bcrypt.hash(password, 10);
  const rows = [];
  for (const account of ACCOUNTS) {
    const existing = await pool.query("SELECT user_id FROM users WHERE username = $1", [account.username]);
    if (existing.rows.length > 0) {
      rows.push({ username: account.username, role: account.role, result: "already exists" });
      continue;
    }
    const created = await pool.query(
      `INSERT INTO users (username, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING user_id`,
      [account.username, account.email, hash, account.role]
    );
    const userId = created.rows[0].user_id;
    if (account.role === "DOCTOR") {
      await pool.query(
        `INSERT INTO doctor_profiles (user_id, full_name, qualification, specialization)
         VALUES ($1, $2, 'MD', 'Emergency Medicine')`,
        [userId, account.name]
      );
    } else {
      await pool.query(`INSERT INTO staff_profiles (user_id, full_name) VALUES ($1, $2)`, [userId, account.name]);
    }
    rows.push({ username: account.username, role: account.role, result: "created" });
  }
  console.table(rows);
  console.log("Database:", dbName);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
