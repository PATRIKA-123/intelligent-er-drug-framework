require("dotenv").config({ path: ".env.pre-er-test" });

const pool = require("./db");

async function inspect() {
  try {
    const result = await pool.query(`
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
        AND table_schema = 'public'
      ORDER BY ordinal_position
    `);

    console.table(result.rows);
  } catch (error) {
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

inspect();
