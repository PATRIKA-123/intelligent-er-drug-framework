"use strict";

// Temperature unit handling for imported observations (audit finding B09).
//
// The MIMIC-IV-ED demo CSV has no unit column. Its data dictionary documents
// temperature in degrees Fahrenheit (CONFIRM THIS WITH THE DATA OWNER), but
// 34 of the 554 values (31.4 - 36.8) can only be Celsius. This module records
// what is known about EACH value instead of guessing silently:
//
//   CONVERTED_FROM_F     value is in the plausible Fahrenheit range (77-113 F),
//                        matching the documented unit -> canonical Celsius set.
//   UNVERIFIED_CELSIUS   value looks like Celsius (25-45) but the documented
//                        unit is Fahrenheit -> canonical Celsius is NOT set
//                        (unless acceptInferredCelsius is chosen).
//   INFERRED_CELSIUS     same value, but the operator explicitly accepted the
//                        inference -> canonical Celsius set, clearly labelled.
//   IMPLAUSIBLE          fits neither range -> never converted, never scored.
//
// The two plausible ranges do not overlap, so a value can never be both.
// The raw value is always kept unchanged in observations.temperature.

const CELSIUS_MIN_C = 25;  // same supported range as services/news2Calculator.js
const CELSIUS_MAX_C = 45;
const FAHRENHEIT_MIN_CENTI = 7700; // 25 C in hundredths of a degree F
const FAHRENHEIT_MAX_CENTI = 11300; // 45 C
const CELSIUS_MIN_CENTI = CELSIUS_MIN_C * 100;
const CELSIUS_MAX_CENTI = CELSIUS_MAX_C * 100;

const STATUS = Object.freeze({
  CONVERTED_FROM_F: "CONVERTED_FROM_F",
  UNVERIFIED_CELSIUS: "UNVERIFIED_CELSIUS",
  INFERRED_CELSIUS: "INFERRED_CELSIUS",
  IMPLAUSIBLE: "IMPLAUSIBLE",
});

// Exact integer arithmetic (no floating point) so the result always equals
// the database's round((F - 32) * 5 / 9, 1): half rounds away from zero.
function fahrenheitCentiToCelsius(centiF) {
  // centiF is hundredths of a degree F. Celsius in tenths of a degree is
  //   (F - 32) * 5/9 * 10 = ((centiF - 3200) / 100) * 5/9 * 10 = (centiF - 3200) * 5 / 90
  // Adding 45 before the whole-number division rounds half up (F >= 32 here).
  const numerator = (centiF - 3200) * 5;
  const tenths = Math.floor((numerator + 45) / 90);
  return tenths / 10;
}

// value: a validated number with at most 2 decimals (see importValidation.js)
function classifyTemperature(value, options = {}) {
  const centi = Math.round(value * 100);

  if (centi >= FAHRENHEIT_MIN_CENTI && centi <= FAHRENHEIT_MAX_CENTI) {
    return { unit: "F", celsius: fahrenheitCentiToCelsius(centi), status: STATUS.CONVERTED_FROM_F };
  }

  if (centi >= CELSIUS_MIN_CENTI && centi <= CELSIUS_MAX_CENTI) {
    if (options.acceptInferredCelsius === true) {
      return { unit: "C", celsius: centi / 100, status: STATUS.INFERRED_CELSIUS };
    }
    return { unit: "C", celsius: null, status: STATUS.UNVERIFIED_CELSIUS };
  }

  return { unit: null, celsius: null, status: STATUS.IMPLAUSIBLE };
}

// Text to store in the database. Keeps the same number of decimals the old view
// showed: converted Fahrenheit values have 1 decimal (like round(..., 1)),
// Celsius values keep the 2 decimals of the source value.
function celsiusForDatabase(info) {
  if (info.celsius === null || info.celsius === undefined) return null;
  return info.status === STATUS.CONVERTED_FROM_F
    ? info.celsius.toFixed(1)
    : info.celsius.toFixed(2);
}

module.exports = { classifyTemperature, celsiusForDatabase, STATUS };
