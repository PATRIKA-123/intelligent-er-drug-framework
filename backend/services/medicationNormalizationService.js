"use strict";

const pool = require("../db");

const BRAND_AND_ALIAS_TO_GENERIC = {
  ecosprin: ["aspirin"],
  disprin: ["aspirin"],
  loprin: ["aspirin"],
  clopilet: ["clopidogrel"],
  plavix: ["clopidogrel"],
  augmentin: ["amoxicillin", "clavulanate"],
  moxikind: ["amoxicillin", "clavulanate"],
  pan: ["pantoprazole"],
  pantocid: ["pantoprazole"],
  rantac: ["ranitidine"],
  omez: ["omeprazole"],
  crocin: ["acetaminophen"],
  dolo: ["acetaminophen"],
  calpol: ["acetaminophen"],
  paracetamol: ["acetaminophen"],
  brufen: ["ibuprofen"],
  combiflam: ["ibuprofen", "acetaminophen"],
  voveran: ["diclofenac"],
  lasix: ["furosemide"],
  dytor: ["torsemide"],
  metolar: ["metoprolol"],
  betaloc: ["metoprolol"],
  lopressor: ["metoprolol"],
  aten: ["atenolol"],
  amlopres: ["amlodipine"],
  stamlo: ["amlodipine"],
  telma: ["telmisartan"],
  cardace: ["ramipril"],
  coumadin: ["warfarin"],
  warf: ["warfarin"],
  clexane: ["enoxaparin"],
  atorva: ["atorvastatin"],
  lipitor: ["atorvastatin"],
  rosuvas: ["rosuvastatin"],
  glycomet: ["metformin"],
  azithral: ["azithromycin"],
  ciplox: ["ciprofloxacin"],
  taxim: ["cefotaxime"],
  monocef: ["ceftriaxone"],
  zofer: ["ondansetron"],
  emeset: ["ondansetron"],
};

function normalizeRawDrugTokens(rawName) {
  const cleaned = String(rawName || "")
    .toLowerCase()
    .replace(/\b(tab|tablet|tablets|cap|capsule|capsules|inj|injection|syp|syrup|iv|im|po|od|bd|tds|qid|sos|stat|mg|mcg|g|ml|%)\b/g, " ")
    .replace(/\b\d+(\.\d+)?\b/g, " ")
    .replace(/[^a-z+\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];
  return cleaned
    .split(/\s*(?:\+|\/|\band\b|,)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function resolveCandidateGenerics(rawName) {
  const tokens = normalizeRawDrugTokens(rawName);
  const candidates = new Set();

  for (const token of tokens) {
    if (BRAND_AND_ALIAS_TO_GENERIC[token]) {
      for (const g of BRAND_AND_ALIAS_TO_GENERIC[token]) candidates.add(g);
    } else {
      const firstWord = token.split(" ")[0];
      if (BRAND_AND_ALIAS_TO_GENERIC[firstWord]) {
        for (const g of BRAND_AND_ALIAS_TO_GENERIC[firstWord]) candidates.add(g);
      } else {
        candidates.add(firstWord);
      }
    }
  }
  return [...candidates];
}

async function autoMapMedication(dbClient, medicationId, rawName) {
  const client = dbClient || pool;
  const candidates = resolveCandidateGenerics(rawName);
  if (candidates.length === 0) return { mapped: false, identities: [] };

  const verifiedGenerics = [];
  for (const candidate of candidates) {
    const res = await client.query(
      `SELECT drug_name FROM (
         SELECT DISTINCT LOWER(TRIM(drug_a)) AS drug_name
         FROM drug_interactions
         WHERE LOWER(TRIM(drug_a)) = $1
         UNION
         SELECT DISTINCT LOWER(TRIM(drug_b)) AS drug_name
         FROM drug_interactions
         WHERE LOWER(TRIM(drug_b)) = $1
       ) matched
       LIMIT 1`,
      [candidate]
    );
    if (res.rows.length > 0) {
      verifiedGenerics.push(res.rows[0].drug_name);
    }
  }

  const uniqueVerified = [...new Set(verifiedGenerics)];
  if (uniqueVerified.length === 0) {
    return { mapped: false, identities: [] };
  }

  if (uniqueVerified.length === 1) {
    await client.query(
      `INSERT INTO canonical_medication_map (medication_id, canonical_name, mapping_status)
       VALUES ($1, $2, 'MAPPED')
       ON CONFLICT DO NOTHING`,
      [medicationId, uniqueVerified[0]]
    );
  } else {
    for (const comp of uniqueVerified) {
      await client.query(
        `INSERT INTO medication_components
           (medication_id, component_name, component_canonical_name, mapping_status)
         VALUES ($1, $2, $2, 'MAPPED')
         ON CONFLICT DO NOTHING`,
        [medicationId, comp]
      );
    }
  }

  return { mapped: true, identities: uniqueVerified };
}

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

module.exports = {
  getNormalizedMedications,
  autoMapMedication,
  resolveCandidateGenerics,
};
