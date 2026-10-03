import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { registerRules } from "../load/rules.mjs";
import { ingestFilingCompanyCell } from "../load/filing-cell.mjs";
import { PARSER_CODE, PARSER_VERSION, parseScheduleDisclosureBlocks } from "../parse/schedule-disclosure-block.mjs";

const dbName = `bdc_fc_${process.pid}`;
const COMPANY = "TEST COMPANY CELL";
const HTML = "<table><tr><td colspan=\"3\">Portfolio Company, Location and Industry(1)</td>"
  + "<td colspan=\"3\">Type of Investment</td><td colspan=\"3\">Fair Value</td></tr>"
  + `<tr><td colspan="3">${COMPANY}</td><td colspan="3"></td><td colspan="3"></td></tr>`
  + "<tr><td colspan=\"3\">Business Services</td><td colspan=\"3\">First Lien</td><td colspan=\"3\">11,952</td></tr></table>";

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
    const savedPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn();
    } finally {
      try { dropDatabase(dbName); } catch { /* the assertion already ran */ }
      if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

test("parser v2 is persisted and FILING_CELL ingestion uses that rule version", withDb(async () => {
  const block = parseScheduleDisclosureBlocks(HTML).blocks[0];
  assert.equal(block.parserVersion, PARSER_VERSION);
  assert.equal(block.companyText, COMPANY);

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
        'SEC_BDC_DATASET_ZIP', 200, 1, repeat('a', 64), '2099-01-01T00:00:00Z', 'test-only/soi',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
VALUES ((SELECT id FROM raw.artifact WHERE sha256 = repeat('a', 64)), 'soi.tsv', 1, repeat('b', 64),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
    parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
VALUES ((SELECT id FROM raw.artifact WHERE sha256 = repeat('a', 64)),
        (SELECT id FROM raw.artifact_member WHERE member_path = 'soi.tsv'),
        'SOI', E'\\t',
        ARRAY['adsh', 'cik', 'name', 'ddate', 'qtrs', 'Investment, Identifier Axis',
              'Investment Owned, Balance, Principal Amount', 'Adjusted cost basis', 'Investment Owned, Cost',
              'Investment Interest Rate', 'Investment, Interest Rate, Paid in Kind'],
        repeat('1', 64),
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.parser'),
        1, 0, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT id, 2,
       '0000000000-00-000001' || E'\\t9999999901\\tTEST BDC 1\\t2099-12-31\\t0\\tTEST BORROWER A | TEST LOAN 1\\t100\\t90\\t\\t0.05\\t0.01',
       encode(sha256(convert_to(
         '0000000000-00-000001' || E'\\t9999999901\\tTEST BDC 1\\t2099-12-31\\t0\\tTEST BORROWER A | TEST LOAN 1\\t100\\t90\\t\\t0.05\\t0.01',
         'UTF8')), 'hex'),
       string_to_array(
         '0000000000-00-000001' || E'\\t9999999901\\tTEST BDC 1\\t2099-12-31\\t0\\tTEST BORROWER A | TEST LOAN 1\\t100\\t90\\t\\t0.05\\t0.01',
         E'\\t'),
       11, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.table_load WHERE table_code = 'SOI';
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
VALUES ('L1_STRUCTURED_DATASET', (SELECT id FROM raw.artifact WHERE sha256 = repeat('a', 64)), 'TSV_ROW',
        (SELECT id FROM raw.tabular_row), (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO registry.filing (accession_number, run_id, evidence_id)
VALUES ('0000000000-00-000001', (SELECT id FROM ops.run WHERE run_kind = 'TEST'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'TSV_ROW'));
INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
    date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
VALUES ((SELECT id FROM raw.tabular_row), (SELECT id FROM registry.filing),
        '2099-12-31', '2099-12-31', 'MONTH_END_ROUNDED', '0', 0, 'POINT_IN_TIME',
        'TEST BORROWER A | TEST LOAN 1',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.project'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'TSV_ROW'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
VALUES ((SELECT id FROM obs.soi_row_observation), 'IDENTIFIER_ROW', 'UNRESOLVED',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.classify'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
    date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
VALUES ((SELECT id FROM obs.soi_row_observation), (SELECT id FROM registry.filing),
        '2099-12-31', 'MONTH_END_ROUNDED', 'POINT_IN_TIME', 'TEST BORROWER A | TEST LOAN 1',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.position'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'TSV_ROW'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
VALUES ((SELECT id FROM obs.position_observation), (SELECT id FROM obs.soi_row_observation), 'PRIMARY',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-block.htm',
        'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-block.htm',
        'SEC_FILING_DOCUMENT', 200, 1, repeat('3', 64), '2099-01-02T00:00:00Z', 'test-only/block',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
VALUES ('L2_ORIGINAL_FILING', (SELECT id FROM raw.artifact WHERE sha256 = repeat('3', 64)), 'DOCUMENT',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
VALUES ((SELECT id FROM registry.filing), 'test-only-block.htm',
        'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only-block.htm',
        'FILING_INDEX_JSON',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.parser'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'DOCUMENT'));
INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES ((SELECT id FROM registry.filing_document),
        (SELECT id FROM raw.artifact WHERE sha256 = repeat('3', 64)),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
COMMIT;
`);

  const runId = Number(scalar("SELECT id FROM ops.run WHERE run_kind = 'TEST'"));
  const rules = registerRules(dbName, runId);
  const parserRuleId = rules[PARSER_CODE];
  assert.equal(Number(scalar(`
SELECT id FROM ops.rule_version
WHERE rule_code = '${PARSER_CODE}' AND version = '${PARSER_VERSION}'`)), parserRuleId);
  assert.equal(scalar(`
SELECT count(*) FROM ops.run_rule_version
WHERE run_id = ${runId} AND rule_version_id = ${parserRuleId}`), "1");

  const artifactId = Number(scalar("SELECT id FROM raw.artifact WHERE sha256 = repeat('3', 64)"));
  const filingId = Number(scalar("SELECT id FROM registry.filing"));
  const positionObservationId = Number(scalar("SELECT id FROM obs.position_observation"));
  const input = {
    database: dbName,
    runId,
    rules,
    html: HTML,
    artifact: { id: artifactId, sourceType: "SEC_FILING_DOCUMENT" },
    filingLink: { artifactId, filingId },
    positionFilingId: filingId,
    positionObservationId,
    evidence: {
      locatorType: "HTML_TABLE_CELL",
      artifactId,
      blockEvidenceId: 1,
      htmlRowOrdinal: block.startRowOrdinal,
      htmlSlotOrdinal: block.portfolioCompanySlot,
    },
    blockEvidence: {
      id: 1,
      locatorType: "DISCLOSURE_BLOCK",
      artifactId,
      htmlRowOrdinal: block.startRowOrdinal,
      htmlRowEndOrdinal: block.endRowOrdinal,
    },
  };

  assert.throws(() => ingestFilingCompanyCell({
    ...input,
    evidence: { ...input.evidence, htmlRowOrdinal: block.startRowOrdinal + 1 },
    rawText: COMPANY,
  }), /cell row is not the block start/);
  assert.equal(scalar("SELECT count(*) FROM obs.borrower_name_observation"), "0");
  assert.equal(scalar("SELECT count(*) FROM evidence.evidence WHERE locator_type = 'DISCLOSURE_BLOCK'"), "0");

  const inserted = ingestFilingCompanyCell({ ...input, rawText: COMPANY });
  assert.equal(inserted.ruleVersionId, parserRuleId);
  assert.equal(inserted.payload.parserVersion, PARSER_VERSION);
  assert.equal(inserted.payload.rawText, COMPANY);
  assert.equal(scalar(`
SELECT rule_version_id::text || ' ' || name_source || ' ' || raw_text || ' ' || extraction_state
       || ' ' || coalesce(normalized_text, '')
FROM obs.borrower_name_observation WHERE id = ${inserted.observationId}`),
  `${parserRuleId} FILING_CELL ${COMPANY} RAW_ONLY `);
  assert.equal(scalar(`
SELECT rv.rule_code || ' ' || rv.version
FROM evidence.evidence cell
JOIN ops.run_rule_version rr ON rr.run_id = cell.run_id AND rr.rule_version_id = ${parserRuleId}
JOIN ops.rule_version rv ON rv.id = rr.rule_version_id
WHERE cell.id = ${inserted.evidenceId}`), `${PARSER_CODE} ${PARSER_VERSION}`);
  assert.equal(scalar(`
SELECT parent.locator_type || ' ' || parent.html_row_ordinal::text || ' ' || parent.html_row_end_ordinal::text
       || ' ' || cell.html_slot_ordinal::text
FROM evidence.evidence cell
JOIN evidence.evidence parent ON parent.id = cell.block_evidence_id
WHERE cell.id = ${inserted.evidenceId}`),
  `DISCLOSURE_BLOCK ${block.startRowOrdinal} ${block.endRowOrdinal} ${block.portfolioCompanySlot}`);
  assert.equal(scalar("SELECT count(*) FROM resolution.entity_resolution_decision"), "0");
  assert.equal(scalar("SELECT count(*) FROM identity.legal_entity"), "0");
}));
