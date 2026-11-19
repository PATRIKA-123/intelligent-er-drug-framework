"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { classifySnapshot } = require("./services/screeningStatus");
const run = { engine_run_id: "run-1", engine_version: "phase6-v1", created_at: "2026-11-19" };

test("B13: current successful run with no rows is explicitly COMPLETE_ZERO_FINDINGS", () => {
  assert.equal(classifySnapshot(run, [], "phase6-v1").status, "COMPLETE_ZERO_FINDINGS");
});
test("B13: no run is NOT_RUN; stale engine or mismatched run is STALE", () => {
  assert.equal(classifySnapshot(null, [], "phase6-v1").status, "NOT_RUN");
  assert.equal(classifySnapshot({ ...run, engine_version: "old" }, [], "phase6-v1").status, "STALE");
  assert.equal(classifySnapshot(run, [{ engine_run_id: "old", engine_version: "phase6-v1" }], "phase6-v1").status, "STALE");
});
test("B13: completed findings retain the run identity and timestamp", () => {
  const result = classifySnapshot(run, [{ engine_run_id: "run-1", engine_version: "phase6-v1" }], "phase6-v1");
  assert.deepEqual(result, { status: "COMPLETE_FINDINGS", completed_at: "2026-11-19", engine_run_id: "run-1" });
});

async function withFakeDB(fixture, fn) {
  const target = path.resolve(__dirname, "services/medicationNormalizationService.js");
  delete require.cache[target];
  const old = Module._load;
  Module._load = function(request, parent, ...args) {
    if (request === "../db" && parent?.filename === target) return { query: async (sql) => {
      if (/FROM medications\s/i.test(sql)) return { rows: fixture.medications };
      if (/FROM canonical_medication_map/i.test(sql)) return { rows: fixture.direct || [] };
      if (/FROM medication_components/i.test(sql)) return { rows: fixture.components || [] };
      throw Error("Unexpected SQL " + sql);
    } };
    return old.call(this, request, parent, ...args);
  };
  let service;
  try { service = require(target); } finally { Module._load = old; }
  try { await fn(service.getNormalizedMedications); } finally { delete require.cache[target]; }
}
const medication = [{ medication_id: 1, medication_name: "DemoMed", charttime: "2026-11-19" }];
const direct = (mapping_id, canonical_name, mapping_status = "MAPPED") => ({ mapping_id, medication_id: 1, canonical_name, mapping_status });

test("B14: identical duplicates are deduplicated, not a conflicting screen", async () => {
  await withFakeDB({ medications: medication, direct: [direct(1, "DRUG A"), direct(2, "drug a")] }, async get => {
    const data = await get(33, { requireComplete: true });
    assert.equal(data.mapping_status, "COMPLETE");
    assert.equal(data.mapped_medications.length, 1);
    assert.deepEqual(data.canonical_identities, ["DRUG A"]);
  });
});
test("B14: contradictory direct mappings fail closed", async () => {
  await withFakeDB({ medications: medication, direct: [direct(1, "DRUG A"), direct(2, "DRUG B")] }, async get => {
    await assert.rejects(() => get(33, { requireComplete: true }), { code: "AMBIGUOUS_MEDICATION_MAPPING", statusCode: 422 });
  });
});
test("B14: direct and component mapping mixed for one medication fail closed", async () => {
  await withFakeDB({ medications: medication, direct: [direct(1, "DRUG A")],
    components: [{ medication_id: 1, component_id: 2, component_name: "part", component_canonical_name: "DRUG B", mapping_status: "MAPPED" }] }, async get => {
    await assert.rejects(() => get(33, { requireComplete: true }), { code: "AMBIGUOUS_MEDICATION_MAPPING" });
  });
});
test("B14: contradictory ingredient mappings fail closed", async () => {
  const base = { medication_id: 1, component_name: "Ingredient A", mapping_status: "MAPPED" };
  await withFakeDB({ medications: medication, components: [
    { ...base, component_id: 1, component_canonical_name: "A" },
    { ...base, component_id: 2, component_canonical_name: "B" }
  ] }, async get => assert.rejects(() => get(33), { code: "AMBIGUOUS_MEDICATION_MAPPING" }));
});
test("B14: missing and pending mappings are explicitly incomplete and block screening", async () => {
  await withFakeDB({ medications: medication }, async get => {
    const data = await get(33);
    assert.equal(data.mapping_status, "INCOMPLETE");
    assert.equal(data.unmapped_medications.length, 1);
    await assert.rejects(() => get(33, { requireComplete: true }), { code: "INCOMPLETE_MEDICATION_MAPPING" });
  });
  await withFakeDB({ medications: medication, direct: [direct(1, null, "PENDING")] }, async get => {
    await assert.rejects(() => get(33, { requireComplete: true }), { code: "INCOMPLETE_MEDICATION_MAPPING" });
  });
});
test("B14: valid component entries preserve provenance without duplicates", async () => {
  const entries = [
    { medication_id: 1, component_id: 1, component_name: "A", component_canonical_name: "Drug A", mapping_status: "MAPPED" },
    { medication_id: 1, component_id: 2, component_name: "B", component_canonical_name: "Drug B", mapping_status: "MAPPED" }
  ];
  await withFakeDB({ medications: medication, components: entries }, async get => {
    const data = await get(33, { requireComplete: true });
    assert.deepEqual(data.canonical_identities, ["Drug A", "Drug B"]);
    assert.equal(data.mapping_sources.length, 2);
  });
});
