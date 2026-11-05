require("dotenv").config({
  path: ".env.pre-er-test",
  override: true
});

const bcrypt = require("bcrypt");
const pool = require("./db");

async function main() {
  const db = await pool.query("SELECT current_database() AS name");

  if (db.rows[0].name !== "intelligent_er_drug_test") {
    throw new Error("SAFETY STOP: Wrong database: " + db.rows[0].name);
  }

  const username = "test_paramedic";
  const email = "test_paramedic@example.test";
  const password = process.env.TEST_PARAMEDIC_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error("Test password missing or too short.");
  }

  const existing = await pool.query(
    "SELECT user_id, username, role FROM users WHERE username = $1",
    [username]
  );

  if (existing.rows.length > 0) {
    console.log("Account already exists:");
    console.table(existing.rows);
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING user_id, username, email, role, is_active`,
    [username, email, hash, "PARAMEDIC"]
  );

  console.log("PARAMEDIC test account created:");
  console.table(result.rows);
  console.log("Database:", db.rows[0].name);
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
