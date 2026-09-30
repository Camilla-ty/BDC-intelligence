#!/usr/bin/env node
// Offline check of docs/SOURCE_SCHEMAS.md, fixtures/sec/manifest.json, and the structure-only
// snapshots: required sections, official hosts only, complete manifest entries, every fixture
// documented, allowed statuses with evidence, full matrix coverage, and no values in snapshots.
// Node built-ins only. SOURCE_SCHEMAS_ROOT overrides the repository root.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  process.env.SOURCE_SCHEMAS_ROOT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

const DOC = "docs/SOURCE_SCHEMAS.md";
const MANIFEST = "fixtures/sec/manifest.json";
const SNAPSHOT_DIR = "fixtures/sec/snapshots";
const OFFICIAL_HOSTS = new Set(["www.sec.gov", "data.sec.gov", "xbrl.sec.gov"]);
const STATUSES = new Set([
  "Available",
  "Partial",
  "Not available",
  "Level 2 extraction required",
  "Not verified",
  "OPEN QUESTION",
]);
const REQUIRED_SECTIONS = [
  "## 1. Source register",
  "## 2. Fair access and request policy",
  "## 3. BDC Data Sets",
  "### 3.1 ",
  "### 3.2 ",
  "### 3.3 ",
  "### 3.4 ",
  "### 3.5 ",
  "### 3.6 ",
  "## 4. Table inventories",
  "## 5. SOI in depth",
  "### 5.1 ",
  "### 5.2 ",
  "### 5.3 ",
  "### 5.4 ",
  "### 5.5 ",
  "### 5.6 ",
  "### 5.7 ",
  "## 6. BDC Report",
  "### 6.1 ",
  "## 7. Submissions JSON",
  "### 7.1 ",
  "### 7.2 ",
  "## 8. EDGAR Archives URL construction",
  "## 9. Identifiers and join keys",
  "## 10. Period semantics",
  "## 11. Amendments and refreshes",
  "## 12. Product field availability matrix",
  "## 13. Fixture register",
  "## 14. Discrepancies",
  "## 15. Open questions",
  "## 16. Verification log and change log",
];
const REGISTER_SOURCES = Array.from({ length: 13 }, (_, i) => `S${i + 1}`);
const MATRIX_FIELDS = {
  Registrant: ["CIK", "Name", "Ticker", "Reporting period", "Accession", "Filing date", "Form", "Manager / adviser", "Status", "Public / private type", "Coverage dates"],
  Holding: ["Raw company name", "Investment description", "Instrument type", "Seniority", "Secured flag", "Industry", "Issuer affiliation"],
  Pricing: ["Interest rate", "Reference rate name", "Spread", "Floor", "Cash / PIK split", "All-in coupon"],
  "Dates and economics": ["Acquisition date", "Maturity", "Principal", "Cost", "Fair value", "% of net assets"],
  "Status flags": ["Non-accrual", "Restricted", "Region / country", "Fair-value level", "Footnotes"],
  "Our provenance": ["Source URL", "Retrieval time", "Parser version"],
  Enrichment: ["Sponsor", "EBITDA", "Leverage", "OID"],
};
const FIXTURE_FIELDS = ["id", "source_id", "source_type", "description", "url", "source_period", "selection_rule", "storage", "cache_path", "retrieval"];
const RETRIEVAL_FIELDS = ["retrieved_at", "final_url", "http_status", "content_type", "bytes", "sha256", "sha256_of"];
const FIXTURE_ID = /\bF\d{2}[a-z]?\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const DECIMAL_AMOUNT = /^-?(\d{1,3}(,\d{3})+|\d+)\.\d+$|^-?\d{1,3}(,\d{3})+$/;

const errors = [];
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

for (const rel of [DOC, MANIFEST, SNAPSHOT_DIR]) {
  if (!existsSync(path.join(repoRoot, rel))) errors.push(`missing required path: ${rel}`);
}
if (errors.length) fail();

const doc = read(DOC);
const docLines = doc.split(/\r?\n/);
let manifest;
try {
  manifest = JSON.parse(read(MANIFEST));
} catch (e) {
  errors.push(`${MANIFEST}: invalid JSON (${e.message})`);
  fail();
}

