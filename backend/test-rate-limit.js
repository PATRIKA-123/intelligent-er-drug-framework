"use strict";
// Unit test for middleware/rateLimit.js (no database). Run: node test-rate-limit.js
const assert = require("assert");
const rateLimit = require("./middleware/rateLimit");

function run(limiter, ip) {
  let status = 200, nexted = false;
  const res = { set() {}, status(c) { status = c; return this; }, json() {} };
  limiter({ ip }, res, () => { nexted = true; });
  return { status, nexted };
}

const limiter = rateLimit({ windowMs: 60000, max: 3 });
for (let i = 0; i < 3; i++) assert.strictEqual(run(limiter, "1.1.1.1").nexted, true, "first 3 allowed");
const blocked = run(limiter, "1.1.1.1");
assert.strictEqual(blocked.status, 429);
assert.strictEqual(blocked.nexted, false);
assert.strictEqual(run(limiter, "2.2.2.2").nexted, true, "other address not affected");
console.log("Rate limit tests passed");
