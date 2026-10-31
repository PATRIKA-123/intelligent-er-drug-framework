const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const authMiddleware = require("./authMiddleware");

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

function mockRequest(token) {
  return {
    headers: token
      ? { authorization: `Bearer ${token}` }
      : {},
  };
}

test("missing token returns 401", () => {
  const req = mockRequest(null);
  const res = mockResponse();
  let nextCalled = false;

  authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("invalid token returns 401", () => {
  const req = mockRequest("invalid.token.value");
  const res = mockResponse();
  let nextCalled = false;

  authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("valid token calls next and sets req.user", () => {
  const secret = "isolated-test-secret";
  const token = jwt.sign(
    { user_id: 123, role: "PARAMEDIC" },
    secret
  );

  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;

  try {
    const req = mockRequest(token);
    const res = mockResponse();
    let nextCalled = false;

    authMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.user.user_id, 123);
    assert.equal(req.user.role, "PARAMEDIC");
  } finally {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
  }
});

test("allowed role calls next", () => {
  const req = { user: { role: "PARAMEDIC" } };
  const res = mockResponse();
  let nextCalled = false;

  authMiddleware.requireRole("PARAMEDIC", "ADMIN")(
    req,
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, true);
});

test("disallowed role returns 403", () => {
  const req = { user: { role: "PATIENT" } };
  const res = mockResponse();
  let nextCalled = false;

  authMiddleware.requireRole("PARAMEDIC", "ADMIN")(
    req,
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("missing req.user returns 401 in requireRole", () => {
  const req = {};
  const res = mockResponse();
  let nextCalled = false;

  authMiddleware.requireRole("PARAMEDIC")(
    req,
    res,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});