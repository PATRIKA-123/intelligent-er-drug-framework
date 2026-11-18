// Row validation for the vitals CSV import (audit finding B08).
//
// Rules here are DATA-VALIDITY rules (can this value be stored faithfully?),
// not clinical rules. Unusual-but-possible values (for example a very low
// blood pressure) are NOT rejected here; flagging those is a separate step (B17).
//
// Nothing is rounded or corrected. A value is either stored exactly as given
// or the row is reported with its row number, field and reason.

const NUMERIC_VITALS = [
  { field: "temperature" },
  { field: "heart_rate" },
  { field: "respiratory_rate" },
  { field: "spo2", max: 100, maxReason: "SpO2 cannot be above 100" },
  { field: "systolic_bp" },
];

// observations vital columns are numeric(5,2): at most 999.99, 2 decimals.
const MAX_STORABLE = 999.99;
const MAX_DECIMALS = 2;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/; // rejects NaN, Infinity, 1e3, 0x10, "1,5"

function parseVital({ field, max, maxReason }, raw) {
  if (raw === undefined || raw === null) return { error: "value is missing" };

  const text = String(raw).trim();
  if (text === "") return { error: "value is empty" };
  if (!PLAIN_NUMBER.test(text)) return { error: "not a plain number" };

  const value = Number(text);
  if (!Number.isFinite(value)) return { error: "not a finite number" };
  if (value <= 0) return { error: "must be greater than 0" };
  if (max !== undefined && value > max) return { error: maxReason };
  if (value > MAX_STORABLE) return { error: `too large for the database column (max ${MAX_STORABLE})` };

  const decimals = (text.split(".")[1] || "").replace(/0+$/, "");
  if (decimals.length > MAX_DECIMALS) {
    return { error: `more than ${MAX_DECIMALS} decimal places (the database would silently round it)` };
  }

  return { value };
}

function parseId(raw) {
  const text = String(raw === undefined || raw === null ? "" : raw).trim();
  if (!/^\d{1,18}$/.test(text) || Number(text) <= 0) return null;
  return text; // keep as text: ids are bigint
}

function parseTimestamp(raw) {
  const text = String(raw === undefined || raw === null ? "" : raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const sameParts =
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d &&
    date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === s;
  return sameParts ? text : null;
}

// rowNumber is the line number in the CSV file (header is line 1).
function validateRow(row, rowNumber) {
  const problems = [];
  const add = (field, value, reason) =>
    problems.push({ row: rowNumber, field, value: value === undefined ? "" : String(value), reason });

  const subject_id = parseId(row.subject_id);
  if (subject_id === null) add("subject_id", row.subject_id, "must be a positive whole number");

  const stay_id = parseId(row.stay_id);
  if (stay_id === null) add("stay_id", row.stay_id, "must be a positive whole number");

  const timestamp = parseTimestamp(row.timestamp);
  if (timestamp === null) add("timestamp", row.timestamp, "must be a real date/time like 2147-11-14 18:23:00");

  const data_source = String(row.data_source === undefined || row.data_source === null ? "" : row.data_source).trim();
  if (data_source === "") add("data_source", row.data_source, "value is empty");
  else if (data_source.length > 50) add("data_source", row.data_source, "longer than 50 characters");

  const vitals = {};
  for (const spec of NUMERIC_VITALS) {
    const parsed = parseVital(spec, row[spec.field]);
    if (parsed.error) add(spec.field, row[spec.field], parsed.error);
    else vitals[spec.field] = parsed.value;
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, values: { subject_id, stay_id, timestamp, data_source, ...vitals } };
}

// records[0] is CSV line 2 (line 1 is the header).
function validateAll(records) {
  const validRows = [];
  const problems = [];
  records.forEach((row, index) => {
    const result = validateRow(row, index + 2);
    if (result.ok) validRows.push(result.values);
    else problems.push(...result.problems);
  });
  const rejectedRowCount = new Set(problems.map((p) => p.row)).size;
  return { validRows, problems, rejectedRowCount };
}

module.exports = { validateRow, validateAll, MAX_STORABLE, MAX_DECIMALS };
