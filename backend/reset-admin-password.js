
require("dotenv").config();

const bcrypt = require("bcrypt");
const pool = require("./db");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question("Enter new ADMIN password: ", async (password) => {
  try {
    if (!password || password.length < 10) {
      throw new Error("Password must be at least 10 characters");
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE user_id = 5
         AND username = 'admin_test'
         AND role = 'ADMIN'
       RETURNING user_id, username, role`,
      [hash]
    );

    if (result.rowCount !== 1) {
      throw new Error("Expected ADMIN account was not updated");
    }

    console.log("Password reset successful:", result.rows[0]);
  } catch (error) {
    console.error("Password reset failed:", error.message);
  } finally {
    rl.close();
    await pool.end();
  }
});
