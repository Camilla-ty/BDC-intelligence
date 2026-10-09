import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { readFileSync } from "node:fs";
import { applyP4Min } from "../load/p4-min.mjs";
import { applyP6CompanyCell, planP6CompanyCell } from "../load/p6-company-cell.mjs";
import {
  applyP6CompanyCellSupersession,
  planP6CompanyCellSupersession,
} from "../load/p6-company-cell-supersession.mjs";
import {
  ingestStoredFilingCompanyCell,
  normalizeStoredFilingCompanyCell,
} from "../load/stored-filing-cell.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion, runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { createStore } from "../lib/store.mjs";
import { queryRows } from "../lib/db.mjs";
import { FAKE, p7Sources, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p6cc_${process.pid}`;
const COMPANY = "TEST BORROWER A";
const GEO_COMPANY = "Geo Parent Corporation";
const GEO_FIXTURE = new URL("./fixtures/geo-parent-schedule-block.htm", import.meta.url);

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  return found[0];
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline database tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p6cc-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function identIds(identifier) {
  return rows(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = '${identifier}'
    ORDER BY p.id`).map(Number);
}

function insertCompanyCell(po, tag, runId, rules, companyText = COMPANY) {
  const url = `https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-${tag}.htm`;
  queryRows(dbName, `
WITH art AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('${url}', '${url}', 'SEC_FILING_DOCUMENT', 200, 1, '${createHash("sha256").update(tag).digest("hex")}',
          '2099-01-02T00:00:00Z', 'test-only/${tag}', ${runId})
  RETURNING id
), ev AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  SELECT 'L2_ORIGINAL_FILING'::ref.evidence_level, art.id, 'HTML_ANCHOR'::ref.locator_type,
         'ix-context-row:TEST-ONLY-${tag}', ${runId}
  FROM art
  RETURNING id, artifact_id
), doc AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by,
      rule_version_id, run_id, evidence_id)
  SELECT p.filing_id, 'test-only-${tag}.htm', '${url}', 'FILING_INDEX_JSON', ${rules["norm.borrower_name"]}, ${runId}, ev.id
  FROM obs.position_observation p
  CROSS JOIN ev
  WHERE p.id = ${po}
  RETURNING id
), link AS (
  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  SELECT doc.id, ev.artifact_id, ${runId}
  FROM doc
  CROSS JOIN ev
  RETURNING id
)
INSERT INTO obs.borrower_name_observation (
    position_observation_id, name_source, raw_text, normalized_text, extraction_state,
    rule_version_id, evidence_id, run_id)
SELECT ${po}, 'FILING_CELL', '${companyText}', '${companyText}', 'EXTRACTED',
       ${rules["norm.borrower_name"]}, ev.id, ${runId}
FROM ev
CROSS JOIN link;`);
}

function decisionRows() {
  return rows(`SELECT d.id, d.borrower_name_observation_id, coalesce(d.legal_entity_id::text, ''), d.state, d.method,
      d.rationale, d.evidence_id, d.rule_version_id, d.run_id, coalesce(d.supersedes_id::text, ''), d.decided_at
    FROM resolution.entity_resolution_decision d ORDER BY d.id`);
}

