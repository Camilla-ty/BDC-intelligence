// Load unit for the submissions JSON of one CIK: the main file and every additional page named in
// its filings.files[] (one source stream, SOURCE_SCHEMAS 7, 7.1). Bodies are stored verbatim and
// flattened by the database; every fact below is projected from raw.json_value with JSON_PATH
// evidence at REGISTRY level. Keys are observed, not documented (P2-D1): the documentation status
// is visible through ref.registry_field_mapping, never promoted.

import { padCik } from "../../lib/config.mjs";
import { copyBlock, lit, num } from "../../lib/db.mjs";
import { inspectSubmissionsMain, inspectSubmissionsPage } from "../../parse/submissions.mjs";
import {
  LOCATION_COLUMNS, artifactBlock, assertCoverage, finishBlock, insertAmendmentDecisions, insertFilings, insertLinks,
  insertRegistrants, prelude, streamBlock, upsertObservations,
} from "../sql.mjs";

// Submissions filing key -> filing attribute and normalization (SOURCE_SCHEMAS 7, 7.2).
const FILING_ATTRIBUTES = [
  ["filingDate", "FILED_DATE", "iso_date"],
  ["reportDate", "REPORT_DATE", "iso_date"],
  ["form", "FORM", "text"],
  ["acceptanceDateTime", "ACCEPTED_AT", "raw"],
  ["fileNumber", "FILE_NUMBER", "raw"],
  ["primaryDocument", "PRIMARY_DOCUMENT_NAME", "text"],
  ["primaryDocDescription", "PRIMARY_DOC_DESCRIPTION", "raw"],
  ["isXBRL", "IS_XBRL", "raw"],
  ["isInlineXBRL", "IS_INLINE_XBRL", "raw"],
];

const REGISTRANT_SCALARS = [["name", "NAME"], ["fiscalYearEnd", "FISCAL_YEAR_END"], ["stateOfIncorporation", "STATE_OF_INCORPORATION"]];
const REGISTRANT_ARRAYS = [["tickers", "TICKER"], ["exchanges", "EXCHANGE"]];

// Decides FILING_HISTORY coverage from the main file's files[] and the pages retrieved for it.
export function filingHistoryState(files, pages) {
  const byName = new Map(pages.map((p) => [p.name, p]));
  const missing = [];
  const mismatched = [];
  for (const f of files) {
    const page = byName.get(f.name);
    if (!page || page.httpStatus !== 200) missing.push(f.name);
    else if (page.length !== f.filingCount) mismatched.push(f.name);
  }
  if (missing.length) return { state: "NOT_INGESTED", rationale: `${missing.length} of ${files.length} additional submissions pages not retrieved` };
  if (mismatched.length) return { state: "NOT_INGESTED", rationale: `${mismatched.length} additional pages differ in entry count from files[].filingCount` };
  return { state: "COVERED", rationale: `Main file and all ${files.length} additional pages loaded; page entry counts equal files[].filingCount` };
}

export function submissionsNotFoundUnit({ cik, runId, rules }) {
  return `${prelude()}
${assertCoverage({
    registrantSql: `(SELECT id FROM registry.registrant WHERE cik = ${num(cik)})`, releaseSql: "NULL::bigint",
    sourceType: "SEC_SUBMISSIONS_JSON", aspect: "FILING_HISTORY", stateSql: "'NOT_INGESTED'", evidenceSql: "NULL::bigint",
    rationaleSql: "'The submissions file for this CIK returned HTTP 404; the filing history is not ingested'",
    ruleId: rules["coverage.registry"], runId, label: "history" })}
DELETE FROM _cov_history WHERE registrant_id IS NULL;
SELECT 'counts', coalesce((SELECT jsonb_object_agg(k, n ORDER BY k) FROM _counts), '{}'::jsonb)::text;
COMMIT;
`;
}

