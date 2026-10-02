// Load unit for soi.tsv of a BDC data set ZIP already processed by registry:load (P3-D1).
// Identity is location (table_load + line_number). Duplicates and multiple ddates are kept.
// Filing linkage is the adsh cell = registry.filing.accession_number only (never the prefix).

import { SOI_MEMBER_PATH, VERIFIED_SOI_PRESET_HEADER } from "../../lib/config.mjs";
import { copyBlock, lit, num, queryRows } from "../../lib/db.mjs";
import { parseSoiTsv } from "../../parse/soi.mjs";
import { listMembers, readMember } from "../../parse/zip.mjs";
import { LOCATION_COLUMNS, artifactBlock, assertCoverage, finishBlock, prelude } from "../sql.mjs";

const pos = (label) => VERIFIED_SOI_PRESET_HEADER.indexOf(label) + 1;
const ADSH = pos("adsh");
const CIK = pos("cik");
const DDATE = pos("ddate");
const QTRS = pos("qtrs");
const IDENT = pos("Investment, Identifier Axis");

function tableLoadSql({ header, headerSha256, rowCount, mismatches, status, ruleId, runId }) {
  const headerSql = header.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[${header.map(lit).join(", ")}]::text[]`;
  return `
WITH ins AS (
  INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
  VALUES (pg_temp.ctx('artifact'), pg_temp.ctx('soi_member'), 'SOI', E'\\t', ${headerSql},
          ${lit(headerSha256)}, ${num(ruleId)}, ${num(rowCount)}, ${num(mismatches)}, ${lit(status)}::ref.parse_status, ${num(runId)})
  RETURNING id)
INSERT INTO _ctx SELECT 'load', id FROM ins;
`;
}

function finish(rules, runId, outcome, detail) {
  return finishBlock({
    keys: ["artifact"], ruleId: rules["pipeline.soi_load"], runId, outcome, detail,
    actor: "pipeline soi:load",
  });
}

export function registryZipStatus(database, entry, registryLoadRuleId) {
  const rows = queryRows(database, `SELECT a.id::text, coalesce(p.outcome, '')
FROM raw.artifact a
LEFT JOIN ops.artifact_processing p ON p.artifact_id = a.id AND p.rule_version_id = ${num(registryLoadRuleId)}
WHERE a.source_url = ${lit(entry.url)} AND a.sha256 = ${lit(entry.sha256)}
ORDER BY p.id DESC NULLS LAST LIMIT 1;`);
  if (!rows.length) return { artifactId: null, outcome: null };
  return { artifactId: Number(rows[0][0]), outcome: rows[0][1] || null };
}

export async function datasetSoiUnit({ database, entry, zipPath, runId, rules }) {
  const release = queryRows(database, `SELECT r.id, r.release_label
FROM registry.dataset_release r
JOIN registry.dataset_release_artifact x ON x.dataset_release_id = r.id
JOIN raw.artifact a ON a.id = x.artifact_id
WHERE a.source_url = ${lit(entry.url)} AND a.sha256 = ${lit(entry.sha256)}
ORDER BY r.id DESC LIMIT 1;`)[0];
  const head = `${prelude()}
${artifactBlock("artifact", entry, runId)}
`;
  if (!release) {
    return { sql: `${head}${finish(rules, runId, "NOT_IN_SCOPE", "ZIP is not attached to a loaded data-set release")}` };
  }
  const [releaseId, releaseLabel] = [Number(release[0]), release[1]];
  const names = listMembers(zipPath);
  const memberCtx = `
INSERT INTO _ctx VALUES ('release', ${num(releaseId)});
INSERT INTO _ctx SELECT 'soi_member', id FROM raw.artifact_member
 WHERE artifact_id = pg_temp.ctx('artifact') AND member_path = ${lit(SOI_MEMBER_PATH)};
`;

  if (!names.includes(SOI_MEMBER_PATH)) {
    const sql = `${head}${memberCtx}
${assertCoverage({
    registrantSql: "NULL::bigint", releaseSql: "pg_temp.ctx('release')", sourceType: "SEC_BDC_DATASET_ZIP",
    aspect: "SOI_HOLDINGS", stateSql: "'NOT_INGESTED'", evidenceSql: "NULL::bigint",
    rationaleSql: `format('Release %s has no ${SOI_MEMBER_PATH} member', ${lit(releaseLabel)})`,
    ruleId: rules["coverage.soi"], runId, label: "release" })}
INSERT INTO _counts VALUES ('soi_member_missing', 1);
${finish(rules, runId, "SCHEMA_DRIFT", `Release ${releaseLabel}: ${SOI_MEMBER_PATH} is missing from the archive`)}`;
    return { sql, stop: `Release ${releaseLabel} has no ${SOI_MEMBER_PATH}` };
  }

  const body = readMember(zipPath, SOI_MEMBER_PATH);
  const soi = parseSoiTsv(body);
  const parserId = rules["parser.sec_soi_tsv"];
  const projId = rules["obs.projection.soi"];
  const valId = rules["validation.soi_adsh_cik"];
  const memberEvidence = `
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, artifact_member_id, run_id)
  VALUES ('L1_STRUCTURED_DATASET'::ref.evidence_level, pg_temp.ctx('artifact'), 'DOCUMENT'::ref.locator_type,
          pg_temp.ctx('soi_member'), ${num(runId)})
  RETURNING id)