test("P6 company cell: one legal entity from the company cell, the rest UNRESOLVED, append-only rerun", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir, p7Sources());
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const groupA = identIds(FAKE.ident);
  const group2 = identIds(FAKE.ident2);
  assert.ok(groupA.length >= 3);
  assert.equal(group2.length, 1);
  const all = [...groupA, ...group2].sort((left, right) => left - right);

  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('ELIGIBLE_INSTRUMENT_RESOLUTION', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  assert.ok(rules["resolution.entity_exact_company_cell_name"]);
  for (const [identifier, ids] of [[FAKE.ident, groupA], [FAKE.ident2, group2]]) {
    applyP4Min({
      database: dbName,
      positionObservationIds: ids,
      runId,
      rules,
      identifierSha256: createHash("sha256").update(identifier, "utf8").digest("hex"),
    });
  }

  // The company cell is on one cik2 observation of identifier A and on the identifier 2 observation (cik1).
  const cik2A = Number(scalar(`SELECT p.id FROM obs.position_observation p
    JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id
    JOIN registry.registrant r ON r.id = fr.registrant_id
    WHERE p.id IN (${groupA.join(",")}) AND r.cik = ${FAKE.cik2}
    ORDER BY p.id LIMIT 1`));
  const withCell = [cik2A, group2[0]].sort((left, right) => left - right);
  const withoutCell = all.filter((id) => !withCell.includes(id));
  insertCompanyCell(cik2A, "cc-a", runId, rules);
  insertCompanyCell(group2[0], "cc-2", runId, rules);

  const plan = planP6CompanyCell(dbName, all);
  assert.deepEqual(plan.newEntities.map((entity) => entity.aliasText), [COMPANY]);
  assert.equal(plan.alreadyDecided, 0);

  const counts = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId, rules });
  assert.deepEqual(counts, {
    legal_entities_created: 1,
    matched_inserted: 2,
    unresolved_inserted: withoutCell.length,
    already_decided: 0,
  });

  assert.equal(scalar("SELECT count(*) FROM identity.legal_entity"), "1");
  assert.deepEqual(rows("SELECT alias_text FROM identity.legal_entity_alias"), [COMPANY]);
  assert.equal(scalar(`SELECT count(*) FROM identity.legal_entity_alias
    WHERE alias_text LIKE '%|%' OR alias_text LIKE '%TEST LOAN%'`), "0");
  assert.equal(scalar("SELECT count(*) FROM identity.economic_group"), "0");

  assert.deepEqual(rows(`SELECT b.position_observation_id FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE d.state = 'MATCHED' AND d.method = 'EXACT_COMPANY_CELL_NAME'
      AND b.source_column_label = 'Investment, Identifier Axis'
    ORDER BY 1`).map(Number), withCell);
  assert.equal(scalar(`SELECT count(DISTINCT d.legal_entity_id) FROM resolution.current_entity_resolution d
    WHERE d.state = 'MATCHED'`), "1");
  assert.equal(scalar(`SELECT count(*) FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation f ON f.evidence_id = d.evidence_id AND f.name_source = 'FILING_CELL'
    WHERE d.state = 'MATCHED'`), "2");
  assert.deepEqual(rows(`SELECT b.position_observation_id FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE d.state = 'UNRESOLVED' AND d.method = 'NO_COMPANY_NAME_EVIDENCE' AND d.legal_entity_id IS NULL
      AND d.evidence_id = b.evidence_id
    ORDER BY 1`).map(Number), withoutCell);

  assert.deepEqual(rows("SELECT position_observation_id FROM registry.matched_entity_position ORDER BY 1").map(Number), withCell);

  const before = decisionRows();
  const aliasesBefore = rows("SELECT id, legal_entity_id, alias_text FROM identity.legal_entity_alias ORDER BY id");
  const rerun = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId, rules });
  assert.deepEqual(rerun, {
    legal_entities_created: 0, matched_inserted: 0, unresolved_inserted: 0, already_decided: all.length,
  });
  assert.deepEqual(decisionRows(), before);
  assert.deepEqual(rows("SELECT id, legal_entity_id, alias_text FROM identity.legal_entity_alias ORDER BY id"), aliasesBefore);

  // Company evidence that arrives later does not update an existing UNRESOLVED decision.
  insertCompanyCell(withoutCell[0], "cc-late", runId, rules);
  const late = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId, rules });
  assert.equal(late.matched_inserted, 0);
  assert.equal(late.unresolved_inserted, 0);
  assert.deepEqual(decisionRows(), before);
  assert.deepEqual(rows("SELECT position_observation_id FROM registry.matched_entity_position ORDER BY 1").map(Number), withCell);
}));

function startRun(kind) {
  return Number(query(dbName, `
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('${kind}', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now())
RETURNING id::text`)[0]);
}

