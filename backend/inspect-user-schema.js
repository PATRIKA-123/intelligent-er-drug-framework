const pool = require("./db");

(async () => {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
        AND table_schema = 'public'
      ORDER BY ordinal_position;
    `);

    console.table(result.rows);

    const constraints = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'users'::regclass;
    `);

    console.table(constraints.rows);
  } catch (error) {
    console.error(error);
  } finally {
    await pool.end();
  }
})();