INSERT INTO _ctx SELECT 'member_evidence', id FROM ins;
`;

  if (soi.emptyFile) {
    const sql = `${head}${memberCtx}
${tableLoadSql({ header: [], headerSha256: soi.headerSha256, rowCount: 0, mismatches: 0, status: "OK", ruleId: parserId, runId })}
${memberEvidence}
${assertCoverage({
    registrantSql: "NULL::bigint", releaseSql: "pg_temp.ctx('release')", sourceType: "SEC_BDC_DATASET_ZIP",
    aspect: "SOI_HOLDINGS", stateSql: "'EMPTY_PERIOD'", evidenceSql: "pg_temp.ctx('member_evidence')",
    rationaleSql: `format('Release %s soi.tsv is 0 bytes (no header, no rows)', ${lit(releaseLabel)})`,
    ruleId: rules["coverage.soi"], runId, label: "release" })}
INSERT INTO _counts VALUES ('soi_empty_member', 1), ('soi_rows', 0);
${finish(rules, runId, "LOADED", `Release ${releaseLabel}: SOI empty member`)}`;
    return { sql };
  }

  if (!soi.presetHeaderMatches) {
    const sql = `${head}${memberCtx}
${tableLoadSql({ header: soi.header, headerSha256: soi.headerSha256, rowCount: 0, mismatches: 0, status: "SCHEMA_DRIFT", ruleId: parserId, runId })}
${memberEvidence}
${assertCoverage({
    registrantSql: "NULL::bigint", releaseSql: "pg_temp.ctx('release')", sourceType: "SEC_BDC_DATASET_ZIP",
    aspect: "SOI_HOLDINGS", stateSql: "'NOT_INGESTED'", evidenceSql: "pg_temp.ctx('member_evidence')",
    rationaleSql: `format('Release %s SOI preset header differs from SOURCE_SCHEMAS 5.1; not loaded', ${lit(releaseLabel)})`,
    ruleId: rules["coverage.soi"], runId, label: "release" })}
${finish(rules, runId, "SCHEMA_DRIFT", `Release ${releaseLabel}: SOI preset header differs from the verified layout (SOURCE_SCHEMAS 5.1); not loaded`)}`;
    return { sql, stop: `Release ${releaseLabel}: SOI preset header differs from the verified layout` };
  }

  const width = soi.header.length;
  const mismatches = soi.rows.filter((r) => r.raw.split("\t").length !== width).length;

  const sql = `${head}${memberCtx}
${tableLoadSql({ header: soi.header, headerSha256: soi.headerSha256, rowCount: soi.rows.length, mismatches, status: "OK", ruleId: parserId, runId })}
CREATE TEMP TABLE _tsv (line_number bigint, raw_line text) ON COMMIT DROP;
${copyBlock("_tsv", ["line_number", "raw_line"], soi.rows.map((r) => [r.lineNumber, r.raw]))}
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT pg_temp.ctx('load'), t.line_number, t.raw_line, encode(sha256(convert_to(t.raw_line, 'UTF8')), 'hex'),
       string_to_array(t.raw_line, E'\\t'), cardinality(string_to_array(t.raw_line, E'\\t')),
       (CASE WHEN cardinality(string_to_array(t.raw_line, E'\\t')) = ${width} THEN 'OK' ELSE 'FIELD_COUNT_MISMATCH' END)::ref.parse_status,
       ${num(runId)}
FROM _tsv t ORDER BY t.line_number;

