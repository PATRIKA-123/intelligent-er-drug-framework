const path = require("path");

require("dotenv").config({
  path: path.resolve(
    process.env.PRE_ER_TEST_ENV_FILE || path.join(__dirname, "../.env")
  ),
  // Do not let a checked-out .env override Render/CI injected settings.
  override: false,
});

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // Existing behavior preserved for this B18-only patch; SSL certificate
  // verification needs a separate, reviewed security fix.
  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: true }
      : false,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL client error:", err.message);
});

module.exports = pool;
