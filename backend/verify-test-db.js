require("dotenv").config({
  path: ".env.pre-er-test",
  override: true
});

const pool = require("./db");

async function verify() {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database,
        current_user AS db_user
    `);

    console.table(result.rows);
  } catch (error) {
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

verify();
