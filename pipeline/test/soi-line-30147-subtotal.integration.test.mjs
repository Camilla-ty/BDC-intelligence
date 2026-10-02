// Throwaway check for one loaded 2026_08 SOI row: line 30147, accession 0000017313-26-000095.
// Copies bdc_local, applies pending migrations on the copy, appends one SUBTOTAL_ROW, then drops the copy.
// Not part of npm run test:pipeline:integration. Run: node --test pipeline/test/soi-line-30147-subtotal.integration.test.mjs

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
const LINE_NUMBER = 30147;
const RELEASE = "2026_08";
const FACT_ID = "c-1597";
const DOCUMENT_SHA256 = "26eb385fb0c5a5211b7cadb4fe857f1d68698fc1574d684b056b9a888edae05a";
const DOCUMENT_URL = "https://www.sec.gov/Archives/edgar/data/17313/000001731326000095/cswc-20260630.htm";
const DOCUMENT_BYTES = 9537739;

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

const script = `
SET statement_timeout = '300s';
BEGIN;
CREATE TEMP TABLE assertion (ord int PRIMARY KEY, name text NOT NULL, ok boolean NOT NULL, detail text NOT NULL);
CREATE FUNCTION pg_temp.note(ord int, name text, ok boolean, detail text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO assertion VALUES (ord, name, ok, detail);
END $$;

CREATE TEMP TABLE target AS
SELECT o.id AS observation_id, o.filing_id, o.evidence_id AS l1_evidence_id, c.id AS classification_id,
       c.rule_version_id, c.run_id, c.period_role::text AS period_role, c.row_kind::text AS row_kind
FROM obs.soi_row_observation o
JOIN raw.tabular_row r ON r.id = o.tabular_row_id
JOIN raw.table_load tl ON tl.id = r.table_load_id
JOIN registry.dataset_release_artifact dra ON dra.artifact_id = tl.artifact_id
JOIN registry.dataset_release d ON d.id = dra.dataset_release_id
JOIN registry.filing f ON f.id = o.filing_id
JOIN obs.current_soi_row_classification c ON c.soi_row_observation_id = o.id
WHERE d.release_label = '${RELEASE}' AND r.line_number = ${LINE_NUMBER} AND f.accession_number = '${ACCESSION}';

SELECT pg_temp.note(1, 'the loaded row is the empty-identifier line',
  (SELECT count(*) = 1 AND bool_and(row_kind = 'NO_IDENTIFIER_ROW' AND period_role = 'UNRESOLVED') FROM target),
  (SELECT count(*)::text FROM target));

CREATE TEMP TABLE before_counts AS
SELECT
  (SELECT count(*) FROM obs.soi_row_observation) AS soi_rows,
  (SELECT count(*) FROM obs.position_observation) AS positions,
  (SELECT count(*) FROM obs.position_field_value) AS field_values,
  (SELECT count(*) FROM obs.borrower_name_observation) AS golden_names,
  (SELECT count(*) FROM obs.soi_row_observation WHERE identifier_raw IS NULL) AS empty_identifier,
  (SELECT count(*) FROM obs.position_observation p WHERE p.origin_soi_row_observation_id = (SELECT observation_id FROM target)) AS origin_positions;

CREATE TEMP TABLE target_artifact (id bigint);
WITH i AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, content_type, byte_size, sha256, retrieved_at, storage_key, run_id)
  SELECT '${DOCUMENT_URL}', '${DOCUMENT_URL}', 'SEC_FILING_DOCUMENT', 200, 'text/html', ${DOCUMENT_BYTES},
         '${DOCUMENT_SHA256}', clock_timestamp(), 'test-only/not-loaded/cswc-20260630.htm', t.run_id
  FROM target t
  RETURNING id
) INSERT INTO target_artifact SELECT id FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  SELECT 'L2_ORIGINAL_FILING', a.id, 'DOCUMENT', t.run_id FROM target t CROSS JOIN target_artifact a
  RETURNING id
) SELECT id INTO TEMP e_doc FROM i;

WITH i AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  SELECT 'L2_ORIGINAL_FILING', a.id, 'IXBRL_FACT', '${FACT_ID}', t.run_id FROM target t CROSS JOIN target_artifact a
  RETURNING id
) SELECT id INTO TEMP e_ix FROM i;

WITH i AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  SELECT t.filing_id, 'cswc-20260630.htm', '${DOCUMENT_URL}', 'FILING_INDEX_JSON', t.rule_version_id, t.run_id, d.id
  FROM target t CROSS JOIN e_doc d
  RETURNING id
), linked AS (
  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  SELECT i.id, a.id, t.run_id FROM i CROSS JOIN target_artifact a CROSS JOIN target t
  RETURNING filing_document_id
) SELECT filing_document_id INTO TEMP filing_doc FROM linked;

WITH i AS (
  INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
      supersedes_id, supersede_reason, evidence_id)
  SELECT t.observation_id, 'SUBTOTAL_ROW', 'UNRESOLVED', t.rule_version_id, t.run_id, t.classification_id,
         'TEST ONLY: inspected iXBRL context is a subtotal on this filing', e.id
  FROM target t CROSS JOIN e_ix e
  RETURNING id
) SELECT id INTO TEMP subtotal FROM i;

SELECT pg_temp.note(2, 'original NO_IDENTIFIER_ROW remains in history',
  (SELECT count(*) = 1 FROM obs.soi_row_classification c JOIN target t ON t.classification_id = c.id
    WHERE c.row_kind = 'NO_IDENTIFIER_ROW' AND c.period_role = 'UNRESOLVED' AND c.evidence_id IS NULL AND c.supersedes_id IS NULL),
  (SELECT c.id::text || ' ' || c.row_kind::text FROM obs.soi_row_classification c JOIN target t ON t.classification_id = c.id));

SELECT pg_temp.note(3, 'a new SUBTOTAL_ROW classification is appended',
  (SELECT count(*) = 1 FROM obs.soi_row_classification c JOIN target t ON t.observation_id = c.soi_row_observation_id
    JOIN subtotal s ON s.id = c.id
    WHERE c.row_kind = 'SUBTOTAL_ROW' AND c.supersedes_id = t.classification_id),
  (SELECT c.id::text FROM subtotal c));

SELECT pg_temp.note(4, 'evidence_id points at the same filing',
  (SELECT fd.filing_id = t.filing_id AND e.evidence_level = 'L2_ORIGINAL_FILING' AND e.locator_type = 'IXBRL_FACT'
          AND e.ixbrl_fact_id = '${FACT_ID}' AND c.evidence_id = e.id
   FROM obs.current_soi_row_classification c
   JOIN target t ON t.observation_id = c.soi_row_observation_id
   JOIN evidence.evidence e ON e.id = c.evidence_id
   JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
   JOIN registry.filing_document fd ON fd.id = fda.filing_document_id),
  (SELECT c.evidence_id::text || ' filing ' || fd.filing_id::text
   FROM obs.current_soi_row_classification c
   JOIN target t ON t.observation_id = c.soi_row_observation_id
   JOIN evidence.evidence e ON e.id = c.evidence_id
   JOIN registry.filing_document_artifact fda ON fda.artifact_id = e.artifact_id
   JOIN registry.filing_document fd ON fd.id = fda.filing_document_id));

DO $neg$
DECLARE msg text;
BEGIN
  BEGIN
    INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
        supersedes_id, supersede_reason, evidence_id)
    SELECT t.observation_id, 'SUBTOTAL_ROW', 'UNRESOLVED', t.rule_version_id, t.run_id, s.id, 'TEST ONLY', t.l1_evidence_id
    FROM target t CROSS JOIN subtotal s;
    PERFORM pg_temp.note(5, 'L1 evidence is rejected', false, 'insert succeeded');
  EXCEPTION WHEN SQLSTATE 'BDCI1' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    PERFORM pg_temp.note(5, 'L1 evidence is rejected',
      msg = 'filing evidence must be L2 IXBRL_FACT or HTML_ANCHOR on the same filing', msg);
  END;
  BEGIN
    INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id,
        supersedes_id, supersede_reason, evidence_id)
    SELECT t.observation_id, 'DIMENSION_FACT_ROW', 'UNRESOLVED', t.rule_version_id, t.run_id, s.id, 'TEST ONLY', d.id
    FROM target t CROSS JOIN subtotal s CROSS JOIN e_doc d;
    PERFORM pg_temp.note(6, 'DOCUMENT evidence is rejected', false, 'insert succeeded');
  EXCEPTION WHEN SQLSTATE 'BDCI1' THEN
    GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
    PERFORM pg_temp.note(6, 'DOCUMENT evidence is rejected',
      msg = 'filing evidence must be L2 IXBRL_FACT or HTML_ANCHOR on the same filing', msg);
  END;
END
$neg$;

SELECT pg_temp.note(7, 'position_observation count does not increase',
  (SELECT positions = ${EXPECTED_UNIVERSE.position_observation_count}
      AND positions = (SELECT count(*) FROM obs.position_observation)
      AND origin_positions = 0
      AND origin_positions = (SELECT count(*) FROM obs.position_observation p
            WHERE p.origin_soi_row_observation_id = (SELECT observation_id FROM target))
   FROM before_counts),
  (SELECT positions::text || ' -> ' || (SELECT count(*) FROM obs.position_observation)::text FROM before_counts));

SELECT pg_temp.note(8, 'position_field_value count does not increase',
  (SELECT field_values = ${EXPECTED_UNIVERSE.position_field_value_count}
      AND field_values = (SELECT count(*) FROM obs.position_field_value) FROM before_counts),
  (SELECT field_values::text || ' -> ' || (SELECT count(*) FROM obs.position_field_value)::text FROM before_counts));

SELECT pg_temp.note(9, 'P11 empty-identifier equality still holds',
  (SELECT (SELECT count(*) FROM obs.position_observation)
        + (SELECT count(*) FROM obs.soi_row_observation WHERE identifier_raw IS NULL)
        = (SELECT count(*) FROM obs.soi_row_observation))
   AND (SELECT empty_identifier = (SELECT count(*) FROM obs.soi_row_observation WHERE identifier_raw IS NULL) FROM before_counts)
   AND (SELECT count(*) FROM obs.current_soi_row_classification WHERE row_kind = 'NO_IDENTIFIER_ROW')
        = (SELECT empty_identifier FROM before_counts) - 1,
  (SELECT (SELECT count(*) FROM obs.soi_row_observation WHERE identifier_raw IS NULL)::text
        || ' empty; current NO_IDENTIFIER_ROW '
        || (SELECT count(*) FROM obs.current_soi_row_classification WHERE row_kind = 'NO_IDENTIFIER_ROW')::text));

SELECT pg_temp.note(10, 'period_role remains UNRESOLVED',
  (SELECT bool_and(c.period_role = 'UNRESOLVED')
   FROM obs.soi_row_classification c JOIN target t ON t.observation_id = c.soi_row_observation_id),
  (SELECT string_agg(c.row_kind::text || '=' || c.period_role::text, ', ' ORDER BY c.id)
   FROM obs.soi_row_classification c JOIN target t ON t.observation_id = c.soi_row_observation_id));

SELECT pg_temp.note(11, 'Golden universe counts remain unchanged',
  (SELECT soi_rows = ${EXPECTED_UNIVERSE.soi_row_observation_count}
      AND positions = ${EXPECTED_UNIVERSE.position_observation_count}
      AND field_values = ${EXPECTED_UNIVERSE.position_field_value_count}
      AND golden_names = ${EXPECTED_UNIVERSE.golden_name_observations}
      AND soi_rows = (SELECT count(*) FROM obs.soi_row_observation)
      AND golden_names = (SELECT count(*) FROM obs.borrower_name_observation)
   FROM before_counts),
  (SELECT soi_rows::text || ' ' || positions::text || ' ' || field_values::text || ' ' || golden_names::text FROM before_counts));

SELECT ord::text || '|' || name || '|' || CASE WHEN ok THEN 'pass' ELSE 'fail' END || '|' || detail
FROM assertion ORDER BY ord;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM assertion WHERE NOT ok) THEN
    RAISE EXCEPTION 'one or more assertions failed';
  END IF;
END $$;
COMMIT;
`;

