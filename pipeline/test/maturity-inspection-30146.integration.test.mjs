// Throwaway check for one loaded 2026_08 SOI row: line 30146, accession 0000017313-26-000095.
// Copies bdc_local, applies pending migrations on the copy, appends one maturity inspection, rolls it back, then drops the copy.
// Not part of npm run test:pipeline:integration. Run: node --test pipeline/test/maturity-inspection-30146.integration.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, databaseExists, dropDatabase, dockerAvailable, psql, psqlOrThrow, query,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { EXPECTED_UNIVERSE } from "../load/golden-gate.mjs";
import { measureP11 } from "../p11-readiness.mjs";
import { buildP11Audit } from "../normalize/p11-readiness.mjs";

const SOURCE = "bdc_local";
const ACCESSION = "0000017313-26-000095";
const LINE_NUMBER = 30146;
const RELEASE = "2026_08";
const CONTEXT_ID = "c-1596";
const OTHER_CONTEXT = "c-80";
const SUBTOTAL_CONTEXT = "c-1597";
const RAW_DATE = "2/4/2030";
const NORMALIZED_DATE = "2030-02-04";
const FACT_IDS = ["f-6023", "f-6024", "f-6025", "f-6026", "f-6027", "f-6028"];
const DOCUMENT_SHA256 = "26eb385fb0c5a5211b7cadb4fe857f1d68698fc1574d684b056b9a888edae05a";
const DOCUMENT_URL = "https://www.sec.gov/Archives/edgar/data/17313/000001731326000095/cswc-20260630.htm";
const DOCUMENT_BYTES = 9537739;
const DOCUMENT_NAME = "cswc-20260630.htm";

function scalar(database, sql) {
  const found = query(database, sql);
  assert.equal(found.length, 1, sql);
  return found[0];
}

function cloneLoadedDatabase(name) {
  const active = query("postgres", `SELECT count(*) FROM pg_stat_activity
    WHERE datname = '${SOURCE}' AND pid <> pg_backend_pid() AND state = 'active'
      AND query NOT ILIKE '%autovacuum%'`);
  if (active[0] !== "0") throw new Error(`${SOURCE} has an active query; refusing to copy it`);
  psqlOrThrow("postgres", `
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = '${SOURCE}' AND pid <> pg_backend_pid();
CREATE DATABASE "${name}" WITH TEMPLATE "${SOURCE}";
`);
}

const factList = FACT_IDS.map((id) => `('${id}')`).join(",");