function checkUrl(where, url, { requireHttps }) {
  let u;
  try {
    u = new URL(url);
  } catch {
    errors.push(`${where}: unparseable URL`);
    return;
  }
  if (!OFFICIAL_HOSTS.has(u.hostname)) errors.push(`${where}: URL host ${u.hostname} is not an official SEC host`);
  if (requireHttps && u.protocol !== "https:") errors.push(`${where}: URL must use https`);
}

// 1. Required sections, source register, no confidential references
const headings = docLines.filter((l) => l.startsWith("#"));
for (const section of REQUIRED_SECTIONS) {
  if (!headings.some((h) => h.startsWith(section))) errors.push(`${DOC}: missing section "${section.trim()}"`);
}
const registerRows = sectionTable("## 1. Source register");
for (const id of REGISTER_SOURCES) {
  if (!registerRows.some((r) => r.cells[0] === id)) errors.push(`${DOC}: source register has no row for ${id}`);
}
if (/\bPRD\b/.test(doc)) errors.push(`${DOC}: must not reference the PRD`);
if (EMAIL.test(doc)) errors.push(`${DOC}: contains an email address`);

// 2. URLs in the document
for (const [i, line] of docLines.entries()) {
  for (const m of line.matchAll(/https?:\/\/[^\s)|`>]+/g)) {
    checkUrl(`${DOC}:${i + 1}`, m[0].replace(/[.,;]+$/, ""), { requireHttps: true });
  }
}

// 3. Manifest entries
const ids = new Set();
if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) errors.push(`${MANIFEST}: no fixtures`);
if (EMAIL.test(JSON.stringify(manifest))) errors.push(`${MANIFEST}: contains an email address`);
for (const host of manifest.request_policy?.allowed_hosts ?? []) {
  if (!OFFICIAL_HOSTS.has(host)) errors.push(`${MANIFEST}: request_policy allows non-SEC host ${host}`);
}
for (const f of manifest.fixtures ?? []) {
  const where = `${MANIFEST} ${f.id ?? "(no id)"}`;
  for (const field of FIXTURE_FIELDS) {
    if (f[field] === undefined || f[field] === null || f[field] === "") errors.push(`${where}: missing ${field}`);
  }
  if (f.id) {
    if (ids.has(f.id)) errors.push(`${where}: duplicate id`);
    ids.add(f.id);
    if (!new RegExp(`\\b${f.id}\\b`).test(doc)) errors.push(`${DOC}: fixture ${f.id} is not referenced`);
  }
  if (f.source_id && !REGISTER_SOURCES.includes(f.source_id)) errors.push(`${where}: unknown source_id ${f.source_id}`);
  if (f.storage && !["cache", "committed"].includes(f.storage)) errors.push(`${where}: storage must be cache or committed`);
  if (f.storage === "cache" && f.cache_path && !f.cache_path.startsWith(".cache/sec/")) {
    errors.push(`${where}: cache_path must be under .cache/sec/`);
  }
  if (f.url) checkUrl(`${where} url`, f.url, { requireHttps: true });
  const r = f.retrieval;
  if (r && typeof r === "object") {
    for (const field of RETRIEVAL_FIELDS) {
      if (r[field] === undefined || r[field] === null || r[field] === "") errors.push(`${where}: retrieval missing ${field}`);
    }
    if (r.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(r.sha256)) errors.push(`${where}: sha256 must be 64 lowercase hex characters`);
    if (r.http_status !== undefined && !(Number.isInteger(r.http_status) && r.http_status >= 200 && r.http_status < 300)) {
      errors.push(`${where}: http_status must be 2xx`);
    }
    if (r.bytes !== undefined && !(Number.isInteger(r.bytes) && r.bytes >= 0)) errors.push(`${where}: bytes must be a non-negative integer`);
    if (r.retrieved_at !== undefined && Number.isNaN(Date.parse(r.retrieved_at))) errors.push(`${where}: retrieved_at is not a date`);
    if (r.final_url) checkUrl(`${where} final_url`, r.final_url, { requireHttps: true });
  }
}

// 4. Status tables: allowed values and evidence for Available rows
function tables() {
  const out = [];
  let section = "";
  for (let i = 0; i < docLines.length; i += 1) {
    if (docLines[i].startsWith("## ")) section = docLines[i];
    if (!docLines[i].startsWith("|") || !docLines[i + 1]?.startsWith("|---")) continue;
    const header = splitRow(docLines[i]);
    const rows = [];
    let j = i + 2;
    for (; j < docLines.length && docLines[j].startsWith("|"); j += 1) rows.push({ line: j + 1, cells: splitRow(docLines[j]) });
    out.push({ section, header, headerLine: docLines[i], rows });
    i = j - 1;
  }
  return out;
}

function splitRow(line) {
  return line
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

function sectionTable(prefix) {
  return tables().filter((t) => t.section.startsWith(prefix)).flatMap((t) => t.rows);
}

let statusRows = 0;
for (const t of tables()) {
  const si = t.header.indexOf("Status");
  if (si < 0 || t.header[1] === "Meaning") continue;
  const ei = t.header.indexOf("Evidence");
  const openQuestions = t.section.startsWith("## 15.");
  for (const row of t.rows) {
    const status = row.cells[si];
    statusRows += 1;
    const allowed = STATUSES.has(status) || (openQuestions && /^Resolved\b/.test(status));
    if (!allowed) errors.push(`${DOC}:${row.line}: status "${status}" is not an allowed value`);
    if (status !== "Available") continue;
    const rowText = row.cells.join(" ");
    if (!FIXTURE_ID.test(rowText) && !FIXTURE_ID.test(t.headerLine)) {
      errors.push(`${DOC}:${row.line}: Available row has no fixture ID`);
    }
    if (ei >= 0 && !/\b(Documented|Observed)\b/.test(row.cells[ei])) {
      errors.push(`${DOC}:${row.line}: Available row lacks Documented or Observed evidence`);
    }
  }
}

// 5. Matrix coverage
const matrix = sectionTable("## 12.");
for (const [group, fields] of Object.entries(MATRIX_FIELDS)) {
  for (const field of fields) {
    if (!matrix.some((r) => r.cells[0] === group && r.cells[1] === field)) {
      errors.push(`${DOC}: availability matrix is missing ${group} / ${field}`);
    }
  }
}
for (const row of matrix) {
  if (row.cells.length < 7 || !row.cells[5]) errors.push(`${DOC}:${row.line}: matrix row needs an evidence cell`);
}

// 6. Snapshots: one per fixture, structure only
const snapshotFiles = readdirSync(path.join(repoRoot, SNAPSHOT_DIR)).filter((f) => f.endsWith(".json")).sort();
const snapshotIds = new Set(snapshotFiles.map((f) => f.replace(/\.json$/, "")));
for (const id of ids) {
  if (!snapshotIds.has(id)) errors.push(`${SNAPSHOT_DIR}: no snapshot for fixture ${id}`);
}
for (const id of snapshotIds) {
  if (!ids.has(id) && id !== "JOINS") errors.push(`${SNAPSHOT_DIR}/${id}.json: not a manifest fixture`);
}

function walk(value, where) {
  if (typeof value === "number") {
    if (!(Number.isInteger(value) && value >= 0)) errors.push(`${where}: numeric leaf is not a non-negative integer`);
  } else if (typeof value === "string") {
    if (DECIMAL_AMOUNT.test(value.trim())) errors.push(`${where}: string looks like a numeric amount`);
    if (EMAIL.test(value)) errors.push(`${where}: string contains an email address`);
    for (const m of value.matchAll(/https?:\/\/[^\s"]+/g)) checkUrl(where, m[0], { requireHttps: false });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${where}[${i}]`));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
  }
}
for (const file of snapshotFiles) {
  const rel = `${SNAPSHOT_DIR}/${file}`;
  try {
    walk(JSON.parse(read(rel)), rel);
  } catch (e) {
    errors.push(`${rel}: invalid JSON (${e.message})`);
  }
}

function fail() {
  console.error("verify:source-schemas failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

if (errors.length > 0) fail();

console.log(
  `verify:source-schemas passed: ${REQUIRED_SECTIONS.length} sections, ${ids.size} fixture(s), ${snapshotFiles.length} snapshot(s), ${statusRows} status row(s)`,
);