test("line 30147 subtotal supersession stays on a throwaway copy", { timeout: 600_000 }, (t) => {
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
    WHERE d.release_label = '${RELEASE}' AND r.line_number = ${LINE_NUMBER} AND f.accession_number = '${ACCESSION}'
      AND o.identifier_raw IS NULL`);
  assert.equal(located[0], "1");

  const positionsBefore = scalar(SOURCE, "SELECT count(*) FROM obs.position_observation");
  const emptyBefore = scalar(SOURCE, "SELECT count(*) FROM obs.soi_row_observation WHERE identifier_raw IS NULL");
  const clone = `bdc_line30147_${process.pid}`;
  dropDatabase(clone);
  let committed = false;
  try {
    cloneLoadedDatabase(clone);
    migrate(clone);
    const applied = scalar(clone, "SELECT count(*) FROM ops.schema_migration WHERE filename = '0022_soi_classification_evidence.sql'");
    assert.equal(applied, "1");
    const result = psql(clone, script, ["-At", "-v", "ON_ERROR_STOP=1"]);
    const rows = result.stdout.split("\n").filter((line) => line !== "");
    const assertions = rows.map((line) => {
      const [ord, name, status, ...detail] = line.split("|");
      return { ord, name, status, detail: detail.join("|") };
    });
    assert.ok(assertions.length >= 11, result.stderr || result.stdout);
    for (const row of assertions) console.log(`${row.status}\t${row.ord}\t${row.name}\t${row.detail}`);
    for (const row of assertions) {
      assert.equal(row.status, "pass", `${row.ord} ${row.name}: ${row.detail}`);
    }
    assert.equal(result.status, 0, result.stderr);
    committed = true;

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
    assert.equal(audit.population.soi_rows, EXPECTED_UNIVERSE.soi_row_observation_count);
    assert.equal(audit.population.position_observations, EXPECTED_UNIVERSE.position_observation_count);
    assert.equal(audit.population.field_values, EXPECTED_UNIVERSE.position_field_value_count);
    assert.equal(audit.population.no_identifier_rows.count, Number(emptyBefore));
    assert.equal(audit.golden.observations, EXPECTED_UNIVERSE.golden_name_observations);
    assert.equal(scalar(clone, `SELECT c.row_kind::text || ' ' || c.period_role::text || ' ' || (c.evidence_id IS NOT NULL)::text
      FROM obs.current_soi_row_classification c
      JOIN obs.soi_row_observation o ON o.id = c.soi_row_observation_id
      JOIN raw.tabular_row r ON r.id = o.tabular_row_id
      JOIN registry.filing f ON f.id = o.filing_id
      WHERE r.line_number = ${LINE_NUMBER} AND f.accession_number = '${ACCESSION}'`), "SUBTOTAL_ROW UNRESOLVED true");
  } finally {
    dropDatabase(clone);
  }
  assert.equal(committed, true);
  assert.equal(scalar(SOURCE, "SELECT count(*) FROM ops.schema_migration WHERE filename IN ('0021_soi_row_kind.sql', '0022_soi_classification_evidence.sql')"), "0");
  assert.equal(scalar(SOURCE, "SELECT count(*) FROM obs.position_observation"), positionsBefore);
  assert.equal(scalar(SOURCE, "SELECT count(*) FROM obs.soi_row_observation WHERE identifier_raw IS NULL"), emptyBefore);
  assert.equal(scalar(SOURCE, `SELECT string_agg(label, ', ' ORDER BY label) FROM (
      SELECT row_kind::text || '=' || count(*)::text AS label
      FROM obs.soi_row_classification GROUP BY row_kind) s`),
    "IDENTIFIER_ROW=1442423, NO_IDENTIFIER_ROW=512973");
});
