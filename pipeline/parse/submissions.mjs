// Structural checks on submissions JSON (SOURCE_SCHEMAS 7, 7.1). Facts are projected in the
// database from raw.json_value; this module only validates structure and finds page names.

import { SUBMISSIONS_FILING_KEYS, padCik } from "../lib/config.mjs";

function decode(buffer) {
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) throw new Error("submissions JSON is not valid UTF-8");
  return { text, json: JSON.parse(text) };
}

function checkFilingArrays(obj, where) {
  const keys = Object.keys(obj);
  const missing = SUBMISSIONS_FILING_KEYS.filter((k) => !Array.isArray(obj[k]));
  if (missing.length) return { ok: false, reason: `${where} lacks arrays: ${missing.join(", ")}` };
  const lengths = new Set(SUBMISSIONS_FILING_KEYS.map((k) => obj[k].length));
  if (lengths.size !== 1) return { ok: false, reason: `${where} arrays have different lengths` };
  return { ok: true, length: obj.accessionNumber.length, extraKeys: keys.filter((k) => !SUBMISSIONS_FILING_KEYS.includes(k)) };
}

export function inspectSubmissionsMain(buffer, expectedCik) {
  const { text, json } = decode(buffer);
  const problems = [];
  if (json.cik !== padCik(expectedCik)) problems.push("cik does not equal the CIK in the URL");
  const recent = json.filings?.recent;
  const arrays = recent ? checkFilingArrays(recent, "filings.recent") : { ok: false, reason: "no filings.recent" };
  if (!arrays.ok) problems.push(arrays.reason);
  const files = Array.isArray(json.filings?.files) ? json.filings.files : null;
  if (!files) problems.push("filings.files is not an array");
  return {
    text,
    problems,
    recentLength: arrays.ok ? arrays.length : null,
    files: (files ?? []).map((f) => ({ name: f.name, filingCount: f.filingCount, filingFrom: f.filingFrom, filingTo: f.filingTo })),
  };
}

export function inspectSubmissionsPage(buffer) {
  const { text, json } = decode(buffer);
  const arrays = checkFilingArrays(json, "page");
  const problems = arrays.ok ? (arrays.extraKeys.length ? [`page has unexpected keys: ${arrays.extraKeys.join(", ")}`] : []) : [arrays.reason];
  return { text, problems, length: arrays.ok ? arrays.length : null };
}
