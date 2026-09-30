// Load unit for one BDC data set ZIP (P2-D3): every member is checksummed into raw.artifact_member;
// only datasets/sub.tsv is parsed. SUB rows land exactly as received (cells are the database's tab
// split of the raw line) and are projected into registrants, filings, explicit SUB links, filing
// attributes, UNRESOLVED AMENDS decisions, and FILING_METADATA coverage for the release.

import { SUB_MEMBER_PATH, VERIFIED_SUB_HEADER } from "../../lib/config.mjs";
import { copyBlock, lit, num, queryRows } from "../../lib/db.mjs";
import { parseSubTsv } from "../../parse/sub.mjs";
import { describeMembers, readMember } from "../../parse/zip.mjs";
import {
  LOCATION_COLUMNS, artifactBlock, assertCoverage, finishBlock, insertAmendmentDecisions, insertFilings, insertLinks,
  insertRegistrants, prelude, streamBlock, upsertObservations,
} from "../sql.mjs";

const pos = (label) => VERIFIED_SUB_HEADER.indexOf(label) + 1;

// SUB column -> filing attribute and normalization (SOURCE_SCHEMAS 4.1, 7.2).
const ATTRIBUTES = [
  ["name", "REGISTRANT_NAME_AS_FILED", "raw"],
  ["form", "FORM", "text"],
  ["period", "PERIOD", "yyyymmdd"],
  ["fy", "FISCAL_YEAR", "year"],
  ["fp", "FISCAL_PERIOD", "text"],
  ["filed", "FILED_DATE", "yyyymmdd"],
  ["accepted", "ACCEPTED_AT", "raw"],
  ["prevrpt", "PREVRPT", "raw"],
  ["inlineurl", "INLINE_URL", "text"],
].map(([label, code, rule]) => ({ label, code, rule, position: pos(label) }));

function tableLoadSql({ header, headerSha256, rowCount, mismatches, status, ruleId, runId }) {
  return `
WITH ins AS (
  INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
  VALUES (pg_temp.ctx('artifact'), pg_temp.ctx('sub_member'), 'SUB', E'\\t', ARRAY[${header.map(lit).join(", ")}]::text[],
          ${lit(headerSha256)}, ${num(ruleId)}, ${num(rowCount)}, ${num(mismatches)}, ${lit(status)}::ref.parse_status, ${num(runId)})
  RETURNING id)
INSERT INTO _ctx SELECT 'load', id FROM ins;
`;
}

