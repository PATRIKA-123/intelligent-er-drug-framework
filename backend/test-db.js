
require("dotenv").config({
  path: require("path").join(__dirname, "../.env"),
});

const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function testConnection() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        current_user AS database_user,
        NOW() AS server_time
    `);

    console.log("Connected to PostgreSQL");
    console.log("Database:", result.rows[0].database_name);
    console.log("Server time:", result.rows[0].server_time);

    const rawCount = await pool.query(
      "SELECT COUNT(*) AS total FROM observations"
    );

    const cleanCount = await pool.query(
      "SELECT COUNT(*) AS total FROM observations_clean"
    );

    console.log("Raw observations:", rawCount.rows[0].total);
    console.log("Clean observations:", cleanCount.rows[0].total);
  } catch (err) {
    console.error("Database connection failed:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testConnection();