export function submissionsUnit({ cik, main, pages, runId, rules }) {
  const inspected = inspectSubmissionsMain(main.body, cik);
  const problems = [...inspected.problems];
  const loadedPages = [];
  const pageStatus = [];
  for (const p of pages) {
    if (p.entry.http_status !== 200) {
      pageStatus.push({ name: p.name, httpStatus: p.entry.http_status, length: null });
      continue;
    }
    const pi = inspectSubmissionsPage(p.body);
    problems.push(...pi.problems.map((x) => `${p.name}: ${x}`));
    loadedPages.push({ ...p, text: pi.text, length: pi.length });
    pageStatus.push({ name: p.name, httpStatus: 200, length: pi.length });
  }
  if (problems.length) {
    return { stop: `Submissions CIK${padCik(cik)} structure differs from SOURCE_SCHEMAS 7/7.1: ${problems.join("; ")}` };
  }
  const history = filingHistoryState(inspected.files, pageStatus);
  const arts = [{ key: "artifact", entry: main.entry, text: inspected.text, base: '$."filings"."recent"', idx: 0 },
    ...loadedPages.map((p, i) => ({ key: `page_${i + 1}`, entry: p.entry, text: p.text, base: "$", idx: i + 1 }))];

  const kp = (col) => `a.base || '."' || ${col} || '"'`;
  const filingAttrValues = FILING_ATTRIBUTES.map(([k, code, rule], i) => `(${lit(k)}, ${lit(code)}, ${lit(rule)}, ${i + 2})`).join(", ");
  const scalarValues = REGISTRANT_SCALARS.map(([k, code], i) => `(${lit(k)}, ${lit(code)}, ${i + 1})`).join(", ");
  const arrayValues = REGISTRANT_ARRAYS.map(([k, code], i) => `(${lit(k)}, ${lit(code)}, ${i + 10})`).join(", ");

  const sql = `${prelude()}
${arts.map((a) => artifactBlock(a.key, a.entry, runId)).join("\n")}
CREATE TEMP TABLE _bodies (k text, body text) ON COMMIT DROP;
${copyBlock("_bodies", ["k", "body"], arts.map((a) => [a.key, a.text]))}
INSERT INTO raw.json_document (artifact_id, body, run_id)
SELECT pg_temp.ctx(b.k), b.body, ${num(runId)} FROM _bodies b
WHERE NOT EXISTS (SELECT 1 FROM raw.json_document d WHERE d.artifact_id = pg_temp.ctx(b.k))
ORDER BY b.k = 'artifact' DESC, b.k;
${streamBlock("artifact")}
CREATE TEMP TABLE _arts (k text, artifact_id bigint, base text, idx bigint) ON COMMIT DROP;
INSERT INTO _arts VALUES ${arts.map((a) => `(${lit(a.key)}, pg_temp.ctx(${lit(a.key)}), ${lit(a.base)}, ${a.idx})`).join(", ")};

CREATE TEMP TABLE _reg_src (${LOCATION_COLUMNS}, cik bigint) ON COMMIT DROP;
INSERT INTO _reg_src SELECT v.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, v.json_path, 1, v.value_text::bigint
FROM raw.json_value v WHERE v.artifact_id = pg_temp.ctx('artifact') AND v.json_path = '$."cik"';
${insertRegistrants("_reg_src", runId)}
INSERT INTO _ctx SELECT 'registrant', id FROM registry.registrant WHERE cik = ${num(cik)};

CREATE TEMP TABLE _rfact (${LOCATION_COLUMNS}, registrant_id bigint, attribute_code text, raw_value text, normalized_value text, source_as_of date) ON COMMIT DROP;
INSERT INTO _rfact
SELECT v.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, v.json_path, s.o, pg_temp.ctx('registrant'), s.code, v.value_text, NULL::text, NULL::date
FROM (VALUES ${scalarValues}) AS s (k, code, o)
JOIN raw.json_value v ON v.artifact_id = pg_temp.ctx('artifact') AND v.json_path = '$."' || s.k || '"'
WHERE v.value_text IS NOT NULL AND v.value_text <> ''
UNION ALL
SELECT v.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, v.json_path, s.o * 100000 + v.array_index, pg_temp.ctx('registrant'), s.code, v.value_text, NULL::text, NULL::date
FROM (VALUES ${arrayValues}) AS s (k, code, o)
JOIN raw.json_value v ON v.artifact_id = pg_temp.ctx('artifact') AND v.container_path = '$."' || s.k || '"'
WHERE v.value_text IS NOT NULL AND v.value_text <> '';
${upsertObservations({ source: "_rfact", target: "registry.registrant_attribute_observation", subject: ["registrant_id", "attribute_code"], values: ["raw_value"], extra: ["normalized_value", "source_as_of"], ruleId: rules["registry.projection"], runId, label: "registrant_attributes" })}

CREATE TEMP TABLE _nfact (${LOCATION_COLUMNS}, registrant_id bigint, name_raw text, from_raw text, to_raw text) ON COMMIT DROP;
INSERT INTO _nfact
SELECT v.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, v.json_path, e.array_index, pg_temp.ctx('registrant'), v.value_text,
       (SELECT x.value_text FROM raw.json_value x WHERE x.artifact_id = v.artifact_id AND x.json_path = e.json_path || '."from"'),
       (SELECT x.value_text FROM raw.json_value x WHERE x.artifact_id = v.artifact_id AND x.json_path = e.json_path || '."to"')
FROM raw.json_value e
JOIN raw.json_value v ON v.artifact_id = e.artifact_id AND v.json_path = e.json_path || '."name"'
WHERE e.artifact_id = pg_temp.ctx('artifact') AND e.container_path = '$."formerNames"' AND v.value_text IS NOT NULL;
${upsertObservations({ source: "_nfact", target: "registry.registrant_name_history_observation", subject: ["registrant_id"], values: ["name_raw", "from_raw", "to_raw"], ruleId: rules["registry.projection"], runId, label: "name_history" })}

CREATE TEMP TABLE _entries ON COMMIT DROP AS
SELECT a.artifact_id, a.base, a.idx, v.array_index AS i, v.value_text AS accession, v.json_path AS accession_path
FROM _arts a JOIN raw.json_value v ON v.artifact_id = a.artifact_id AND v.container_path = ${kp("'accessionNumber'")};
SELECT pg_temp.fail('submissions accessionNumber is not an accession number') FROM _entries
WHERE accession IS NULL OR accession !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' LIMIT 1;

CREATE TEMP TABLE _fil_src (${LOCATION_COLUMNS}, accession text) ON COMMIT DROP;
INSERT INTO _fil_src SELECT e.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, e.accession_path, e.idx * 100000000 + e.i * 20, e.accession FROM _entries e;
${insertFilings("_fil_src", runId)}

CREATE TEMP TABLE _link_src (${LOCATION_COLUMNS}, accession text, cik bigint, link_source ref.filing_link_source) ON COMMIT DROP;
INSERT INTO _link_src SELECT e.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, e.accession_path, e.idx * 100000000 + e.i * 20, e.accession,
  ${num(cik)}, 'SUBMISSIONS_JSON'::ref.filing_link_source FROM _entries e;
${insertLinks("_link_src", runId)}

CREATE TEMP TABLE _fvals ON COMMIT DROP AS
SELECT e.artifact_id, e.idx, e.i, e.accession, f.id AS filing_id, m.k, m.code, m.rule, m.o, v.json_path, v.value_text
FROM _entries e
JOIN _arts a ON a.artifact_id = e.artifact_id
JOIN registry.filing f ON f.accession_number = e.accession
CROSS JOIN (VALUES ${filingAttrValues}) AS m (k, code, rule, o)
JOIN raw.json_value v ON v.artifact_id = e.artifact_id AND v.json_path = ${kp("m.k")} || '[' || e.i || ']';
INSERT INTO _counts SELECT 'filing_values_null_skipped', count(*) FROM _fvals WHERE value_text IS NULL;

CREATE TEMP TABLE _ffact (${LOCATION_COLUMNS}, filing_id bigint, attribute_code text, raw_value text, value_state ref.value_state,
  normalized_text text, normalized_date date, normalized_timestamp timestamptz) ON COMMIT DROP;
INSERT INTO _ffact
SELECT x.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, x.json_path, x.idx * 100000000 + x.i * 20 + x.o, x.filing_id, x.code, x.value_text,
       (CASE WHEN x.value_text = '' THEN 'UNKNOWN' ELSE 'REPORTED' END)::ref.value_state,
       CASE WHEN x.value_text <> '' AND x.rule = 'text' THEN x.value_text END,
       CASE WHEN x.rule = 'iso_date' THEN pg_temp.strict_date(x.value_text, 'YYYY-MM-DD', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') END,
       NULL::timestamptz
FROM _fvals x WHERE x.value_text IS NOT NULL;
${upsertObservations({ source: "_ffact", target: "registry.filing_attribute_observation", subject: ["filing_id", "attribute_code"], values: ["raw_value"], extra: ["value_state", "normalized_text", "normalized_date", "normalized_timestamp"], ruleId: rules["registry.projection"], runId, label: "filing_attributes" })}

CREATE TEMP TABLE _doc_new ON COMMIT DROP AS
SELECT DISTINCT ON (x.filing_id, x.value_text) x.*,
       format('https://www.sec.gov/Archives/edgar/data/%s/%s/%s', ${num(cik)}, replace(x.accession, '-', ''), x.value_text) AS url
FROM _fvals x
WHERE x.k = 'primaryDocument' AND x.value_text IS NOT NULL AND x.value_text <> ''
  AND NOT EXISTS (SELECT 1 FROM registry.filing_document d WHERE d.filing_id = x.filing_id AND d.document_name = x.value_text
                  AND d.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT')
ORDER BY x.filing_id, x.value_text, x.idx, x.i;
CREATE TEMP TABLE _doc_ev (id bigint, json_path text, artifact_id bigint) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, json_path, run_id)
  SELECT 'REGISTRY'::ref.evidence_level, d.artifact_id, 'JSON_PATH'::ref.locator_type, d.json_path, ${num(runId)} FROM _doc_new d ORDER BY d.idx, d.i
  RETURNING id, json_path, artifact_id)
INSERT INTO _doc_ev SELECT * FROM ins;
INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
SELECT d.filing_id, d.value_text, d.url, 'SUBMISSIONS_PRIMARY_DOCUMENT', ${num(rules["registry.projection"])}, ${num(runId)}, e.id
FROM _doc_new d JOIN _doc_ev e ON e.artifact_id = d.artifact_id AND e.json_path = d.json_path ORDER BY d.idx, d.i;
INSERT INTO _counts SELECT 'primary_documents_added', count(*) FROM _doc_new;

CREATE TEMP TABLE _amend_src (${LOCATION_COLUMNS}, accession text, decided_at timestamptz) ON COMMIT DROP;
INSERT INTO _amend_src SELECT x.artifact_id, 'REGISTRY'::ref.evidence_level, NULL::bigint, NULL::integer, NULL::text, x.json_path, x.idx * 100000000 + x.i * 20 + x.o, x.accession,
  ${lit(main.entry.requested_at)}::timestamptz
FROM _fvals x WHERE x.k = 'form' AND x.value_text ~ '/A$';
${insertAmendmentDecisions("_amend_src", rules["resolution.amends_unresolved"], runId)}

WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, json_path, run_id)
  SELECT 'REGISTRY'::ref.evidence_level, pg_temp.ctx('artifact'), 'JSON_PATH'::ref.locator_type, '$."filings"."files"', ${num(runId)}
  RETURNING id)
INSERT INTO _ctx SELECT 'files_evidence', id FROM ins;
${assertCoverage({
    registrantSql: "pg_temp.ctx('registrant')", releaseSql: "NULL::bigint", sourceType: "SEC_SUBMISSIONS_JSON", aspect: "FILING_HISTORY",
    stateSql: lit(history.state), evidenceSql: "pg_temp.ctx('files_evidence')", rationaleSql: lit(history.rationale),
    ruleId: rules["coverage.registry"], runId, label: "history" })}
INSERT INTO _counts VALUES ('recent_entries', ${inspected.recentLength}), ('files_listed', ${inspected.files.length}),
  ('pages_loaded', ${loadedPages.length}), ('pages_not_retrieved', ${pageStatus.filter((p) => p.httpStatus !== 200).length});
${finishBlock({ keys: arts.map((a) => a.key), ruleId: rules["pipeline.registry_load"], runId, detail: `Submissions CIK${padCik(cik)}: filing history ${history.state}` })}`;
  return { sql, history };
}
