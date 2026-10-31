
const test = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = "http://localhost:5000";

test("Public registration must not grant ADMIN role", async () => {
  const uniqueId = `${Date.now()}`;

  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: `security_regression_${uniqueId}`,
      email: `security_regression_${uniqueId}@example.test`,
      password: "TestOnly_Pass_7391!",
      role: "ADMIN"
    })
  });

  assert.equal(
    response.status,
    201,
    "Registration should succeed with a restricted public role"
  );

  const data = await response.json();

  assert.equal(
    data.user.role,
    "PATIENT",
    "Public registration must never create an ADMIN account"
  );
});

test("Public registration without a role defaults to PATIENT", async () => {
  const uniqueId = `${Date.now()}`;

  const response = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      username: `patient_regression_${uniqueId}`,
      email: `patient_regression_${uniqueId}@example.test`,
      password: "TestOnly_Pass_7391!"
    })
  });

  assert.equal(response.status, 201);

  const data = await response.json();

  assert.equal(data.user.role, "PATIENT");
});
