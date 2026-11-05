require("dotenv").config({
  path: ".env.pre-er-test",
  override: true
});

const pool = require("./db");

async function inspect() {
  try {
    const result = await pool.query(`
      SELECT
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('pre_er_assessments', 'pre_er_vitals')
        AND column_name IN ('oxygen_support', 'consciousness_status', 'consciousness_level')
      ORDER BY table_name, ordinal_position;
    `);

    console.table(result.rows);
  } catch (error) {
    console.error(error.message);
  } finally {
    await pool.end();
  }
}

inspect();
