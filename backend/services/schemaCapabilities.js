// Lets the code work whether or not an optional column exists yet in the
// database (for example stay_doctor_assignments.ended_at), so the access
// rules never crash because one environment is a little behind another.
//
// Results are remembered while the server runs. After you add a column to the
// database, restart the server to pick it up.

const pool = require("../db");

const cache = new Map();

async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (cache.has(key)) return cache.get(key);

  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1
       AND column_name = $2
     LIMIT 1`,
    [table, column]
  );

  const exists = result.rowCount > 0;
  cache.set(key, exists);
  return exists;
}

// All column names of a table, as a Set (empty if the table does not exist).
const columnCache = new Map();
async function getColumns(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  const columns = new Set(result.rows.map((r) => r.column_name));
  columnCache.set(table, columns);
  return columns;
}

// For tests only.
function clearSchemaCache() {
  cache.clear();
  columnCache.clear();
}

module.exports = { hasColumn, getColumns, clearSchemaCache };
