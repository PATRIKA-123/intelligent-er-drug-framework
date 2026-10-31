const pool = require("../db");

/**
 * Builds every unique unordered pair from a list of canonical drug
 * identities, after deduplicating the input itself.
 *
 * e.g. ["a","b","c"] -> [["a","b"], ["a","c"], ["b","c"]]
 */
function buildUniquePairs(canonicalIdentities) {
  const uniqueNames = Array.from(
    new Set(canonicalIdentities.filter(Boolean).map(String))
  );

  const pairs = [];
  for (let i = 0; i < uniqueNames.length; i++) {
    for (let j = i + 1; j < uniqueNames.length; j++) {
      pairs.push([uniqueNames[i], uniqueNames[j]]);
    }
  }
  return pairs;
}

/**
 * Looks up known DDInter drug-drug interactions among a list of
 * canonical drug identities (as produced by
 * medicationNormalizationService.getNormalizedMedications().canonical_identities).
 *
 * This is a pure, stay-independent lookup:
 *   - takes a plain array of drug names in, returns findings out
 *   - does not know or care what stay/patient those names came from
 *   - never writes to the database (read-only SELECT only)
 *   - does NOT persist findings -- that is Phase 5's job
 *
 * Matching rules (per the live schema):
 *   - case-insensitive and whitespace-trimmed, via LOWER(TRIM(...)),
 *     matching the existing functional indexes on drug_interactions
 *     (idx_drug_interactions_drug_a / _drug_b)
 *   - checks BOTH (drug_a, drug_b) and (drug_b, drug_a), because
 *     drug_interactions stores each unordered pair only once -- a
 *     one-directional lookup would silently miss roughly half of
 *     all real matches
 *
 * interaction_level is returned exactly as DDInter stores it,
 * including "Unknown". Unknown is a real DDInter finding (an
 * interaction exists, severity is not graded) -- it is never
 * treated as "no interaction" and never dropped. This service does
 * not assign or infer a clinical severity for Unknown; that
 * judgment, if made at all, belongs to a later phase.
 *
 * interaction_id is included because drug_safety_results.interaction_id
 * is a foreign key into drug_interactions(interaction_id) -- Phase 5
 * needs it to persist a finding. Nothing else about this function's
 * behavior changed from the Phase 4 version.
 *
 * @param {string[]} canonicalIdentities
 * @returns {Promise<{checked_pairs_count: number, interactions_found: Array<{interaction_id: number, drug_a: string, drug_b: string, interaction_level: string}>}>}
 */
async function findDrugInteractions(canonicalIdentities) {
  // Safe handling of empty/invalid input: no pairs possible with
  // fewer than 2 usable names, so return a valid empty result
  // without touching the database at all.
  if (!Array.isArray(canonicalIdentities) || canonicalIdentities.length < 2) {
    return { checked_pairs_count: 0, interactions_found: [] };
  }

  const pairs = buildUniquePairs(canonicalIdentities);

  if (pairs.length === 0) {
    return { checked_pairs_count: 0, interactions_found: [] };
  }

  const pairsA = pairs.map((p) => p[0]);
  const pairsB = pairs.map((p) => p[1]);

  // One batch query for every pair, not one query per pair.
  // The "pairs" CTE unpacks the two parallel arrays back into rows.
  // SELECT DISTINCT guards against duplicate findings defensively,
  // on top of the input already being deduplicated above.
  const result = await pool.query(
    `WITH pairs AS (
       SELECT LOWER(TRIM(a)) AS a, LOWER(TRIM(b)) AS b
       FROM unnest($1::text[], $2::text[]) AS t(a, b)
     )
     SELECT DISTINCT di.interaction_id, di.drug_a, di.drug_b, di.interaction_level
     FROM drug_interactions di
     JOIN pairs p
       ON (LOWER(TRIM(di.drug_a)) = p.a AND LOWER(TRIM(di.drug_b)) = p.b)
       OR (LOWER(TRIM(di.drug_a)) = p.b AND LOWER(TRIM(di.drug_b)) = p.a)`,
    [pairsA, pairsB]
  );

  return {
    checked_pairs_count: pairs.length,
    interactions_found: result.rows.map((row) => ({
      interaction_id: row.interaction_id,
      drug_a: row.drug_a,
      drug_b: row.drug_b,
      interaction_level: row.interaction_level,
    })),
  };
}

module.exports = { findDrugInteractions };