export async function datasetZipUnit({ database, entry, zipPath, runId, rules }) {
  const release = queryRows(database, `SELECT r.id, r.release_label FROM registry.dataset_release r
JOIN registry.dataset_release_listing l ON l.dataset_release_id = r.id
WHERE 'https://www.sec.gov' || l.link_href = ${lit(entry.url)} ORDER BY l.id DESC LIMIT 1;`)[0];
  const finish = (outcome, detail) => finishBlock({ keys: ["artifact"], ruleId: rules["pipeline.registry_load"], runId, outcome, detail });
  if (!release) {
    return { sql: `${prelude()}${artifactBlock("artifact", entry, runId)}${finish("NOT_IN_SCOPE", "Not listed on any loaded Data Sets page retrieval")}` };
  }
  const [releaseId, releaseLabel] = [Number(release[0]), release[1]];
  const members = await describeMembers(zipPath);
  const memberRows = members.map((m) => [m.memberPath, m.byteSize, m.sha256]);
  const head = `${prelude()}
${artifactBlock("artifact", entry, runId)}
${streamBlock("artifact")}
INSERT INTO _ctx VALUES ('release', ${num(releaseId)});
INSERT INTO registry.dataset_release_artifact (dataset_release_id, artifact_id, run_id)
SELECT pg_temp.ctx('release'), pg_temp.ctx('artifact'), ${num(runId)}
WHERE NOT EXISTS (SELECT 1 FROM registry.dataset_release_artifact x WHERE x.dataset_release_id = pg_temp.ctx('release') AND x.artifact_id = pg_temp.ctx('artifact'));
CREATE TEMP TABLE _members (member_path text, byte_size bigint, sha256 text) ON COMMIT DROP;
${copyBlock("_members", ["member_path", "byte_size", "sha256"], memberRows)}
INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
SELECT pg_temp.ctx('artifact'), m.member_path, m.byte_size, m.sha256, ${num(runId)} FROM _members m
WHERE NOT EXISTS (SELECT 1 FROM raw.artifact_member x WHERE x.artifact_id = pg_temp.ctx('artifact') AND x.member_path = m.member_path)
ORDER BY m.member_path;
INSERT INTO _counts VALUES ('zip_members', ${members.length});
`;
  if (!members.some((m) => m.memberPath === SUB_MEMBER_PATH)) {
    return { sql: `${head}${finish("SCHEMA_DRIFT", `Release ${releaseLabel}: ${SUB_MEMBER_PATH} is missing from the archive`)}`,
      stop: `Release ${releaseLabel} has no ${SUB_MEMBER_PATH}` };
  }
  const sub = parseSubTsv(readMember(zipPath, SUB_MEMBER_PATH));
  const memberCtx = `INSERT INTO _ctx SELECT 'sub_member', id FROM raw.artifact_member WHERE artifact_id = pg_temp.ctx('artifact') AND member_path = ${lit(SUB_MEMBER_PATH)};\n`;
  if (!sub.headerMatches) {
    const tl = sub.header.length ? tableLoadSql({ header: sub.header, headerSha256: sub.headerSha256, rowCount: 0, mismatches: 0, status: "SCHEMA_DRIFT", ruleId: rules["parser.sec_sub_tsv"], runId }) : "";
    return { sql: `${head}${memberCtx}${tl}${finish("SCHEMA_DRIFT", `Release ${releaseLabel}: SUB header differs from the verified layout (SOURCE_SCHEMAS 4.1); not loaded`)}`,
      stop: `Release ${releaseLabel}: SUB header differs from the verified layout` };
  }

  const width = VERIFIED_SUB_HEADER.length;
  const mismatches = sub.rows.filter((r) => r.raw.split("\t").length !== width).length;
  const attrValues = ATTRIBUTES.map((a) => `(${a.position}, ${lit(a.label)}, ${lit(a.code)}, ${lit(a.rule)})`).join(", ");
  const retrievedAt = lit(entry.requested_at);

  const sql = `${head}${memberCtx}
${tableLoadSql({ header: sub.header, headerSha256: sub.headerSha256, rowCount: sub.rows.length, mismatches, status: "OK", ruleId: rules["parser.sec_sub_tsv"], runId })}
CREATE TEMP TABLE _tsv (line_number bigint, raw_line text) ON COMMIT DROP;
${copyBlock("_tsv", ["line_number", "raw_line"], sub.rows.map((r) => [r.lineNumber, r.raw]))}
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT pg_temp.ctx('load'), t.line_number, t.raw_line, encode(sha256(convert_to(t.raw_line, 'UTF8')), 'hex'),
       string_to_array(t.raw_line, E'\\t'), cardinality(string_to_array(t.raw_line, E'\\t')),
       (CASE WHEN cardinality(string_to_array(t.raw_line, E'\\t')) = ${width} THEN 'OK' ELSE 'FIELD_COUNT_MISMATCH' END)::ref.parse_status,
       ${num(runId)}
FROM _tsv t ORDER BY t.line_number;
CREATE TEMP TABLE _rows ON COMMIT DROP AS
SELECT r.id AS tabular_row_id, r.line_number, r.cells FROM raw.tabular_row r
WHERE r.table_load_id = pg_temp.ctx('load') AND r.parse_status = 'OK';
SELECT pg_temp.fail('SUB cik cell is not a CIK') FROM _rows WHERE cells[${pos("cik")}] !~ '^[0-9]{1,10}$' LIMIT 1;
SELECT pg_temp.fail('SUB adsh cell is not an accession number') FROM _rows WHERE cells[${pos("adsh")}] !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' LIMIT 1;

CREATE TEMP TABLE _reg_src (${LOCATION_COLUMNS}, cik bigint) ON COMMIT DROP;
INSERT INTO _reg_src SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, ${pos("cik")}, 'cik', NULL,
  r.line_number * 100 + ${pos("cik")}, r.cells[${pos("cik")}]::bigint FROM _rows r;
${insertRegistrants("_reg_src", runId)}

CREATE TEMP TABLE _fil_src (${LOCATION_COLUMNS}, accession text) ON COMMIT DROP;
INSERT INTO _fil_src SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, ${pos("adsh")}, 'adsh', NULL,
  r.line_number * 100 + ${pos("adsh")}, r.cells[${pos("adsh")}] FROM _rows r;
${insertFilings("_fil_src", runId)}

CREATE TEMP TABLE _link_src (${LOCATION_COLUMNS}, accession text, cik bigint, link_source ref.filing_link_source) ON COMMIT DROP;
INSERT INTO _link_src SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, ${pos("cik")}, 'cik', NULL,
  r.line_number * 100 + ${pos("cik")}, r.cells[${pos("adsh")}], r.cells[${pos("cik")}]::bigint, 'SUB_TABLE'::ref.filing_link_source FROM _rows r;
${insertLinks("_link_src", runId)}

CREATE TEMP TABLE _ffact (${LOCATION_COLUMNS}, filing_id bigint, attribute_code text, raw_value text, value_state ref.value_state,
  normalized_text text, normalized_date date, normalized_timestamp timestamptz) ON COMMIT DROP;
INSERT INTO _ffact
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, a.p, a.label, NULL, r.line_number * 100 + a.p,
       f.id, a.code, r.cells[a.p],
       (CASE WHEN r.cells[a.p] = '' THEN 'UNKNOWN' ELSE 'REPORTED' END)::ref.value_state,
       CASE WHEN r.cells[a.p] = '' THEN NULL
            WHEN a.rule = 'text' THEN r.cells[a.p]
            WHEN a.rule = 'year' THEN CASE WHEN r.cells[a.p] ~ '^[0-9]{4}$' THEN r.cells[a.p] ELSE pg_temp.fail('SUB fy is not a four-digit year') END END,
       CASE WHEN a.rule = 'yyyymmdd' THEN pg_temp.strict_date(r.cells[a.p], 'YYYYMMDD', '^[0-9]{8}$') END,
       NULL::timestamptz
FROM _rows r
JOIN registry.filing f ON f.accession_number = r.cells[${pos("adsh")}]
CROSS JOIN (VALUES ${attrValues}) AS a (p, label, code, rule);
${upsertObservations({ source: "_ffact", target: "registry.filing_attribute_observation", subject: ["filing_id", "attribute_code"], values: ["raw_value"], extra: ["value_state", "normalized_text", "normalized_date", "normalized_timestamp"], ruleId: rules["registry.projection"], runId, label: "filing_attributes" })}

CREATE TEMP TABLE _amend_src (${LOCATION_COLUMNS}, accession text, decided_at timestamptz) ON COMMIT DROP;
INSERT INTO _amend_src SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, ${pos("form")}, 'form', NULL,
  r.line_number * 100 + ${pos("form")}, r.cells[${pos("adsh")}], ${retrievedAt}::timestamptz
FROM _rows r WHERE r.cells[${pos("form")}] ~ '/A$';
${insertAmendmentDecisions("_amend_src", rules["resolution.amends_unresolved"], runId)}

WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, artifact_member_id, run_id)
  VALUES ('L1_STRUCTURED_DATASET'::ref.evidence_level, pg_temp.ctx('artifact'), 'DOCUMENT'::ref.locator_type, pg_temp.ctx('sub_member'), ${num(runId)})
  RETURNING id)
INSERT INTO _ctx SELECT 'member_evidence', id FROM ins;
${assertCoverage({
    registrantSql: "NULL::bigint", releaseSql: "pg_temp.ctx('release')", sourceType: "SEC_BDC_DATASET_ZIP", aspect: "FILING_METADATA",
    stateSql: `CASE WHEN (SELECT count(*) FROM _rows) > 0 THEN 'COVERED' ELSE 'EMPTY_PERIOD' END`,
    evidenceSql: "pg_temp.ctx('member_evidence')",
    rationaleSql: `format('SUB table of release %s loaded: %s rows', ${lit(releaseLabel)}, (SELECT count(*) FROM _rows))`,
    ruleId: rules["coverage.registry"], runId, label: "release" })}
CREATE TEMP TABLE _cov_reg ON COMMIT DROP AS
SELECT x.* FROM (
  SELECT DISTINCT ON (g.id) g.id AS registrant_id, r.tabular_row_id,
         (SELECT h.id FROM ops.coverage_assertion h
          WHERE h.registrant_id = g.id AND h.dataset_release_id = pg_temp.ctx('release') AND h.reporting_period_end IS NULL
            AND h.source_type_code = 'SEC_BDC_DATASET_ZIP' AND h.coverage_aspect = 'FILING_METADATA'
            AND NOT EXISTS (SELECT 1 FROM ops.coverage_assertion s WHERE s.supersedes_id = h.id)) AS head_id
  FROM _rows r JOIN registry.registrant g ON g.cik = r.cells[${pos("cik")}]::bigint
  ORDER BY g.id, r.line_number) x
WHERE x.head_id IS NULL OR (SELECT h.coverage_state FROM ops.coverage_assertion h WHERE h.id = x.head_id) <> 'COVERED';
CREATE TEMP TABLE _cov_reg_ev (id bigint, tabular_row_id bigint) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
  SELECT 'L1_STRUCTURED_DATASET'::ref.evidence_level, pg_temp.ctx('artifact'), 'TSV_ROW'::ref.locator_type, c.tabular_row_id, ${num(runId)} FROM _cov_reg c ORDER BY c.registrant_id
  RETURNING id, tabular_row_id)
INSERT INTO _cov_reg_ev SELECT * FROM ins;
INSERT INTO ops.coverage_assertion (registrant_id, dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id,
    rationale, rule_version_id, run_id, supersedes_id, supersede_reason)
SELECT c.registrant_id, pg_temp.ctx('release'), 'SEC_BDC_DATASET_ZIP', 'FILING_METADATA', 'COVERED', e.id,
       format('Registrant has SUB rows in release %s', ${lit(releaseLabel)}), ${num(rules["coverage.registry"])}, ${num(runId)},
       c.head_id, CASE WHEN c.head_id IS NOT NULL THEN 'coverage state changed in a newer retrieval' END
FROM _cov_reg c JOIN _cov_reg_ev e ON e.tabular_row_id = c.tabular_row_id
ORDER BY c.registrant_id;
INSERT INTO _counts VALUES ('sub_rows', ${sub.rows.length}), ('sub_field_count_mismatch_rows', ${mismatches}),
  ('sub_rows_with_carriage_return', ${sub.carriageReturns});
INSERT INTO _counts SELECT 'coverage_registrants_asserted', count(*) FROM _cov_reg;
${finish("LOADED", `Release ${releaseLabel}: SUB loaded`)}`;
  return { sql };
}
