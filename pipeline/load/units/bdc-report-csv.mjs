// Load unit for one BDC Report CSV. The edition year comes from the page link text recorded in
// registry.bdc_report_edition. Only 2020-2026 files in the verified layout are loaded; any other
// header is recorded as SCHEMA_DRIFT (table_load with no rows) and never adapted silently.

import { BDC_REPORT_LOADED_YEARS, VERIFIED_BDC_REPORT_HEADER } from "../../lib/config.mjs";
import { copyBlock, lit, num, queryRows } from "../../lib/db.mjs";
import { parseBdcReportCsv } from "../../parse/bdc-report-csv.mjs";
import {
  LOCATION_COLUMNS, artifactBlock, finishBlock, insertRegistrants, prelude, streamBlock, upsertObservations,
} from "../sql.mjs";

const ATTRIBUTES = [
  ["File_No", "FILE_NUMBER"], ["Registrant_Name", "NAME"], ["Address_1", "ADDRESS_LINE_1"], ["Address_2", "ADDRESS_LINE_2"],
  ["City", "CITY"], ["State", "STATE"], ["Zip_Code", "ZIP_CODE"], ["Filing Date", "BDC_REPORT_LAST_FILING_DATE"],
  ["Filing Type", "BDC_REPORT_LAST_FILING_TYPE"],
].map(([label, code]) => ({ label, code, position: VERIFIED_BDC_REPORT_HEADER.indexOf(label) + 1 }));
const CIK_POSITION = VERIFIED_BDC_REPORT_HEADER.indexOf("CIK") + 1;

function tableLoad({ header, headerSha256, rowCount, mismatches, status, rules, runId }) {
  return `
WITH ins AS (
  INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
  VALUES (pg_temp.ctx('artifact'), NULL, 'BDC_REPORT_CSV', ',', ARRAY[${header.map(lit).join(", ")}]::text[], ${lit(headerSha256)},
          ${num(rules["parser.sec_bdc_report_csv"])}, ${num(rowCount)}, ${num(mismatches)}, ${lit(status)}::ref.parse_status, ${num(runId)})
  RETURNING id)
INSERT INTO _ctx SELECT 'load', id FROM ins;
`;
}