test("NO_COMPANY_NAME_EVIDENCE supersession matches an existing alias after stored-HTML ingest", withDb(async (dataDir) => {
  const html = readFileSync(GEO_FIXTURE);
  const put = createStore(dataDir).put(html);
  const shaZip = createHash("sha256").update("geo-parent-soi-zip").digest("hex");
  query(dbName, `
BEGIN;
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST_GEO', 'test', '{}'::jsonb, now());
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES
  ('test.parser', 'PARSER', 'test-1', repeat('c', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests'),
  ('test.project', 'NORMALIZATION', 'test-1', repeat('d', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests'),
  ('test.position', 'NORMALIZATION', 'test-1', repeat('e', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests'),
  ('test.classify', 'CLASSIFICATION', 'test-1', repeat('f', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests');
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('https://www.sec.gov/files/TEST-ONLY/geo-parent.zip', 'https://www.sec.gov/files/TEST-ONLY/geo-parent.zip',
        'SEC_BDC_DATASET_ZIP', 200, 1, '${shaZip}', '2099-01-01T00:00:00Z', 'test-only/geo-soi',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'));
INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
VALUES ((SELECT id FROM raw.artifact WHERE sha256 = '${shaZip}'), 'soi.tsv', 1, repeat('b', 64),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'));
INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
    parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
VALUES ((SELECT id FROM raw.artifact WHERE sha256 = '${shaZip}'),
        (SELECT id FROM raw.artifact_member WHERE member_path = 'soi.tsv'),
        'SOI', E'\\t',
        ARRAY['adsh', 'cik', 'name', 'ddate', 'qtrs', 'Investment, Identifier Axis',
              'Investment Owned, Balance, Principal Amount', 'Adjusted cost basis', 'Investment Owned, Cost',
              'Investment Interest Rate', 'Investment, Interest Rate, Paid in Kind'],
        repeat('1', 64),
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.parser'),
        3, 0, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'));
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT tl.id, v.line_number, v.raw_line, encode(sha256(convert_to(v.raw_line, 'UTF8')), 'hex'),
       string_to_array(v.raw_line, E'\\t'), 11, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM raw.table_load tl
CROSS JOIN (VALUES
  (2, '0001925531-24-000004' || E'\\t0001925531\\tTEST BDC\\t20231231\\t0\\tGeo Parent Corporation, First Lien\\t100\\t90\\t\\t0.10\\t'),
  (3, '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 1\\t17717000\\t17478000\\t\\t0.105\\t'),
  (4, '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 2\\t3299000\\t3299000\\t\\t0.105\\t')
) AS v(line_number, raw_line)
WHERE tl.table_code = 'SOI';
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
SELECT 'L1_STRUCTURED_DATASET', (SELECT id FROM raw.artifact WHERE sha256 = '${shaZip}'), 'TSV_ROW',
       tr.id, (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM raw.tabular_row tr ORDER BY tr.id;
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id,
    column_position, column_label, run_id)
SELECT 'L1_STRUCTURED_DATASET', (SELECT id FROM raw.artifact WHERE sha256 = '${shaZip}'), 'TSV_CELL',
       tr.id, 6, 'Investment, Identifier Axis', (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM raw.tabular_row tr ORDER BY tr.id;
INSERT INTO registry.filing (accession_number, run_id, evidence_id)
VALUES
  ('0001925531-24-000004', (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'),
   (SELECT e.id FROM evidence.evidence e JOIN raw.tabular_row tr ON tr.id = e.tabular_row_id
    WHERE tr.line_number = 2 AND e.locator_type = 'TSV_ROW')),
  ('0001925531-24-000016', (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'),
   (SELECT e.id FROM evidence.evidence e JOIN raw.tabular_row tr ON tr.id = e.tabular_row_id
    WHERE tr.line_number = 3 AND e.locator_type = 'TSV_ROW'));
INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
    date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
SELECT tr.id,
       CASE WHEN tr.line_number = 2 THEN (SELECT id FROM registry.filing WHERE accession_number = '0001925531-24-000004')
            ELSE (SELECT id FROM registry.filing WHERE accession_number = '0001925531-24-000016') END,
       CASE WHEN tr.line_number = 2 THEN '20231231' ELSE '20240630' END,
       CASE WHEN tr.line_number = 2 THEN DATE '2023-12-31' ELSE DATE '2024-06-30' END,
       'MONTH_END_ROUNDED', '0', 0, 'POINT_IN_TIME', tr.cells[6],
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.project'),
       e.id, (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM raw.tabular_row tr
JOIN evidence.evidence e ON e.tabular_row_id = tr.id AND e.locator_type = 'TSV_ROW'
ORDER BY tr.id;
INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
SELECT id, 'IDENTIFIER_ROW', 'UNRESOLVED',
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.classify'),
       (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM obs.soi_row_observation;
INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
    date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
SELECT s.id, s.filing_id, s.reported_date, s.date_precision, s.duration_kind, s.identifier_raw,
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.position'),
       s.evidence_id, (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM obs.soi_row_observation s ORDER BY s.id;
INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
SELECT p.id, p.origin_soi_row_observation_id, 'PRIMARY', (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM obs.position_observation p;
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('https://www.sec.gov/Archives/edgar/data/1925531/000192553124000016/nmg4-20240630.htm',
        'https://www.sec.gov/Archives/edgar/data/1925531/000192553124000016/nmg4-20240630.htm',
        'SEC_FILING_DOCUMENT', 200, ${put.byteSize}, '${put.sha256}', '2099-01-02T00:00:00Z', '${put.storageKey}',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'));
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
VALUES ('L2_ORIGINAL_FILING', (SELECT id FROM raw.artifact WHERE sha256 = '${put.sha256}'), 'DOCUMENT',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'));
INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
VALUES ((SELECT id FROM registry.filing WHERE accession_number = '0001925531-24-000016'), 'nmg4-20240630.htm',
        'https://www.sec.gov/Archives/edgar/data/1925531/000192553124000016/nmg4-20240630.htm',
        'SUBMISSIONS_PRIMARY_DOCUMENT',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.parser'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'DOCUMENT'
           AND artifact_id = (SELECT id FROM raw.artifact WHERE sha256 = '${put.sha256}')));
INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES ((SELECT id FROM registry.filing_document),
        (SELECT id FROM raw.artifact WHERE sha256 = '${put.sha256}'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO'));
INSERT INTO obs.borrower_name_observation (
  position_observation_id, name_source, source_column_label, source_column_position, raw_text, normalized_text,
  extraction_state, rule_version_id, evidence_id, run_id)
SELECT p.id, 'SOI_CELL', 'Investment, Identifier Axis', 6, s.identifier_raw, s.identifier_raw, 'EXTRACTED',
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.project'),
       cell.id, (SELECT id FROM ops.run WHERE run_kind = 'TEST_GEO')
FROM obs.position_observation p
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
JOIN evidence.evidence cell ON cell.tabular_row_id = s.tabular_row_id
  AND cell.locator_type = 'TSV_CELL' AND cell.column_position = 6;
COMMIT;`);

  const seed = Number(scalar(`
SELECT p.id FROM obs.position_observation p
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
WHERE s.identifier_raw = 'Geo Parent Corporation, First Lien'`));
  const target = Number(scalar(`
SELECT p.id FROM obs.position_observation p
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
WHERE s.identifier_raw = 'Geo Parent Corporation, First Lien 1'`));
  const control = Number(scalar(`
SELECT p.id FROM obs.position_observation p
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
WHERE s.identifier_raw = 'Geo Parent Corporation, First Lien 2'`));
  const all = [seed, target, control].sort((left, right) => left - right);

  const run49 = startRun("ELIGIBLE_INSTRUMENT_RESOLUTION");
  const rules = registerRules(dbName, run49);
  insertCompanyCell(seed, "geo-seed", run49, rules, GEO_COMPANY);

  const first = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId: run49, rules });
  assert.deepEqual(first, {
    legal_entities_created: 1,
    matched_inserted: 1,
    unresolved_inserted: 2,
    already_decided: 0,
  });
  assert.equal(scalar(`SELECT method FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id = ${target}`), "NO_COMPANY_NAME_EVIDENCE");
  assert.equal(scalar(`SELECT method FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id = ${control}`), "NO_COMPANY_NAME_EVIDENCE");
  const entityId = scalar("SELECT id::text FROM identity.legal_entity");
  const priorTargetDecision = Number(scalar(`
SELECT d.id FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
WHERE b.position_observation_id = ${target}`));
  const before = decisionRows();

  const ingested = ingestStoredFilingCompanyCell({
    database: dbName,
    dataDir,
    runId: startRun("STORED_COMPANY_CELL_INGEST"),
    positionObservationId: target,
    companyText: GEO_COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien 1",
  });
  assert.equal(ingested.status, "INSERTED");
  normalizeStoredFilingCompanyCell(dbName, {
    runId: startRun("BORROWER_NAME_NORMALIZE"),
    rootId: ingested.observationId,
  });

  const blocked = applyP6CompanyCell({ database: dbName, positionObservationIds: all, runId: run49, rules });
  assert.deepEqual(blocked, {
    legal_entities_created: 0, matched_inserted: 0, unresolved_inserted: 0, already_decided: 3,
  });
  assert.deepEqual(decisionRows(), before);

  const planned = planP6CompanyCellSupersession(dbName, [target, control]);
  assert.equal(planned.decisions.length, 1);
  assert.equal(planned.decisions[0].positionObservationId, target);
  assert.equal(planned.decisions[0].legalEntityId, entityId);
  assert.equal(planned.skippedNoCompanyName, 1);

  const supersessionRun = startRun("COMPANY_CELL_SUPERSESSION");
  const reason = "TEST ONLY: company-cell evidence arrived after run-49-style NO_COMPANY_NAME_EVIDENCE";
  const applied = applyP6CompanyCellSupersession({
    database: dbName,
    positionObservationIds: [target, control],
    runId: supersessionRun,
    rules,
    supersedeReason: reason,
  });
  assert.deepEqual(applied, {
    matched_superseded: 1,
    prior_unresolved: 2,
    skipped_no_prior: 0,
    skipped_no_company_name: 1,
    skipped_no_existing_alias: 0,
  });

  const filingCellEvidenceId = Number(scalar(`
SELECT b.evidence_id::text FROM obs.current_borrower_name_observation b
WHERE b.position_observation_id = ${target} AND b.name_source = 'FILING_CELL'
  AND b.extraction_state = 'EXTRACTED'`));
  assert.equal(scalar(`
SELECT d.state || '|' || d.method || '|' || d.legal_entity_id::text || '|' || d.supersedes_id::text
       || '|' || d.supersede_reason || '|' || d.evidence_id::text
FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
WHERE b.position_observation_id = ${target}`),
  `MATCHED|EXACT_COMPANY_CELL_NAME|${entityId}|${priorTargetDecision}|${reason}|${filingCellEvidenceId}`);
  assert.equal(scalar(`
SELECT a.alias_text || '|' || (a.legal_entity_id = d.legal_entity_id)::text
FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
JOIN identity.legal_entity_alias a ON a.legal_entity_id = d.legal_entity_id
JOIN ops.rule_version rv ON rv.id = a.rule_version_id
WHERE b.position_observation_id = ${target}
  AND rv.rule_code = 'resolution.entity_exact_company_cell_name'
  AND a.verification_state = 'VERIFIED'
  AND a.alias_text = '${GEO_COMPANY}'
  AND NOT EXISTS (SELECT 1 FROM identity.legal_entity_alias s WHERE s.supersedes_id = a.id)`),
  `${GEO_COMPANY}|true`);
  assert.equal(scalar(`
SELECT (b.evidence_id = d.evidence_id AND b.normalized_text = '${GEO_COMPANY}')::text
FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation idn ON idn.id = d.borrower_name_observation_id
JOIN obs.current_borrower_name_observation b ON b.position_observation_id = idn.position_observation_id
WHERE idn.position_observation_id = ${target}
  AND b.name_source = 'FILING_CELL' AND b.extraction_state = 'EXTRACTED'`), "true");
  assert.equal(scalar(`
SELECT d.state || '|' || d.method FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
WHERE b.position_observation_id = ${control}`), "UNRESOLVED|NO_COMPANY_NAME_EVIDENCE");
  assert.deepEqual(rows(`
SELECT position_observation_id FROM registry.matched_entity_position ORDER BY 1`).map(Number),
  [seed, target].sort((left, right) => left - right));
  assert.equal(scalar("SELECT count(*) FROM identity.legal_entity"), "1");
  assert.equal(scalar(`
SELECT count(*)::text FROM resolution.entity_resolution_decision
WHERE id = ${priorTargetDecision}`), "1");
  assert.equal(scalar(`
SELECT count(*)::text FROM resolution.entity_resolution_decision
WHERE supersedes_id = ${priorTargetDecision}`), "1");

  const again = applyP6CompanyCellSupersession({
    database: dbName,
    positionObservationIds: [target, control],
    runId: startRun("COMPANY_CELL_SUPERSESSION"),
    rules,
    supersedeReason: reason,
  });
  assert.equal(again.matched_superseded, 0);
  assert.equal(again.skipped_no_prior, 1);
  assert.equal(again.skipped_no_company_name, 1);
}));
