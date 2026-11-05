require("dotenv").config({
  path: ".env.pre-er-test",
  override: true
});

const pool = require("./db");
const bcrypt = require("bcrypt");

async function main() {
  const db = await pool.query(
    "SELECT current_database() AS database_name"
  );

  console.log("DATABASE:", db.rows[0].database_name);

  if (db.rows[0].database_name !== "intelligent_er_drug_test") {
    throw new Error("SAFETY STOP: Wrong database");
  }

  const result = await pool.query(
    `SELECT user_id, username, role, is_active, password_hash
     FROM users
     WHERE username = $1`,
    ["test_paramedic"]
  );

  if (result.rows.length === 0) {
    console.log("ACCOUNT: NOT FOUND");
    return;
  }

  const user = result.rows[0];

  const matches = await bcrypt.compare(
    process.env.TEST_PARAMEDIC_PASSWORD,
    user.password_hash
  );

  console.log("ACCOUNT:", {
    user_id: user.user_id,
    username: user.username,
    role: user.role,
    is_active: user.is_active
  });

  console.log("PASSWORD MATCHES:", matches);
}

main()
  .catch(err => console.error(err.message))
  .finally(() => pool.end());
