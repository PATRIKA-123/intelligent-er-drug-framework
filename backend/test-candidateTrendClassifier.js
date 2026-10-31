"use strict";

const assert = require("node:assert/strict");
const {
  classifyCandidate
} = require("./services/candidateTrendClassifier");

const complete = {
  changes: {
    spo2: { delta: "-2", rate_per_hour: "-1.5" },
    heart_rate: { delta: "10", rate_per_hour: "7.5" },
    systolic_bp: { delta: "-5", rate_per_hour: "-3.75" },
    respiratory_rate: { delta: "2", rate_per_hour: "1.5" }
  }
};

const result = classifyCandidate(complete);

assert.equal(result.data_quality, "COMPLETE");
assert.equal(result.available_vitals, 4);
assert.equal(result.clinical_classification, null);
assert.equal(result.status, "REQUIRES_VALIDATED_RULES");

const partial = classifyCandidate({
  changes: {
    spo2: { delta: 1, rate_per_hour: 0.5 },
    heart_rate: { delta: null, rate_per_hour: null },
    systolic_bp: { delta: 2, rate_per_hour: 1 },
    respiratory_rate: { delta: null, rate_per_hour: null }
  }
});

assert.equal(partial.data_quality, "PARTIAL");
assert.equal(partial.available_vitals, 2);

const insufficient = classifyCandidate({
  changes: {
    spo2: { delta: null, rate_per_hour: null },
    heart_rate: { delta: null, rate_per_hour: null },
    systolic_bp: { delta: null, rate_per_hour: null },
    respiratory_rate: { delta: null, rate_per_hour: null }
  }
});

assert.equal(insufficient.data_quality, "INSUFFICIENT_DATA");
assert.equal(insufficient.available_vitals, 0);

assert.throws(
  () => classifyCandidate(null),
  TypeError
);

assert.throws(
  () => classifyCandidate({}),
  TypeError
);

console.log("All candidate classifier tests passed.");
console.log("No clinical categories or alerts were generated.");