const script = `
SET statement_timeout = '600s';
BEGIN;
CREATE TEMP TABLE assertion (ord int PRIMARY KEY, name text NOT NULL, ok boolean NOT NULL, detail text NOT NULL);
CREATE FUNCTION pg_temp.note(ord int, name text, ok boolean, detail text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO assertion VALUES (ord, name, ok, detail);
END $$;

CREATE TEMP TABLE target AS
SELECT o.id AS observation_id, p.id AS position_id, o.filing_id, p.rule_version_id, p.run_id,
       c.period_role::text AS period_role, c.row_kind::text AS row_kind
FROM obs.soi_row_observation o
JOIN raw.tabular_row r ON r.id = o.tabular_row_id
JOIN raw.table_load tl ON tl.id = r.table_load_id
JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
JOIN registry.dataset_release d ON d.id = dra.dataset_release_id
JOIN registry.filing f ON f.id = o.filing_id
JOIN obs.position_observation p ON p.origin_soi_row_observation_id = o.id
JOIN obs.current_soi_row_classification c ON c.soi_row_observation_id = o.id
WHERE d.release_label = '${RELEASE}' AND r.line_number = ${LINE_NUMBER} AND f.accession_number = '${ACCESSION}';

SELECT pg_temp.note(1, 'the loaded row is one identifier position with no structured maturity',
  (SELECT count(*) = 1 AND bool_and(row_kind = 'IDENTIFIER_ROW' AND period_role = 'UNRESOLVED') FROM target)
  AND (SELECT count(*) = 0 FROM obs.position_field_value fv JOIN target t ON t.position_id = fv.position_observation_id
        WHERE fv.field_code = 'MATURITY_DATE')
  AND (SELECT provenance_state = 'UNKNOWN' FROM obs.maturity_provenance mp JOIN target t ON t.position_id = mp.position_observation_id),
  (SELECT count(*)::text FROM target));

CREATE TEMP TABLE before_counts AS
SELECT
  (SELECT count(*) FROM obs.position_observation) AS positions,
  (SELECT count(*) FROM obs.position_field_value) AS field_values,
  (SELECT count(*) FROM obs.soi_row_classification) AS classifications,
  (SELECT count(*) FROM obs.position_field_value
    WHERE field_code = 'MATURITY_DATE' AND value_state = 'REPORTED' AND normalized_date IS NOT NULL) AS maturity_reported,
  (SELECT count(*) FROM registry.maturity_year) AS maturity_year_buckets,
  (SELECT coalesce(sum(disclosed_line_count), 0) FROM registry.maturity_year) AS maturity_year_lines;

CREATE TEMP TABLE filing_doc AS
SELECT fd.id
FROM registry.filing_document fd
JOIN target t ON t.filing_id = fd.filing_id
WHERE fd.document_name = '${DOCUMENT_NAME}' AND fd.document_url = '${DOCUMENT_URL}';

SELECT pg_temp.note(2, 'the filing document for this accession is already stored',
  (SELECT count(*) = 1 FROM filing_doc),
  (SELECT count(*)::text FROM filing_doc));

CREATE TEMP TABLE target_artifact (id bigint);
WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, content_type, byte_size, sha256, retrieved_at, storage_key, run_id)
  SELECT '${DOCUMENT_URL}', '${DOCUMENT_URL}', 'SEC_FILING_DOCUMENT', 200, 'text/html', ${DOCUMENT_BYTES},
         '${DOCUMENT_SHA256}', clock_timestamp(), 'test-only/not-loaded/${DOCUMENT_NAME}', t.run_id
  FROM target t
  RETURNING id
) INSERT INTO target_artifact SELECT id FROM i;

INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
SELECT d.id, a.id, t.run_id FROM filing_doc d CROSS JOIN target_artifact a CROSS JOIN target t;

CREATE TEMP TABLE anchor (context_id text PRIMARY KEY, id bigint);
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  SELECT 'L2_ORIGINAL_FILING', a.id, 'HTML_ANCHOR', 'ix-context-row:' || v.context_id, t.run_id
  FROM (VALUES ('${CONTEXT_ID}'), ('${OTHER_CONTEXT}'), ('${SUBTOTAL_CONTEXT}')) AS v(context_id)
  CROSS JOIN target t
  CROSS JOIN target_artifact a
  RETURNING id, html_anchor
)
INSERT INTO anchor (context_id, id)
SELECT substring(html_anchor FROM 'ix-context-row:(.*)$'), id FROM ins;

CREATE TEMP TABLE fact (fact_id text PRIMARY KEY, id bigint);
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  SELECT 'L2_ORIGINAL_FILING', a.id, 'IXBRL_FACT', v.fact_id, t.run_id
  FROM (VALUES ${factList}, ('f-507'), ('f-6029')) AS v(fact_id)
  CROSS JOIN target t
  CROSS JOIN target_artifact a
  RETURNING id, ixbrl_fact_id
)
INSERT INTO fact (fact_id, id)
SELECT ixbrl_fact_id, id FROM ins;

INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
SELECT 'obs.position_observation', t.position_id, t.rule_version_id, 'PASS', '${OTHER_CONTEXT}', f.id, t.run_id
FROM target t JOIN fact f ON f.fact_id = 'f-507';
INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
SELECT 'obs.position_observation', t.position_id, t.rule_version_id, 'PASS', '${SUBTOTAL_CONTEXT}', f.id, t.run_id
FROM target t JOIN fact f ON f.fact_id = 'f-6029';

DO $neg$
DECLARE msg text;
BEGIN
  BEGIN
    INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
        filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id)
    SELECT t.position_id, t.observation_id, 'FILING_DISPLAYED', '${CONTEXT_ID}', '${RAW_DATE}', DATE '${NORMALIZED_DATE}',
           a.id, t.rule_version_id, t.run_id
    FROM target t JOIN anchor a ON a.context_id = '${OTHER_CONTEXT}';
    PERFORM pg_temp.note(3, 'c-80 cannot satisfy the c-1596 inspection', false, 'insert succeeded');
  EXCEPTION WHEN SQLSTATE 'BDCI1' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    PERFORM pg_temp.note(3, 'c-80 cannot satisfy the c-1596 inspection', true, msg);
  END;
  BEGIN
    INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
        filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id)
    SELECT t.position_id, t.observation_id, 'FILING_DISPLAYED', '${CONTEXT_ID}', '${RAW_DATE}', DATE '${NORMALIZED_DATE}',
           a.id, t.rule_version_id, t.run_id
    FROM target t JOIN anchor a ON a.context_id = '${SUBTOTAL_CONTEXT}';
    PERFORM pg_temp.note(4, 'c-1597 cannot satisfy the c-1596 inspection', false, 'insert succeeded');
  EXCEPTION WHEN SQLSTATE 'BDCI1' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    PERFORM pg_temp.note(4, 'c-1597 cannot satisfy the c-1596 inspection', true, msg);
  END;
  BEGIN
    INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
        filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id)
    SELECT t.position_id, t.observation_id, 'FILING_DISPLAYED', '${CONTEXT_ID}', '${RAW_DATE}', DATE '${NORMALIZED_DATE}',
           a.id, t.rule_version_id, t.run_id
    FROM target t JOIN anchor a ON a.context_id = '${CONTEXT_ID}';
    PERFORM pg_temp.note(5, 'c-80 and c-1597 validations cannot satisfy c-1596', false, 'insert succeeded');
  EXCEPTION WHEN SQLSTATE 'BDCI1' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    PERFORM pg_temp.note(5, 'c-80 and c-1597 validations cannot satisfy c-1596',
      msg = 'maturity inspection requires a PASS validation of an IXBRL_FACT on the same filing artifact for this context', msg);
  END;
END
$neg$;

INSERT INTO validation.validation_result (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
SELECT 'obs.position_observation', t.position_id, t.rule_version_id, 'PASS', '${CONTEXT_ID}', f.id, t.run_id
FROM target t JOIN fact f ON f.fact_id IN (${FACT_IDS.map((id) => `'${id}'`).join(",")});

WITH i AS (
  INSERT INTO obs.maturity_inspection (position_observation_id, soi_row_observation_id, inspection_state,
      filing_context_id, raw_value, normalized_date, evidence_id, rule_version_id, run_id)
  SELECT t.position_id, t.observation_id, 'FILING_DISPLAYED', '${CONTEXT_ID}', '${RAW_DATE}', DATE '${NORMALIZED_DATE}',
         a.id, t.rule_version_id, t.run_id
  FROM target t JOIN anchor a ON a.context_id = '${CONTEXT_ID}'
  RETURNING id
) SELECT id INTO TEMP inspection FROM i;

INSERT INTO evidence.supplementary_evidence (subject_table, subject_id, evidence_id, role, run_id)
SELECT 'obs.maturity_inspection', i.id, f.id, 'CORROBORATES', t.run_id
FROM inspection i CROSS JOIN target t JOIN fact f ON f.fact_id IN (${FACT_IDS.map((id) => `'${id}'`).join(",")});

SELECT pg_temp.note(7, 'provenance is FILING_DISPLAYED with the displayed date and context',
  (SELECT mp.provenance_state = 'FILING_DISPLAYED'
      AND mp.filing_context_id = '${CONTEXT_ID}'
      AND mp.displayed_raw = '${RAW_DATE}'
      AND mp.displayed_date = DATE '${NORMALIZED_DATE}'
      AND mp.structured_date IS NULL
      AND mp.inspection_id = i.id
   FROM obs.maturity_provenance mp
   JOIN target t ON t.position_id = mp.position_observation_id
   CROSS JOIN inspection i),
  (SELECT mp.provenance_state::text || ' ' || mp.filing_context_id || ' ' || mp.displayed_raw || ' ' || mp.displayed_date::text
   FROM obs.maturity_provenance mp JOIN target t ON t.position_id = mp.position_observation_id));

SELECT pg_temp.note(8, 'the anchor is an L2 ix-context-row on the same filing',
  (SELECT e.evidence_level = 'L2_ORIGINAL_FILING' AND e.locator_type = 'HTML_ANCHOR'
      AND e.html_anchor = 'ix-context-row:${CONTEXT_ID}'
      AND fd.filing_id = t.filing_id
   FROM inspection i
   JOIN obs.maturity_inspection m ON m.id = i.id
   JOIN evidence.evidence e ON e.id = m.evidence_id
   JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
   JOIN registry.filing_document fd ON fd.id = fda.filing_document_id
   CROSS JOIN target t),
  (SELECT e.html_anchor || ' filing ' || fd.filing_id::text
   FROM inspection i
   JOIN obs.maturity_inspection m ON m.id = i.id
   JOIN evidence.evidence e ON e.id = m.evidence_id
   JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
   JOIN registry.filing_document fd ON fd.id = fda.filing_document_id));

SELECT pg_temp.note(9, 'PASS validations bind f-6023 through f-6028 to c-1596',
  (SELECT count(*) = ${FACT_IDS.length}
      AND bool_and(v.outcome = 'PASS' AND v.detail = '${CONTEXT_ID}' AND fact.artifact_id = anchor.artifact_id)
   FROM validation.validation_result v
   JOIN target t ON t.position_id = v.subject_id
   JOIN evidence.evidence fact ON fact.id = v.evidence_id
   JOIN inspection i ON true
   JOIN obs.maturity_inspection m ON m.id = i.id
   JOIN evidence.evidence anchor ON anchor.id = m.evidence_id
   WHERE v.subject_table = 'obs.position_observation' AND v.detail = '${CONTEXT_ID}'
     AND fact.ixbrl_fact_id IN (${FACT_IDS.map((id) => `'${id}'`).join(",")})),
  (SELECT string_agg(fact.ixbrl_fact_id, ',' ORDER BY fact.ixbrl_fact_id)
   FROM validation.validation_result v
   JOIN target t ON t.position_id = v.subject_id
   JOIN evidence.evidence fact ON fact.id = v.evidence_id
   WHERE v.detail = '${CONTEXT_ID}'));

SELECT pg_temp.note(10, 'structured MATURITY_DATE stays absent',
  (SELECT count(*) = 0 FROM obs.position_field_value fv JOIN target t ON t.position_id = fv.position_observation_id
    WHERE fv.field_code = 'MATURITY_DATE')
  AND (SELECT value_state = 'UNKNOWN' AND field_value_id IS NULL
       FROM obs.position_field_status s JOIN target t ON t.position_id = s.position_observation_id
       WHERE s.field_code = 'MATURITY_DATE'),
  (SELECT count(*)::text FROM obs.position_field_value fv JOIN target t ON t.position_id = fv.position_observation_id
    WHERE fv.field_code = 'MATURITY_DATE'));

SELECT pg_temp.note(11, 'position, field-value, and classification counts stay unchanged',
  (SELECT positions = ${EXPECTED_UNIVERSE.position_observation_count}
      AND positions = (SELECT count(*) FROM obs.position_observation)
      AND field_values = ${EXPECTED_UNIVERSE.position_field_value_count}
      AND field_values = (SELECT count(*) FROM obs.position_field_value)
      AND classifications = (SELECT count(*) FROM obs.soi_row_classification)
   FROM before_counts),
  (SELECT positions::text || ' ' || field_values::text || ' ' || classifications::text FROM before_counts));

SELECT pg_temp.note(12, 'the year counts gain only the filing-displayed line; P11 reported maturity stays unchanged',
  (SELECT maturity_reported = (SELECT count(*) FROM obs.position_field_value
            WHERE field_code = 'MATURITY_DATE' AND value_state = 'REPORTED' AND normalized_date IS NOT NULL)
      AND (SELECT count(*) FROM registry.maturity_year) IN (maturity_year_buckets, maturity_year_buckets + 1)
      AND maturity_year_lines + 1 = (SELECT coalesce(sum(disclosed_line_count), 0) FROM registry.maturity_year)
      AND (SELECT count(*) FROM obs.position_observation)
          + (SELECT count(*) FROM obs.soi_row_observation WHERE identifier_raw IS NULL)
          = (SELECT count(*) FROM obs.soi_row_observation)
   FROM before_counts),
  (SELECT maturity_reported::text || ' reported; year lines ' || maturity_year_lines::text FROM before_counts));

SELECT pg_temp.note(13, 'no other position was inspected',
  (SELECT count(*) = 1 FROM obs.maturity_inspection)
  AND (SELECT count(*) = 1 FROM obs.maturity_inspection m JOIN target t ON t.position_id = m.position_observation_id),
  (SELECT count(*)::text FROM obs.maturity_inspection));

SELECT ord::text || '|' || name || '|' || CASE WHEN ok THEN 'pass' ELSE 'fail' END || '|' || detail
FROM assertion ORDER BY ord;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM assertion WHERE NOT ok) THEN
    RAISE EXCEPTION 'one or more assertions failed';
  END IF;
END $$;
ROLLBACK;
`;

