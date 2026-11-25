"use strict";

const LOINC_VITALS = {
  heart_rate: { code: "8867-4", display: "Heart rate", unit: "/min", ucum: "/min" },
  respiratory_rate: { code: "9279-1", display: "Respiratory rate", unit: "/min", ucum: "/min" },
  systolic_bp: { code: "8480-6", display: "Systolic blood pressure", unit: "mmHg", ucum: "mm[Hg]" },
  diastolic_bp: { code: "8462-4", display: "Diastolic blood pressure", unit: "mmHg", ucum: "mm[Hg]" },
  spo2: { code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry", unit: "%", ucum: "%" },
  temperature_celsius: { code: "8310-5", display: "Body temperature", unit: "Cel", ucum: "Cel" },
};

function buildFhirBundle(stay, patient, observations = []) {
  const entries = [];
  const patientRef = `Patient/${patient?.subject_id || stay.subject_id || stay.stay_id}`;

  entries.push({
    fullUrl: patientRef,
    resource: {
      resourceType: "Patient",
      id: String(patient?.subject_id || stay.subject_id || stay.stay_id),
      gender: String(stay.gender || patient?.gender || "unknown").toLowerCase(),
      identifier: [{ system: "urn:bbau:er:subject-id", value: String(stay.subject_id || stay.stay_id) }],
    },
  });

  for (const obs of observations) {
    const effectiveDateTime = obs.observation_time ? new Date(obs.observation_time).toISOString() : new Date().toISOString();
    for (const [field, meta] of Object.entries(LOINC_VITALS)) {
      const val = obs[field];
      if (val === null || val === undefined || val === "") continue;
      const numericVal = Number(val);
      if (!Number.isFinite(numericVal)) continue;

      const obsId = `obs-${obs.observation_id || "live"}-${field}`;
      entries.push({
        fullUrl: `Observation/${obsId}`,
        resource: {
          resourceType: "Observation",
          id: obsId,
          status: "final",
          category: [
            {
              coding: [
                {
                  system: "http://terminology.hl7.org/CodeSystem/observation-category",
                  code: "vital-signs",
                  display: "Vital Signs",
                },
              ],
            },
          ],
          code: {
            coding: [{ system: "http://loinc.org", code: meta.code, display: meta.display }],
            text: meta.display,
          },
          subject: { reference: patientRef },
          encounter: { reference: `Encounter/${stay.stay_id}` },
          effectiveDateTime,
          valueQuantity: {
            value: numericVal,
            unit: meta.unit,
            system: "http://unitsofmeasure.org",
            code: meta.ucum,
          },
        },
      });
    }
  }

  return {
    resourceType: "Bundle",
    id: `er-stay-${stay.stay_id}-fhir`,
    type: "collection",
    timestamp: new Date().toISOString(),
    total: entries.length,
    entry: entries,
  };
}

module.exports = { buildFhirBundle, LOINC_VITALS };
