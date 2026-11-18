"use strict";

// B10: tells API callers whether an observation's consciousness / oxygen /
// SpO2-scale values were MEASURED or were assumed demonstration defaults.
//
// Works with or without observations.spo2_scale_assumed (added by
// migrations/20261116_002_observation_spo2_scale_assumed.sql).
//
// based_on_assumed_inputs is three-valued on purpose:
//   true  -> at least one input was an assumed default
//   false -> every flag is explicitly false
//   null  -> provenance unknown (flags never set, e.g. rows imported before B10
//            and not yet run through scripts/backfillAssumedInputs.js)

const { hasColumn } = require("./schemaCapabilities");

// alias: the SQL alias of the observations TABLE (not the view) in the query.
async function assumedInputsSql(alias = "o") {
  const flags = [`${alias}.consciousness_assumed`, `${alias}.oxygen_support_assumed`];
  if (await hasColumn("observations", "spo2_scale_assumed")) {
    flags.push(`${alias}.spo2_scale_assumed`);
  }

  const anyTrue = flags.map((f) => `${f} IS TRUE`).join(" OR ");
  const allFalse = flags.map((f) => `${f} IS FALSE`).join(" AND ");

  return {
    // for a SELECT list: the individual flags
    columns: flags.join(", "),
    // for a SELECT list: one summary value
    basedOn: `CASE WHEN ${anyTrue} THEN TRUE WHEN ${allFalse} THEN FALSE ELSE NULL END`,
  };
}

module.exports = { assumedInputsSql };
