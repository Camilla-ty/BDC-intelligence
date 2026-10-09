import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createStore } from "../lib/store.mjs";
import { lit } from "../lib/db.mjs";
import { loadCompanyCellInputs } from "../load/p6-company-cell.mjs";
import {
  findCompanyBlock,
  ingestStoredFilingCompanyCell,
  normalizeStoredFilingCompanyCell,
} from "../load/stored-filing-cell.mjs";
import { parseScheduleDisclosureBlocks } from "../parse/schedule-disclosure-block.mjs";

const dbName = `bdc_sfc_${process.pid}`;
const COMPANY = "Geo Parent Corporation";
const FIXTURE = new URL("./fixtures/geo-parent-schedule-block.htm", import.meta.url);
const REAL_NMG4 = ".data/sec/raw/sha256/c2/c20adec5bed72b1b59b706ea5396efb77888ee25bc1a40bda29c1518a6d6e05b";
const REAL_ARTIFACTS = Object.freeze({
  363: ".data/sec/raw/sha256/bd/bd067eba79026c2d3ee92dc7702b68013cd76628b91a59590d730ce4bd533519",
  364: ".data/sec/raw/sha256/83/833590b020c2958a666dce2c9c09918aaa98308e5adff4a9339f104299dc1603",
  368: REAL_NMG4,
  369: ".data/sec/raw/sha256/e0/e0c6e1728e2ef4bc1f0bea545fab669d4a9f96a826cfcffc74c997f37d594f32",
});