CREATE TEMP TABLE _mismatch (${LOCATION_COLUMNS}) ON COMMIT DROP;
INSERT INTO _mismatch
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.id, NULL, NULL, NULL, r.line_number
FROM raw.tabular_row r WHERE r.table_load_id = pg_temp.ctx('load') AND r.parse_status = 'FIELD_COUNT_MISMATCH'
ORDER BY r.line_number;
CREATE TEMP TABLE _mismatch_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _mismatch s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _mismatch_ev SELECT * FROM ins;
INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
SELECT pg_temp.ctx('load'), s.tabular_row_id, 'FIELD_COUNT_MISMATCH',
       'SOI line field count does not equal the header width; row kept, not projected (SOURCE_SCHEMAS 4.8)',
       e.id, ${num(projId)}, ${num(runId)}
FROM _mismatch s JOIN _mismatch_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

CREATE TEMP TABLE _ok ON COMMIT DROP AS
SELECT r.id AS tabular_row_id, r.line_number, r.cells
FROM raw.tabular_row r
WHERE r.table_load_id = pg_temp.ctx('load') AND r.parse_status = 'OK';
SELECT pg_temp.fail('SOI adsh cell is not an accession number') FROM _ok WHERE cells[${ADSH}] !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' LIMIT 1;
SELECT pg_temp.fail('SOI cik cell is not a CIK') FROM _ok WHERE cells[${CIK}] !~ '^[0-9]{1,10}$' LIMIT 1;
SELECT pg_temp.strict_date(cells[${DDATE}], 'YYYY-MM-DD', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') FROM _ok;
SELECT pg_temp.fail('SOI qtrs is not a non-negative integer') FROM _ok WHERE cells[${QTRS}] !~ '^[0-9]+$' LIMIT 1;

CREATE TEMP TABLE _maps ON COMMIT DROP AS
SELECT m.mapping_id, m.column_label, m.field_code, fd.value_type, fd.unit_kind,
       array_position(tl.header, m.column_label) AS pos
FROM raw.table_load tl
JOIN ref.current_column_mapping m ON m.source_table_code = 'SOI' AND m.mapping_target = 'POSITION_FIELD'
JOIN ref.field_definition fd ON fd.field_code = m.field_code
WHERE tl.id = pg_temp.ctx('load') AND array_position(tl.header, m.column_label) IS NOT NULL;
SELECT pg_temp.fail('SOI monetary cell is not a decimal')
FROM _ok r JOIN _maps m ON m.value_type = 'NUMERIC' AND m.unit_kind = 'MONETARY'
WHERE r.cells[${IDENT}] <> '' AND r.cells[m.pos] <> '' AND r.cells[m.pos] !~ '^-?[0-9]+(\\.[0-9]+)?$' LIMIT 1;
SELECT pg_temp.strict_date(r.cells[m.pos], 'YYYY-MM-DD', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
FROM _ok r JOIN _maps m ON m.value_type = 'DATE'
WHERE r.cells[${IDENT}] <> '' AND r.cells[m.pos] <> '';

CREATE TEMP TABLE _orphan (${LOCATION_COLUMNS}) ON COMMIT DROP;
INSERT INTO _orphan
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, NULL, NULL, NULL, r.line_number
FROM _ok r
WHERE NOT EXISTS (SELECT 1 FROM registry.filing f WHERE f.accession_number = r.cells[${ADSH}])
ORDER BY r.line_number;
CREATE TEMP TABLE _orphan_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _orphan s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _orphan_ev SELECT * FROM ins;
INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
SELECT pg_temp.ctx('load'), s.tabular_row_id, 'ORPHAN_ADSH',
       'SOI adsh cell has no registry.filing row; raw line kept, observation not created; accession prefix was not used',
       e.id, ${num(projId)}, ${num(runId)}
FROM _orphan s JOIN _orphan_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

CREATE TEMP TABLE _matched ON COMMIT DROP AS
SELECT r.*, f.id AS filing_id
FROM _ok r
JOIN registry.filing f ON f.accession_number = r.cells[${ADSH}]
WHERE NOT EXISTS (SELECT 1 FROM _orphan o WHERE o.tabular_row_id = r.tabular_row_id);

CREATE TEMP TABLE _row_src (${LOCATION_COLUMNS}, filing_id bigint, reported_date_raw text, reported_date date,
  qtrs_raw text, qtrs integer, duration_kind ref.duration_kind, identifier_raw text) ON COMMIT DROP;
INSERT INTO _row_src
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, NULL, NULL, NULL, r.line_number,
       r.filing_id, r.cells[${DDATE}], pg_temp.strict_date(r.cells[${DDATE}], 'YYYY-MM-DD', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
       r.cells[${QTRS}], r.cells[${QTRS}]::integer,
       (CASE WHEN r.cells[${QTRS}]::integer = 0 THEN 'POINT_IN_TIME' ELSE 'DURATION' END)::ref.duration_kind,
       nullif(r.cells[${IDENT}], '')
FROM _matched r ORDER BY r.line_number;
CREATE TEMP TABLE _row_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _row_src s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _row_ev SELECT * FROM ins;

INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date, date_precision,
    qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
SELECT s.tabular_row_id, s.filing_id, s.reported_date_raw, s.reported_date, 'MONTH_END_ROUNDED',
       s.qtrs_raw, s.qtrs, s.duration_kind, s.identifier_raw, ${num(projId)}, e.id, ${num(runId)}
FROM _row_src s JOIN _row_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

-- Cell-only kind. SUBTOTAL_ROW and DIMENSION_FACT_ROW are later superseding
-- classifications that cite filing evidence. An empty identifier cell stays null.
INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
SELECT o.id,
       (CASE WHEN o.identifier_raw IS NULL THEN 'NO_IDENTIFIER_ROW' ELSE 'IDENTIFIER_ROW' END)::ref.row_kind,
       'UNRESOLVED'::ref.period_role, ${num(projId)}, ${num(runId)}
FROM obs.soi_row_observation o
JOIN raw.tabular_row r ON r.id = o.tabular_row_id
WHERE r.table_load_id = pg_temp.ctx('load') AND o.rule_version_id = ${num(projId)}
ORDER BY o.id;

INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date, date_precision,
    duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
SELECT o.id, o.filing_id, o.reported_date, o.date_precision, o.duration_kind, o.identifier_raw, ${num(projId)}, o.evidence_id, ${num(runId)}
FROM obs.soi_row_observation o
JOIN raw.tabular_row r ON r.id = o.tabular_row_id
WHERE r.table_load_id = pg_temp.ctx('load') AND o.rule_version_id = ${num(projId)} AND o.identifier_raw IS NOT NULL
ORDER BY o.id;

INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
SELECT p.id, p.origin_soi_row_observation_id, 'PRIMARY'::ref.source_role, ${num(runId)}
FROM obs.position_observation p
JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
JOIN raw.tabular_row r ON r.id = o.tabular_row_id
WHERE r.table_load_id = pg_temp.ctx('load') AND p.rule_version_id = ${num(projId)}
ORDER BY p.id;

CREATE TEMP TABLE _fv_src (${LOCATION_COLUMNS}, position_observation_id bigint, field_code text, column_mapping_id bigint,
  source_column_label text, source_column_position integer, raw_value text, normalized_numeric numeric, normalized_date date,
  normalized_text text, scale_state ref.scale_state) ON COMMIT DROP;
INSERT INTO _fv_src
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, m.pos, m.column_label, NULL,
       r.line_number * 1000 + m.pos, p.id, m.field_code, m.mapping_id, m.column_label, m.pos, r.cells[m.pos],
       CASE WHEN m.value_type = 'NUMERIC' AND m.unit_kind = 'MONETARY' THEN r.cells[m.pos]::numeric END,
       CASE WHEN m.value_type = 'DATE' THEN pg_temp.strict_date(r.cells[m.pos], 'YYYY-MM-DD', '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') END,
       CASE WHEN m.value_type = 'TEXT' THEN r.cells[m.pos] END,
       CASE WHEN m.unit_kind IN ('RATE', 'PERCENT') THEN 'UNRESOLVED'::ref.scale_state
            WHEN m.unit_kind = 'MONETARY' THEN 'KNOWN'::ref.scale_state
            ELSE 'NOT_APPLICABLE'::ref.scale_state END
FROM _matched r
JOIN obs.soi_row_observation o ON o.tabular_row_id = r.tabular_row_id AND o.rule_version_id = ${num(projId)}
JOIN obs.position_observation p ON p.origin_soi_row_observation_id = o.id AND p.rule_version_id = ${num(projId)}
JOIN _maps m ON r.cells[m.pos] <> ''
WHERE o.identifier_raw IS NOT NULL
ORDER BY r.line_number, m.pos;
CREATE TEMP TABLE _fv_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_CELL'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _fv_src s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _fv_ev SELECT * FROM ins;
INSERT INTO obs.position_field_value (position_observation_id, field_code, column_mapping_id, source_column_label,
    source_column_position, raw_value, normalized_numeric, normalized_date, normalized_text, currency_state, scale_state,
    value_state, normalization_rule_version_id, evidence_id, run_id)
SELECT s.position_observation_id, s.field_code, s.column_mapping_id, s.source_column_label, s.source_column_position,
       s.raw_value, s.normalized_numeric, s.normalized_date, s.normalized_text, 'UNKNOWN'::ref.currency_state, s.scale_state,
       'REPORTED'::ref.value_state, ${num(projId)}, e.id, ${num(runId)}
FROM _fv_src s
JOIN _fv_ev e ON e.tabular_row_id = s.tabular_row_id AND e.column_position = s.column_position
ORDER BY s.ord;

INSERT INTO obs.observation_equivalence (tabular_row_id, equivalent_tabular_row_id, basis, rule_version_id, run_id)
SELECT n.id, o.id, 'RAW_LINE_SHA256_EQUAL', ${num(projId)}, ${num(runId)}
FROM raw.tabular_row n
JOIN raw.table_load nl ON nl.id = n.table_load_id
JOIN raw.tabular_row o ON o.raw_line_sha256 = n.raw_line_sha256 AND o.id <> n.id
JOIN raw.table_load ol ON ol.id = o.table_load_id
WHERE n.table_load_id = pg_temp.ctx('load') AND ol.table_code = 'SOI' AND nl.table_code = 'SOI'
  AND ol.artifact_id <> nl.artifact_id
  AND NOT EXISTS (
    SELECT 1 FROM obs.observation_equivalence e
    WHERE e.tabular_row_id = n.id AND e.equivalent_tabular_row_id = o.id AND e.rule_version_id = ${num(projId)});

CREATE TEMP TABLE _cik_check ON COMMIT DROP AS
SELECT o.id AS soi_id, o.evidence_id, o.filing_id,
       EXISTS (
         SELECT 1
         FROM registry.filing_registrant_link l
         JOIN registry.registrant r ON r.id = l.registrant_id
         WHERE l.filing_id = o.filing_id
           AND r.cik = nullif(obs.cell_by_label(o.tabular_row_id, 'cik'), '')::bigint
           AND NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id)
       ) AS matches
FROM obs.soi_row_observation o
JOIN raw.tabular_row r ON r.id = o.tabular_row_id
WHERE r.table_load_id = pg_temp.ctx('load') AND o.rule_version_id = ${num(projId)};
INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
SELECT 'obs.soi_row_observation', c.soi_id, ${num(valId)},
       (CASE WHEN c.matches THEN 'PASS' ELSE 'FAIL' END)::ref.validation_outcome,
       CASE WHEN c.matches THEN 'SOI cik cell matches an explicit filing-registrant link'
            ELSE 'SOI cik cell does not match any explicit filing-registrant link; no winner is chosen and no link was created from SOI' END,
       c.evidence_id, ${num(runId)}
FROM _cik_check c
WHERE NOT EXISTS (
  SELECT 1 FROM validation.validation_result v
  WHERE v.subject_table = 'obs.soi_row_observation' AND v.subject_id = c.soi_id AND v.rule_version_id = ${num(valId)})
ORDER BY c.soi_id;

${memberEvidence}
${assertCoverage({
    registrantSql: "NULL::bigint", releaseSql: "pg_temp.ctx('release')", sourceType: "SEC_BDC_DATASET_ZIP",
    aspect: "SOI_HOLDINGS",
    stateSql: `${soi.rows.length > 0 ? "'COVERED'" : "'EMPTY_PERIOD'"}`,
    evidenceSql: "pg_temp.ctx('member_evidence')",
    rationaleSql: `format('SOI table of release %s loaded: %s data rows', ${lit(releaseLabel)}, ${num(soi.rows.length)})`,
    ruleId: rules["coverage.soi"], runId, label: "release" })}

CREATE TEMP TABLE _cov_reg ON COMMIT DROP AS
SELECT x.* FROM (
  SELECT DISTINCT ON (g.registrant_id) g.registrant_id, r.id AS tabular_row_id,
         (SELECT h.id FROM ops.coverage_assertion h
          WHERE h.registrant_id = g.registrant_id AND h.dataset_release_id = pg_temp.ctx('release')
            AND h.reporting_period_end IS NULL AND h.source_type_code = 'SEC_BDC_DATASET_ZIP'
            AND h.coverage_aspect = 'SOI_HOLDINGS'
            AND NOT EXISTS (SELECT 1 FROM ops.coverage_assertion s WHERE s.supersedes_id = h.id)) AS head_id
  FROM obs.soi_row_observation o
  JOIN raw.tabular_row r ON r.id = o.tabular_row_id
  JOIN registry.current_filing_registrant g ON g.filing_id = o.filing_id AND g.registrant_id IS NOT NULL
  WHERE r.table_load_id = pg_temp.ctx('load') AND o.rule_version_id = ${num(projId)}
  ORDER BY g.registrant_id, r.line_number) x
WHERE x.head_id IS NULL OR (SELECT h.coverage_state FROM ops.coverage_assertion h WHERE h.id = x.head_id) <> 'COVERED';
CREATE TEMP TABLE _cov_reg_ev (id bigint, tabular_row_id bigint) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
  SELECT 'L1_STRUCTURED_DATASET'::ref.evidence_level, pg_temp.ctx('artifact'), 'TSV_ROW'::ref.locator_type, c.tabular_row_id, ${num(runId)}
  FROM _cov_reg c ORDER BY c.registrant_id
  RETURNING id, tabular_row_id)
INSERT INTO _cov_reg_ev SELECT * FROM ins;
INSERT INTO ops.coverage_assertion (registrant_id, dataset_release_id, source_type_code, coverage_aspect, coverage_state, evidence_id,
    rationale, rule_version_id, run_id, supersedes_id, supersede_reason)
SELECT c.registrant_id, pg_temp.ctx('release'), 'SEC_BDC_DATASET_ZIP', 'SOI_HOLDINGS', 'COVERED', e.id,
       format('Registrant has projected SOI rows in release %s', ${lit(releaseLabel)}), ${num(rules["coverage.soi"])}, ${num(runId)},
       c.head_id, CASE WHEN c.head_id IS NOT NULL THEN 'coverage state changed in a newer retrieval' END
FROM _cov_reg c JOIN _cov_reg_ev e ON e.tabular_row_id = c.tabular_row_id
ORDER BY c.registrant_id;

INSERT INTO _counts VALUES
  ('soi_rows', ${soi.rows.length}),
  ('soi_field_count_mismatch_rows', ${mismatches}),
  ('soi_rows_with_carriage_return', ${soi.carriageReturns}),
  ('soi_header_width', ${width}),
  ('soi_dynamic_columns', ${Math.max(0, width - VERIFIED_SOI_PRESET_HEADER.length)});
INSERT INTO _counts SELECT 'soi_ok_rows', count(*) FROM _ok;
INSERT INTO _counts SELECT 'soi_orphan_adsh', count(*) FROM _orphan;
INSERT INTO _counts SELECT 'soi_row_observations', count(*) FROM obs.soi_row_observation o
  JOIN raw.tabular_row r ON r.id = o.tabular_row_id WHERE r.table_load_id = pg_temp.ctx('load');
INSERT INTO _counts SELECT 'soi_position_observations', count(*) FROM obs.position_observation p
  JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
  JOIN raw.tabular_row r ON r.id = o.tabular_row_id WHERE r.table_load_id = pg_temp.ctx('load');
INSERT INTO _counts SELECT 'soi_cik_fail', count(*) FROM _cik_check WHERE NOT matches;
INSERT INTO _counts SELECT 'soi_duplicate_key_groups', count(*) FROM (
  SELECT 1 FROM obs.soi_row_observation o JOIN raw.tabular_row r ON r.id = o.tabular_row_id
  WHERE r.table_load_id = pg_temp.ctx('load') AND o.identifier_raw IS NOT NULL
  GROUP BY o.filing_id, o.identifier_raw, o.reported_date, o.qtrs HAVING count(*) > 1) d;
INSERT INTO _counts SELECT 'coverage_registrants_asserted', count(*) FROM _cov_reg;
INSERT INTO _counts SELECT 'soi_unmapped_columns', count(*)
FROM unnest((SELECT header FROM raw.table_load WHERE id = pg_temp.ctx('load'))) AS h(label)
WHERE NOT EXISTS (
  SELECT 1 FROM ref.current_column_mapping m WHERE m.source_table_code = 'SOI' AND m.column_label = h.label);
${finish(rules, runId, "LOADED", `Release ${releaseLabel}: SOI loaded`)}`;
  return { sql };
}