test("line 30146 maturity inspection stays on a rolled-back copy", { timeout: 1_200_000 }, (t) => {
  if (!dockerAvailable() || !containerRunning() || !databaseExists(SOURCE)) {
    t.skip("loaded bdc_local is not available");
    return;
  }
  const located = query(SOURCE, `SELECT count(*) FROM obs.soi_row_observation o
    JOIN raw.tabular_row r ON r.id = o.tabular_row_id
    JOIN raw.table_load tl ON tl.id = r.table_load_id
    JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
    JOIN registry.dataset_release d ON d.id = dra.dataset_release_id
    JOIN registry.filing f ON f.id = o.filing_id
    JOIN obs.position_observation p ON p.origin_soi_row_observation_id = o.id
    WHERE d.release_label = '${RELEASE}' AND r.line_number = ${LINE_NUMBER} AND f.accession_number = '${ACCESSION}'
      AND o.identifier_raw IS NOT NULL`);
  assert.equal(located[0], "1");

  const positionsBefore = scalar(SOURCE, "SELECT count(*) FROM obs.position_observation");
  const fieldsBefore = scalar(SOURCE, "SELECT count(*) FROM obs.position_field_value");
  const maturityReportedBefore = scalar(SOURCE, `SELECT count(*) FROM obs.position_field_value
    WHERE field_code = 'MATURITY_DATE' AND value_state = 'REPORTED' AND normalized_date IS NOT NULL`);
  const clone = `bdc_line30146_${process.pid}`;
  dropDatabase(clone);
  let rolledBack = false;
  try {
    cloneLoadedDatabase(clone);
    migrate(clone);
    const applied = scalar(clone, "SELECT count(*) FROM ops.schema_migration WHERE filename = '0023_maturity_inspection.sql'");
    assert.equal(applied, "1");
    const result = psql(clone, script, ["-At", "-v", "ON_ERROR_STOP=1"]);
    const rows = result.stdout.split("\n").filter((line) => line !== "");
    const assertions = rows.map((line) => {
      const [ord, name, status, ...detail] = line.split("|");
      return { ord, name, status, detail: detail.join("|") };
    });
    assert.ok(assertions.length >= 12, result.stderr || result.stdout);
    for (const row of assertions) console.log(`${row.status}\t${row.ord}\t${row.name}\t${row.detail}`);
    for (const row of assertions) {
      assert.equal(row.status, "pass", `${row.ord} ${row.name}: ${row.detail}`);
    }
    assert.equal(result.status, 0, result.stderr);
    rolledBack = true;
    assert.equal(scalar(clone, "SELECT count(*) FROM obs.maturity_inspection"), "0");
    assert.equal(scalar(clone, "SELECT count(*) FROM obs.position_observation"), positionsBefore);
    assert.equal(scalar(clone, "SELECT count(*) FROM obs.position_field_value"), fieldsBefore);

    const savedPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    let measured;
    try {
      measured = measureP11(clone);
    } finally {
      if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
    }
    const audit = buildP11Audit(measured);
    assert.equal(audit.population.position_observations, EXPECTED_UNIVERSE.position_observation_count);
    assert.equal(audit.population.field_values, EXPECTED_UNIVERSE.position_field_value_count);
    assert.equal(audit.attributes.maturity_date.REPORTED, Number(maturityReportedBefore));
  } finally {
    dropDatabase(clone);
  }
  assert.equal(rolledBack, true);
  assert.equal(scalar(SOURCE, `SELECT count(*) FROM ops.schema_migration
    WHERE filename IN ('0021_soi_row_kind.sql', '0022_soi_classification_evidence.sql', '0023_maturity_inspection.sql')`), "0");
  assert.equal(scalar(SOURCE, "SELECT count(*) FROM obs.position_observation"), positionsBefore);
  assert.equal(scalar(SOURCE, "SELECT count(*) FROM obs.position_field_value"), fieldsBefore);
  assert.equal(scalar(SOURCE, `SELECT count(*) FROM obs.position_field_value fv
    JOIN obs.position_observation p ON p.id = fv.position_observation_id
    JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
    JOIN raw.tabular_row r ON r.id = o.tabular_row_id
    JOIN registry.filing f ON f.id = o.filing_id
    WHERE r.line_number = ${LINE_NUMBER} AND f.accession_number = '${ACCESSION}' AND fv.field_code = 'MATURITY_DATE'`), "0");
});