export function bdcReportCsvUnit({ database, entry, body, runId, rules }) {
  const edition = queryRows(database, `SELECT year_label_raw, coalesce(report_year::text, '') FROM registry.bdc_report_edition
WHERE csv_url = ${lit(entry.url)} ORDER BY id DESC LIMIT 1;`)[0];
  const parsed = parseBdcReportCsv(body);
  const reportYear = edition && edition[1] !== "" ? Number(edition[1]) : null;
  const inRange = reportYear !== null && reportYear >= BDC_REPORT_LOADED_YEARS.from && reportYear <= BDC_REPORT_LOADED_YEARS.to;
  const finish = (outcome, detail) => finishBlock({ keys: ["artifact"], ruleId: rules["pipeline.registry_load"], runId, outcome, detail });

  if (!edition) {
    return { sql: `${prelude()}${artifactBlock("artifact", entry, runId)}${finish("NOT_IN_SCOPE", "Not listed on any loaded BDC Report page retrieval")}` };
  }
  if (!inRange) {
    return { sql: `${prelude()}${artifactBlock("artifact", entry, runId)}${finish("NOT_IN_SCOPE", `Report year label ${edition[0]} is outside the loaded range 2020-2026`)}` };
  }
  if (!parsed.headerMatches) {
    const detail = `Header differs from the verified 2020-2026 layout (SOURCE_SCHEMAS 6.1); report year label ${edition[0]}; not loaded`;
    const sql = `${prelude()}${artifactBlock("artifact", entry, runId)}
${parsed.header.length ? tableLoad({ header: parsed.header, headerSha256: parsed.headerSha256, rowCount: 0, mismatches: 0, status: "SCHEMA_DRIFT", rules, runId }) : ""}
${finish("SCHEMA_DRIFT", detail)}`;
    return { sql, stop: `BDC Report ${edition[0]} is in the loaded year range but its header differs from the verified layout` };
  }

  const width = VERIFIED_BDC_REPORT_HEADER.length;
  const mismatches = parsed.rows.filter((r) => r.cells.length !== width).length;
  const rows = parsed.rows.map((r) => [r.lineNumber, r.raw, JSON.stringify(r.cells)]);
  const attrValues = ATTRIBUTES.map((a) => `(${a.position}, ${lit(a.label)}, ${lit(a.code)})`).join(", ");

  const sql = `${prelude()}
${artifactBlock("artifact", entry, runId)}
${streamBlock("artifact")}
${tableLoad({ header: parsed.header, headerSha256: parsed.headerSha256, rowCount: parsed.rows.length, mismatches, status: "OK", rules, runId })}
CREATE TEMP TABLE _csv (line_number bigint, raw_line text, cells jsonb) ON COMMIT DROP;
${copyBlock("_csv", ["line_number", "raw_line", "cells"], rows)}
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT pg_temp.ctx('load'), c.line_number, c.raw_line, encode(sha256(convert_to(c.raw_line, 'UTF8')), 'hex'),
       ARRAY(SELECT t.x FROM jsonb_array_elements_text(c.cells) WITH ORDINALITY AS t (x, o) ORDER BY t.o),
       jsonb_array_length(c.cells),
       (CASE WHEN jsonb_array_length(c.cells) = ${width} THEN 'OK' ELSE 'FIELD_COUNT_MISMATCH' END)::ref.parse_status, ${num(runId)}
FROM _csv c ORDER BY c.line_number;
CREATE TEMP TABLE _rows ON COMMIT DROP AS
SELECT r.id AS tabular_row_id, r.line_number, r.cells FROM raw.tabular_row r
WHERE r.table_load_id = pg_temp.ctx('load') AND r.parse_status = 'OK';
SELECT pg_temp.fail('BDC Report CIK cell is not a 10-digit number') FROM _rows WHERE cells[${CIK_POSITION}] !~ '^[0-9]{10}$' LIMIT 1;

CREATE TEMP TABLE _reg_src (${LOCATION_COLUMNS}, cik bigint) ON COMMIT DROP;
INSERT INTO _reg_src
SELECT pg_temp.ctx('artifact'), 'REGISTRY'::ref.evidence_level, r.tabular_row_id, ${CIK_POSITION}, 'CIK', NULL, r.line_number, r.cells[${CIK_POSITION}]::bigint FROM _rows r;
${insertRegistrants("_reg_src", runId)}

CREATE TEMP TABLE _rfact (${LOCATION_COLUMNS}, registrant_id bigint, attribute_code text, raw_value text, normalized_value text, source_as_of date) ON COMMIT DROP;
INSERT INTO _rfact
SELECT pg_temp.ctx('artifact'), 'REGISTRY'::ref.evidence_level, r.tabular_row_id, a.pos, a.label, NULL, r.line_number * 100 + a.pos,
       g.id, a.code, r.cells[a.pos], NULL, NULL
FROM _rows r
JOIN registry.registrant g ON g.cik = r.cells[${CIK_POSITION}]::bigint
CROSS JOIN (VALUES ${attrValues}) AS a (pos, label, code)
WHERE r.cells[a.pos] <> '';
INSERT INTO _rfact
SELECT pg_temp.ctx('artifact'), 'REGISTRY'::ref.evidence_level, r.tabular_row_id, NULL::integer, NULL::text, NULL::text, r.line_number * 100,
       g.id, 'BDC_REPORT_LISTING', ${lit(edition[0])}, NULL, NULL
FROM _rows r
JOIN registry.registrant g ON g.cik = r.cells[${CIK_POSITION}]::bigint;
${upsertObservations({ source: "_rfact", target: "registry.registrant_attribute_observation", subject: ["registrant_id", "attribute_code"], values: ["raw_value"], extra: ["normalized_value", "source_as_of"], ruleId: rules["registry.projection"], runId, label: "registrant_attributes" })}
INSERT INTO _counts VALUES ('rows', ${parsed.rows.length}), ('field_count_mismatch_rows', ${mismatches}), ('byte_order_mark', ${parsed.bom ? 1 : 0});
${finish("LOADED", `BDC Report year label ${edition[0]} loaded`)}`;
  return { sql };
}
