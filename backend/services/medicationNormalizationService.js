const pool = require("../db");

/**
 * Builds the normalized, DDInter-ready canonical medication list for one
 * ED stay.
 *
 * IMPORTANT: this does NOT perform new name-matching/normalization logic.
 * That work already exists as data in two frozen tables:
 *   - canonical_medication_map  (single-ingredient medications)
 *   - medication_components     (combination medications, decomposed into
 *                                 their active ingredients)
 * This service only READS that existing mapping data and assembles it per
 * stay. It never writes to canonical_medication_map or medication_components.
 *
 * Transparency rules (per project requirement):
 *   - A medication/component with mapping_status = 'MAPPED' contributes its
 *     canonical name to the result.
 *   - Anything else (PENDING status, or no mapping record at all) is NEVER
 *     silently dropped. It is reported separately in unmapped_medications
 *     with a reason, so missing/unverified data stays visible.
 *
 * Returns, for a stay with no medications at all, the same shape with
 * empty arrays (not an error) -- an empty medication list is a valid
 * clinical state, not a failure.
 */
async function getNormalizedMedications(stayId) {
  // 1. This stay's medications.
  const medicationsResult = await pool.query(
    `SELECT medication_id, medication_name, normalized_name, charttime
     FROM medications
     WHERE stay_id = $1
     ORDER BY charttime`,
    [stayId]
  );

  const medications = medicationsResult.rows;

  if (medications.length === 0) {
    return {
      stay_id: stayId,
      mapped_medications: [],
      canonical_identities: [],
      unmapped_medications: [],
    };
  }

  const medicationIds = medications.map((m) => m.medication_id);

  // 2. Single-ingredient mappings for these medications.
  //    DISTINCT ON (medication_id) guards against a known data issue:
  //    4 medication_ids in canonical_medication_map currently have two
  //    identical MAPPED rows each. This takes one row per medication_id
  //    instead of returning duplicates.
  const canonicalResult = await pool.query(
    `SELECT DISTINCT ON (medication_id)
            medication_id, canonical_name, mapping_status
     FROM canonical_medication_map
     WHERE medication_id = ANY($1::int[])
     ORDER BY medication_id, mapping_id`,
    [medicationIds]
  );

  // 3. Combination-drug components for these medications.
  //    A single medication_id can have multiple component rows.
  const componentsResult = await pool.query(
    `SELECT medication_id, component_name, component_canonical_name, mapping_status
     FROM medication_components
     WHERE medication_id = ANY($1::int[])
     ORDER BY medication_id, component_id`,
    [medicationIds]
  );

  // Index both result sets by medication_id for fast lookup in the loop below.
  const canonicalByMedId = new Map();
  for (const row of canonicalResult.rows) {
    canonicalByMedId.set(row.medication_id, row);
  }

  const componentsByMedId = new Map();
  for (const row of componentsResult.rows) {
    if (!componentsByMedId.has(row.medication_id)) {
      componentsByMedId.set(row.medication_id, []);
    }
    componentsByMedId.get(row.medication_id).push(row);
  }

  const mappedMedications = [];
  const unmappedMedications = [];
  const canonicalIdentitiesSet = new Set();

  for (const med of medications) {
    const directMapping = canonicalByMedId.get(med.medication_id);
    const components = componentsByMedId.get(med.medication_id);

    if (directMapping) {
      // Single-ingredient medication.
      if (directMapping.mapping_status === "MAPPED" && directMapping.canonical_name) {
        mappedMedications.push({
          medication_id: med.medication_id,
          medication_name: med.medication_name,
          canonical_name: directMapping.canonical_name,
          source: "DIRECT",
          component_of: null,
        });
        canonicalIdentitiesSet.add(directMapping.canonical_name);
      } else {
        unmappedMedications.push({
          medication_id: med.medication_id,
          medication_name: med.medication_name,
          reason: `Mapping status is ${directMapping.mapping_status}, not MAPPED`,
        });
      }
    } else if (components && components.length > 0) {
      // Combination medication, decomposed into its components.
      for (const component of components) {
        if (component.mapping_status === "MAPPED" && component.component_canonical_name) {
          mappedMedications.push({
            medication_id: med.medication_id,
            medication_name: component.component_name,
            canonical_name: component.component_canonical_name,
            source: "COMPONENT",
            component_of: med.medication_name,
          });
          canonicalIdentitiesSet.add(component.component_canonical_name);
        } else {
          unmappedMedications.push({
            medication_id: med.medication_id,
            medication_name: `${component.component_name} (component of ${med.medication_name})`,
            reason: `Component mapping status is ${component.mapping_status}, not MAPPED`,
          });
        }
      }
    } else {
      // No mapping record of any kind exists for this medication_id.
      unmappedMedications.push({
        medication_id: med.medication_id,
        medication_name: med.medication_name,
        reason: "No canonical mapping or component record found",
      });
    }
  }

  return {
    stay_id: stayId,
    mapped_medications: mappedMedications,
    // Deduplicated, ready to hand to Phase 4's pair generation.
    canonical_identities: Array.from(canonicalIdentitiesSet),
    unmapped_medications: unmappedMedications,
  };
}

module.exports = { getNormalizedMedications };