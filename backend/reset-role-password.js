
require("dotenv").config();

const bcrypt = require("bcrypt");
const pool = require("./db");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const accounts = {
  "1": {
    user_id: 4,
    username: "er_staff_test",
    role: "ER_STAFF"
  },
  "2": {
    user_id: 3,
    username: "paramedic_test",
    role: "PARAMEDIC"
  },
  "3": {
    user_id: 1,
    username: "patrika_test",
    role: "PATIENT"
  }
};

async function resetPassword() {
  try {
    const dbCheck = await pool.query(
      "SELECT current_database() AS database_name"
    );

    if (dbCheck.rows[0].database_name !== "neondb") {
      throw new Error("Wrong database. Expected Neon: neondb");
    }

    const choice = await new Promise(resolve => {
      rl.question(
        "\n1. ER_STAFF\n2. PARAMEDIC\n3. PATIENT\nChoose account: ",
        resolve
      );
    });

    const account = accounts[choice];

    if (!account) {
      throw new Error("Invalid account selection.");
    }

    const password = await new Promise(resolve => {
      rl.question("Enter new password: ", resolve);
    });

    if (!password || password.length < 10) {
      throw new Error("Password must be at least 10 characters.");
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `UPDATE users
       SET password_hash = $1
       WHERE user_id = $2
         AND username = $3
         AND role = $4
       RETURNING user_id, username, role`,
      [hash, account.user_id, account.username, account.role]
    );

    if (result.rowCount !== 1) {
      throw new Error("Expected account was not updated.");
    }

    console.log("\nPassword reset successful:");
    console.log(result.rows[0]);

  } catch (error) {
    console.error("\nPassword reset failed:", error.message);
  } finally {
    rl.close();
    await pool.end();
  }
}

resetPassword();
