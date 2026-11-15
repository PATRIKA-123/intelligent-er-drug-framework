process.env.PRE_ER_TEST_ENV_FILE = ".env.neon";

require("dotenv").config({
  path: require("path").resolve(".env.neon"),
  override: true
});

console.log("DB_SSL value:", process.env.DB_SSL);
console.log("PRE_ER_TEST_ENV_FILE:", process.env.PRE_ER_TEST_ENV_FILE);
const pool = require("./db");

async function testConnection() {
  try {
    console.log("Testing database connection...");

    const result = await pool.query(`
      SELECT
        current_database() AS database,
        NOW() AS server_time
    `);

    console.log("DATABASE CONNECTED:", result.rows[0]);
  } catch (error) {
    console.error("DATABASE CONNECTION FAILED:", error.message);
  } finally {
    await pool.end();
  }
}

testConnection();