function scalar(sql) {
  const found = query(dbName, sql);
  assert.equal(found.length, 1, sql);
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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-sfc-"));
    const savedPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(t, dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* assertion already ran */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function startRun(kind) {
  return Number(query(dbName, `
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES (${lit(kind)}, 'test', '{}'::jsonb, now())
RETURNING id::text`)[0]);
}

function plantTwoPositions(dataDir, html) {
  const put = createStore(dataDir).put(Buffer.from(html, "utf8"));
  const shaZip = "a".repeat(64);
  query(dbName, `
BEGIN;
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST', 'test', '{}'::jsonb, now());
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES
  ('test.parser', 'PARSER', 'test-1', repeat('c', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests'),
  ('test.project', 'NORMALIZATION', 'test-1', repeat('d', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests'),
  ('test.position', 'NORMALIZATION', 'test-1', repeat('e', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests'),
  ('test.classify', 'CLASSIFICATION', 'test-1', repeat('f', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests');
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('https://www.sec.gov/files/TEST-ONLY/test-dataset.zip', 'https://www.sec.gov/files/TEST-ONLY/test-dataset.zip',
        'SEC_BDC_DATASET_ZIP', 200, 1, '${shaZip}', '2099-01-01T00:00:00Z', 'test-only/soi',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
VALUES ((SELECT id FROM raw.artifact WHERE sha256 = '${shaZip}'), 'soi.tsv', 1, repeat('b', 64),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
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
        2, 0, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT id, 2,
       '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 1\\t17717000\\t17478000\\t\\t0.105\\t',
       encode(sha256(convert_to(
         '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 1\\t17717000\\t17478000\\t\\t0.105\\t',
         'UTF8')), 'hex'),
       string_to_array(
         '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 1\\t17717000\\t17478000\\t\\t0.105\\t',
         E'\\t'),
       11, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.table_load WHERE table_code = 'SOI';
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT id, 3,
       '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 2\\t3299000\\t3299000\\t\\t0.105\\t',
       encode(sha256(convert_to(
         '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 2\\t3299000\\t3299000\\t\\t0.105\\t',
         'UTF8')), 'hex'),
       string_to_array(
         '0001925531-24-000016' || E'\\t0001925531\\tTEST BDC\\t20240630\\t0\\tGeo Parent Corporation, First Lien 2\\t3299000\\t3299000\\t\\t0.105\\t',
         E'\\t'),
       11, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.table_load WHERE table_code = 'SOI';
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
SELECT 'L1_STRUCTURED_DATASET', (SELECT id FROM raw.artifact WHERE sha256 = '${shaZip}'), 'TSV_ROW',
       tr.id, (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.tabular_row tr ORDER BY tr.id;
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id,
    column_position, column_label, run_id)
SELECT 'L1_STRUCTURED_DATASET', (SELECT id FROM raw.artifact WHERE sha256 = '${shaZip}'), 'TSV_CELL',
       tr.id, 6, 'Investment, Identifier Axis', (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.tabular_row tr ORDER BY tr.id;
INSERT INTO registry.filing (accession_number, run_id, evidence_id)
VALUES ('0001925531-24-000016', (SELECT id FROM ops.run WHERE run_kind = 'TEST'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'TSV_ROW' ORDER BY id LIMIT 1));
INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
    date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
SELECT tr.id, (SELECT id FROM registry.filing), '20240630', '2024-06-30', 'MONTH_END_ROUNDED', '0', 0, 'POINT_IN_TIME',
       tr.cells[6],
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.project'),
       e.id, (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.tabular_row tr
JOIN evidence.evidence e ON e.tabular_row_id = tr.id AND e.locator_type = 'TSV_ROW'
ORDER BY tr.id;
INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
SELECT id, 'IDENTIFIER_ROW', 'UNRESOLVED',
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.classify'),
       (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM obs.soi_row_observation;
INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
    date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
SELECT s.id, s.filing_id, s.reported_date, s.date_precision, s.duration_kind, s.identifier_raw,
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.position'),
       s.evidence_id, (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM obs.soi_row_observation s ORDER BY s.id;
INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
SELECT p.id, p.origin_soi_row_observation_id, 'PRIMARY', (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM obs.position_observation p;
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('https://www.sec.gov/Archives/edgar/data/1925531/000192553124000016/nmg4-20240630.htm',
        'https://www.sec.gov/Archives/edgar/data/1925531/000192553124000016/nmg4-20240630.htm',
        'SEC_FILING_DOCUMENT', 200, ${put.byteSize}, '${put.sha256}', '2099-01-02T00:00:00Z', '${put.storageKey}',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
VALUES ('L2_ORIGINAL_FILING', (SELECT id FROM raw.artifact WHERE sha256 = '${put.sha256}'), 'DOCUMENT',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
VALUES ((SELECT id FROM registry.filing), 'nmg4-20240630.htm',
        'https://www.sec.gov/Archives/edgar/data/1925531/000192553124000016/nmg4-20240630.htm',
        'SUBMISSIONS_PRIMARY_DOCUMENT',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.parser'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'DOCUMENT'));
INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES ((SELECT id FROM registry.filing_document),
        (SELECT id FROM raw.artifact WHERE sha256 = '${put.sha256}'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO obs.borrower_name_observation (
  position_observation_id, name_source, source_column_label, source_column_position, raw_text, normalized_text,
  extraction_state, rule_version_id, evidence_id, run_id)
SELECT p.id, 'SOI_CELL', 'Investment, Identifier Axis', 6, s.identifier_raw, s.identifier_raw, 'EXTRACTED',
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.project'),
       cell.id, (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM obs.position_observation p
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
JOIN evidence.evidence cell ON cell.tabular_row_id = s.tabular_row_id
  AND cell.locator_type = 'TSV_CELL' AND cell.column_position = 6;
COMMIT;
`);
  const ids = query(dbName, `SELECT id::text FROM obs.position_observation ORDER BY id`).map(Number);
  assert.equal(ids.length, 2);
  return {
    lien1: ids[0],
    lien2: ids[1],
    artifactId: Number(scalar(`SELECT id::text FROM raw.artifact WHERE sha256 = '${put.sha256}'`)),
    sha256: put.sha256,
  };
}

test("fixture Geo Parent HTML yields one company cell for First Lien 1 and 2", () => {
  const html = readFileSync(FIXTURE, "utf8");
  const block = findCompanyBlock(html, {
    companyText: COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien 1",
  });
  assert.equal(block.companyText, COMPANY);
  assert.equal(block.portfolioCompanySlot, 0);
  const domains = block.rows.flatMap((row) => (row.lines ?? []).map((line) => line.domain));
  assert.deepEqual(domains, [
    "Geo Parent Corporation, First Lien 1",
    "Geo Parent Corporation, First Lien 2",
  ]);
});

test("investment domain matching is exact and refuses trailing-space comparative domains", () => {
  const html = readFileSync(FIXTURE, "utf8");
  assert.throws(
    () => findCompanyBlock(html, {
      companyText: COMPANY,
      investmentDomain: "Geo Parent Corporation, First Lien 1 ",
    }),
    /no block .* carries exact investment domain/,
  );
  const real363 = REAL_ARTIFACTS[363];
  if (!existsSync(real363)) {
    // Covered when .data is present; fixture path still asserts exactness above.
    return;
  }
  const nmslf = readFileSync(real363);
  // SOI Identifier Axis bytes "Geo Parent Corporation, First Lien" select the primary block only.
  const primary = findCompanyBlock(nmslf, {
    companyText: COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien",
  });
  assert.equal(primary.startRowOrdinal, 386);
  // The comparative block's domain differs by a trailing space; exact equality keeps them distinct.
  const comparative = findCompanyBlock(nmslf, {
    companyText: COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien ",
  });
  assert.equal(comparative.startRowOrdinal, 1202);
  assert.notEqual(comparative.startRowOrdinal, primary.startRowOrdinal);
});

test("stored-HTML company-cell ingest binds EXTRACTED evidence to one observation only", withDb(async (_t, dataDir) => {
  const html = readFileSync(FIXTURE, "utf8");
  const planted = plantTwoPositions(dataDir, html);
  const beforeNames = Number(scalar("SELECT count(*)::text FROM obs.borrower_name_observation"));
  const beforeEvidence = Number(scalar("SELECT count(*)::text FROM evidence.evidence"));

  const first = ingestStoredFilingCompanyCell({
    database: dbName,
    dataDir,
    runId: startRun("STORED_COMPANY_CELL_INGEST"),
    positionObservationId: planted.lien1,
    companyText: COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien 1",
  });
  assert.equal(first.status, "INSERTED");
  assert.equal(first.positionObservationId, planted.lien1);
  assert.equal(first.rawText, COMPANY);
  assert.equal(first.extractionState, "RAW_ONLY");
  assert.equal(first.artifactId, planted.artifactId);

  const normalized = normalizeStoredFilingCompanyCell(dbName, {
    runId: startRun("BORROWER_NAME_NORMALIZE"),
    rootId: first.observationId,
  });
  assert.equal(normalized.plan.inserts.length, 1);
  assert.equal(scalar(`
SELECT extraction_state || '|' || normalized_text || '|' || position_observation_id::text
FROM obs.current_borrower_name_observation
WHERE name_source = 'FILING_CELL' AND position_observation_id = ${planted.lien1}`),
  `EXTRACTED|${COMPANY}|${planted.lien1}`);

  const inputs = loadCompanyCellInputs(dbName, [planted.lien1, planted.lien2]);
  const byId = Object.fromEntries(inputs.map((row) => [row.id, row]));
  assert.equal(byId[planted.lien1].filingCells.length, 1);
  assert.equal(byId[planted.lien1].filingCells[0].normalizedText, COMPANY);
  assert.equal(byId[planted.lien2].filingCells.length, 0);
  assert.equal(byId[planted.lien1].issuerNames.length, 0);
  assert.equal(byId[planted.lien2].issuerNames.length, 0);

  const again = ingestStoredFilingCompanyCell({
    database: dbName,
    dataDir,
    runId: startRun("STORED_COMPANY_CELL_INGEST"),
    positionObservationId: planted.lien1,
    companyText: COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien 1",
  });
  assert.equal(again.status, "ALREADY_PRESENT");
  assert.equal(again.observationId, Number(scalar(`
SELECT id::text FROM obs.current_borrower_name_observation
WHERE name_source = 'FILING_CELL' AND position_observation_id = ${planted.lien1}`)));
  assert.equal(Number(scalar("SELECT count(*)::text FROM obs.borrower_name_observation WHERE name_source = 'FILING_CELL'")), 2);
  assert.equal(Number(scalar(`
SELECT count(*)::text FROM obs.borrower_name_observation
WHERE name_source = 'FILING_CELL' AND position_observation_id = ${planted.lien2}`)), 0);
  assert.ok(Number(scalar("SELECT count(*)::text FROM obs.borrower_name_observation")) >= beforeNames + 2);
  assert.ok(Number(scalar("SELECT count(*)::text FROM evidence.evidence")) > beforeEvidence);

  const second = ingestStoredFilingCompanyCell({
    database: dbName,
    dataDir,
    runId: startRun("STORED_COMPANY_CELL_INGEST"),
    positionObservationId: planted.lien2,
    companyText: COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien 2",
  });
  assert.equal(second.status, "INSERTED");
  assert.equal(second.positionObservationId, planted.lien2);
  normalizeStoredFilingCompanyCell(dbName, {
    runId: startRun("BORROWER_NAME_NORMALIZE"),
    rootId: second.observationId,
  });
  const after = loadCompanyCellInputs(dbName, [planted.lien1, planted.lien2]);
  assert.deepEqual(after.map((row) => [row.id, row.filingCells.length]).sort((a, b) => a[0] - b[0]), [
    [planted.lien1, 1],
    [planted.lien2, 1],
  ]);
  assert.equal(after[0].filingCells[0].evidenceId === after[1].filingCells[0].evidenceId, false);
}));

test("real Geo Parent artifacts 363/364/368/369 still expose the company cell when present", (t) => {
  const missing = Object.entries(REAL_ARTIFACTS).filter(([, file]) => !existsSync(file));
  if (missing.length > 0) {
    t.skip(`real-filing validation outstanding; missing artifacts ${missing.map(([id]) => id).join(",")}`);
    return;
  }
  for (const [id, file] of Object.entries(REAL_ARTIFACTS)) {
    const { blocks } = parseScheduleDisclosureBlocks(readFileSync(file));
    const geos = blocks.filter((block) => block.companyText === COMPANY);
    assert.ok(geos.length >= 1, `artifact ${id} should contain ${COMPANY}`);
    assert.ok(geos.every((block) => block.portfolioCompanySlot === 0));
  }
  const nmg4 = findCompanyBlock(readFileSync(REAL_NMG4), {
    companyText: COMPANY,
    investmentDomain: "Geo Parent Corporation, First Lien 1",
  });
  assert.equal(nmg4.companyText, COMPANY);
  assert.ok(createHash("sha256").update(readFileSync(REAL_NMG4)).digest("hex").startsWith("c20adec5"));
});
