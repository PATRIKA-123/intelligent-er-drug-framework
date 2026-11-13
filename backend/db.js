
const path = require("path");

require("dotenv").config({
  path: path.resolve(
    process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env")
  ),
  override: true,
});

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // Enable SSL for Neon; keep local PostgreSQL unchanged.
  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL client error:", err.message);
});

module.exports = pool;
