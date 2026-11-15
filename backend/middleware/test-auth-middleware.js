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

test("missing token returns 401", async () => {
  const req = mockRequest(null);
  const res = mockResponse();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("invalid token returns 401", async () => {
  const req = mockRequest("invalid.token.value");
  const res = mockResponse();
  let nextCalled = false;

  await authMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("valid token calls next and sets req.user", async () => {
  const secret = "isolated-test-secret";
  const token = jwt.sign(
    { user_id: 123, role: "PARAMEDIC" },
    secret
  );

  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  const originalLookup = authMiddleware.lookupUser;
  authMiddleware.lookupUser = async () => ({
    user_id: 123, username: "p", role: "PARAMEDIC", is_active: true
  });

  try {
    const req = mockRequest(token);
    const res = mockResponse();
    let nextCalled = false;

    await authMiddleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.user.user_id, 123);
    assert.equal(req.user.role, "PARAMEDIC");
  } finally {
    authMiddleware.lookupUser = originalLookup;
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

// ---- B03: the database decides, not the token ----

async function runWithLookup(claims, lookup) {
  const secret = "isolated-test-secret";
  const token = jwt.sign(claims, secret);
  const originalSecret = process.env.JWT_SECRET;
  const originalLookup = authMiddleware.lookupUser;
  process.env.JWT_SECRET = secret;
  authMiddleware.lookupUser = lookup;

  const req = mockRequest(token);
  const res = mockResponse();
  let nextCalled = false;
  try {
    await authMiddleware(req, res, () => { nextCalled = true; });
  } finally {
    authMiddleware.lookupUser = originalLookup;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  }
  return { req, res, nextCalled };
}

test("deactivated account is rejected even with a valid token", async () => {
  const { res, nextCalled } = await runWithLookup(
    { user_id: 5, role: "ADMIN" },
    async () => ({ user_id: 5, username: "u", role: "ADMIN", is_active: false })
  );
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("account that no longer exists is rejected", async () => {
  const { res, nextCalled } = await runWithLookup(
    { user_id: 5, role: "ADMIN" },
    async () => null
  );
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("role comes from the database, not the token", async () => {
  const { req, nextCalled } = await runWithLookup(
    { user_id: 5, role: "ADMIN" },
    async () => ({ user_id: 5, username: "u", role: "PATIENT", is_active: true })
  );
  assert.equal(nextCalled, true);
  assert.equal(req.user.role, "PATIENT");
});

test("lookup failure denies access with 503", async () => {
  const { res, nextCalled } = await runWithLookup(
    { user_id: 5, role: "ADMIN" },
    async () => { throw new Error("db down"); }
  );
  assert.equal(res.statusCode, 503);
  assert.equal(nextCalled, false);
  assert.equal(JSON.stringify(res.body).includes("db down"), false);
});

test("token without a valid user_id is rejected before any lookup", async () => {
  let lookedUp = false;
  const { res, nextCalled } = await runWithLookup(
    { user_id: "5; DROP", role: "ADMIN" },
    async () => { lookedUp = true; return null; }
  );
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
  assert.equal(lookedUp, false);
});
