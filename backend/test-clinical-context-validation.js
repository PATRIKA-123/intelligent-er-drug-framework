
require("dotenv").config();

const BASE_URL = "http://localhost:5000";

async function registerAndLogin() {
  const username = `context_validation_${Date.now()}`;
  const password = "TestPass123!";

  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role: "ADMIN" }),
  });

  if (!registerRes.ok) {
    throw new Error(
      `Register failed: ${registerRes.status} ${await registerRes.text()}`
    );
  }

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const loginData = await loginRes.json();

  if (!loginRes.ok || !loginData.token) {
    throw new Error("Login failed; token not received");
  }

  return loginData.token;
}

async function run() {
  try {
    const token = await registerAndLogin();
    console.log("Test user authenticated.\n");

    const invalidIds = [
      "abc",
      "9999999999999999999",
      "9223372036854775808",
      "99999999999999999999",
    ];

    for (const id of invalidIds) {
      const res = await fetch(
        `${BASE_URL}/api/clinical-context/${id}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const body = await res.json();

      console.log(`ID: ${id} | Status: ${res.status} |`, body);

      if (
        res.status !== 400 ||
        body.error !== "stay_id must be a valid integer"
      ) {
        throw new Error(`FAIL: unexpected response for ID ${id}`);
      }
    }

    const noAuthRes = await fetch(
      `${BASE_URL}/api/clinical-context/abc`
    );
    const noAuthBody = await noAuthRes.json();

    console.log("\nNo-auth status:", noAuthRes.status, noAuthBody);

    if (noAuthRes.status !== 401) {
      throw new Error("FAIL: unauthenticated request should return 401");
    }

    console.log("\nPASS: clinical context validation checks passed.");
  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
    process.exitCode = 1;
  }
}

run();
