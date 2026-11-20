"use strict";

const pool = require("../db");

// Frozen mapping tables have no published source-version columns. Until B04's
// schema migration adds those fields, the provenance below identifies the
// source table and mapping row ID; it does not claim a version that does not exist.
function mappingError(kind, medicationId) {
  const error = new Error(`Medication ${medicationId} has ${kind}; medication safety screening is incomplete`);
  error.code = "AMBIGUOUS_MEDICATION_MAPPING";
  error.statusCode = 422;
  return error;
}

function normalized(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function groupByMedication(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.medication_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

/**
 * Read-only normalization of a stay's medication snapshot.
 * Duplicate canonical map rows are acceptable ONLY when their canonical
 * identity and mapping status agree; conflicting duplicates fail closed.
 * Combination ingredients may have multiple rows, but inconsistent mappings
 * for the same ingredient are rejected. This never silently chooses a row.
 *
 * options.requireComplete=true is for clinical screening. Missing / pending
 * mapping data is then a 422, not a falsely clean interaction screen.
 */
async function getNormalizedMedications(stayId, options = {}) {
  const medResult = await pool.query(
    `SELECT medication_id, medication_name, normalized_name, charttime
     FROM medications WHERE stay_id = $1 ORDER BY charttime, medication_id`,
    [stayId]
  );
  const medications = medResult.rows;
  const empty = {
    stay_id: stayId, mapped_medications: [], canonical_identities: [],
    unmapped_medications: [], mapping_status: "COMPLETE", mapping_sources: []
  };
  if (!medications.length) return empty;

  const ids = medications.map(m => m.medication_id);
  // Do NOT use DISTINCT ON: it hides contradictory mapping rows.
  const canonical = await pool.query(
    `SELECT mapping_id, medication_id, canonical_name, mapping_status, mapping_version, created_at
     FROM canonical_medication_map
     WHERE medication_id = ANY($1::int[]) ORDER BY medication_id, mapping_id`, [ids]
  );
  const component = await pool.query(
    `SELECT component_id, medication_id, component_name, component_canonical_name, mapping_status, mapping_version, created_at
     FROM medication_components
     WHERE medication_id = ANY($1::int[]) ORDER BY medication_id, component_id`, [ids]
  );
  const directById = groupByMedication(canonical.rows);
  const componentsById = groupByMedication(component.rows);
  const mapped = [], unmapped = [], identities = new Set(), sources = [];
  const markMapped = (med, name, source, componentOf, rowId, mappingRow) => {
    mapped.push({ medication_id: med.medication_id, medication_name: name,
      canonical_name: source.canonical, source: source.type, component_of: componentOf });
    identities.add(source.canonical);
    sources.push({ medication_id: med.medication_id, table: source.table, row_id: rowId,
      // B14_VERSIONED_PROVENANCE: NULL explicitly means legacy/unversioned.
      mapping_version: mappingRow.mapping_version ?? null,
      version_status: mappingRow.mapping_version ? 'VERSIONED' : 'LEGACY_UNVERSIONED',
      mapping_created_at: mappingRow.created_at ?? null });
  };

  for (const med of medications) {
    const id = String(med.medication_id);
    const direct = directById.get(id) || [];
    const parts = componentsById.get(id) || [];
    if (direct.length && parts.length) throw mappingError("both a direct mapping and component mappings", id);

    if (direct.length) {
      const first = direct[0];
      const same = direct.every(r => normalized(r.canonical_name) === normalized(first.canonical_name)
        && normalized(r.mapping_status) === normalized(first.mapping_status)
        && (r.mapping_version ?? null) === (first.mapping_version ?? null));
      if (!same) throw mappingError("conflicting canonical mappings", id);
      if (normalized(first.mapping_status) === "mapped" && normalized(first.canonical_name)) {
        markMapped(med, med.medication_name, {
          type: "DIRECT", table: "canonical_medication_map", canonical: first.canonical_name.trim()
        }, null, first.mapping_id, first);
      } else {
        unmapped.push({ medication_id: med.medication_id, medication_name: med.medication_name,
          reason: `Mapping status is ${first.mapping_status || "UNKNOWN"}, not MAPPED` });
      }
    } else if (parts.length) {
      const byIngredient = new Map();
      for (const row of parts) {
        const ingredient = normalized(row.component_name);
        // Unknown ingredient identity cannot be safely de-duplicated.
        if (!ingredient) throw mappingError("an unnamed component", id);
        const key = ingredient;
        if (!byIngredient.has(key)) byIngredient.set(key, []);
        byIngredient.get(key).push(row);
      }
      for (const rows of byIngredient.values()) {
        const first = rows[0];
        if (!rows.every(r => normalized(r.component_canonical_name) === normalized(first.component_canonical_name)
          && normalized(r.mapping_status) === normalized(first.mapping_status)
          && (r.mapping_version ?? null) === (first.mapping_version ?? null))) {
          throw mappingError("conflicting ingredient mappings", id);
        }
        if (normalized(first.mapping_status) === "mapped" && normalized(first.component_canonical_name)) {
          markMapped(med, first.component_name, {
            type: "COMPONENT", table: "medication_components", canonical: first.component_canonical_name.trim()
          }, med.medication_name, first.component_id, first);
        } else {
          unmapped.push({ medication_id: med.medication_id,
            medication_name: `${first.component_name} (component of ${med.medication_name})`,
            reason: `Component mapping status is ${first.mapping_status || "UNKNOWN"}, not MAPPED` });
        }
      }
    } else {
      unmapped.push({ medication_id: med.medication_id, medication_name: med.medication_name,
        reason: "No canonical mapping or component record found" });
    }
  }

  const result = {
    stay_id: stayId, mapped_medications: mapped, canonical_identities: [...identities],
    unmapped_medications: unmapped,
    mapping_status: unmapped.length ? "INCOMPLETE" : "COMPLETE",
    mapping_sources: sources
  };
  if (options.requireComplete && unmapped.length) {
    const error = new Error("Medication normalization is incomplete; clinical interaction screening was not persisted");
    error.code = "INCOMPLETE_MEDICATION_MAPPING";
    error.statusCode = 422;
    error.unmapped_count = unmapped.length;
    throw error;
  }
  return result;
}

module.exports = { getNormalizedMedications };
