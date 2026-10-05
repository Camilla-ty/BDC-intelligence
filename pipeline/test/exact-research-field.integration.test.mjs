import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { ingestFilingCompanyCell } from "../load/filing-cell.mjs";
import { RULES, ruleDefinitionSha } from "../load/rules.mjs";
import { ingestExactResearchFields } from "../load/exact-research-field.mjs";
import { PARSER_CODE, PARSER_VERSION, parseScheduleDisclosureBlocks } from "../parse/schedule-disclosure-block.mjs";

const dbName = `bdc_rf_${process.pid}`;
const PERIOD = "2099-09-30";
const OTHER_PERIOD = "2099-06-30";
const HOLDING = "TEST HOLDING, First Lien 1";
const SIBLING = "TEST HOLDING, First Lien 2";
const INSTRUMENT = "First lien (2)(3)";
const PARSER_SHA = "6356c716c4ec99d7cd3959a199c1812c16d3b595814ab8b86c0aca437c666d65";

function td(text, colspan = 3) {
  return `<td colspan="${colspan}">${text}</td>`;
}

function context(id, domain, period) {
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:segment>`
    + `<xbrldi:typedMember dimension="us-gaap:InvestmentIdentifierAxis">`
    + `<us-gaap:InvestmentIdentifierAxis.domain>${domain}</us-gaap:InvestmentIdentifierAxis.domain>`
    + `</xbrldi:typedMember></xbrli:segment></xbrli:entity>`
    + `<xbrli:period><xbrli:instant>${period}</xbrli:instant></xbrli:period></xbrli:context>`;
}

function fact(id, contextId) {
  return `<ix:nonFraction id="${id}" contextRef="${contextId}" name="us-gaap:InvestmentOwnedAtFairValue">11</ix:nonFraction>`;
}

function header() {
  return `<tr>${td("Portfolio Company, Location and Industry(1)")}${td("Type of Investment")}${td("Fair Value")}</tr>`;
}

function companyRow(name) {
  return `<tr>${td(name)}${td("")}${td("")}</tr>`;
}

function detailRow(industry, type, factHtml) {
  return `<tr>${td(industry)}${td(type)}${td(factHtml)}</tr>`;
}

function v2Schedule(contextsHtml, body) {
  return `${contextsHtml}<table>${header()}${body}</table>`;
}

const exactHtml = v2Schedule(
  context("c1", HOLDING, PERIOD) + context("c2", SIBLING, PERIOD),
  companyRow("TEST COMPANY")
    + detailRow("TEST INDUSTRY CELL", INSTRUMENT, fact("f1", "c1"))
    + detailRow("", "First Lien(4)", fact("f2", "c2")),
);

const trailingHtml = v2Schedule(
  context("c1", `${HOLDING} `, PERIOD),
  companyRow("TEST COMPANY") + detailRow("TEST INDUSTRY CELL", INSTRUMENT, fact("f1", "c1")),
);

const wrongPeriodHtml = v2Schedule(
  context("c1", HOLDING, OTHER_PERIOD),
  companyRow("TEST COMPANY") + detailRow("TEST INDUSTRY CELL", INSTRUMENT, fact("f1", "c1")),
);

const singleRowHtml = context("c1", HOLDING, PERIOD)
  + "<table><tr>"
  + td("Portfolio Company") + td("Industry") + td("Type") + td("Date") + td("Fair Value")
  + "</tr><tr>"
  + td("TEST COMPANY") + td("Building products") + td("First Lien") + td("12/19/2099") + td(fact("f1", "c1"))
  + "</tr></table>";

function nameHtml(name) {
  return v2Schedule(
    context("c1", `${name}, First Lien`, PERIOD),
    companyRow(name) + detailRow("UNUSED INDUSTRY", "UNUSED TYPE", fact("f1", "c1")),
  );
}

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

function seedPosition(n, holding) {
  const accession = `0000000000-00-${String(n).padStart(6, "0")}`;
  const lineSql = `'${accession}' || E'\\t9999999901\\tTEST BDC\\t${PERIOD}\\t0\\t${holding}\\t100\\t90\\t\\t0.05\\t0.01'`;
  const zipSha = `${n}`.padStart(64, "b");
  const memberSha = `${n}`.padStart(64, "d");
  const filingSha = `${n}`.padStart(64, "c");
  const url = `https://www.sec.gov/Archives/edgar/data/9999999901/00000000000000000${n}/test-only-${n}.htm`;
  query(dbName, `
BEGIN;
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('https://www.sec.gov/files/TEST-ONLY/test-dataset-${n}.zip', 'https://www.sec.gov/files/TEST-ONLY/test-dataset-${n}.zip',
        'SEC_BDC_DATASET_ZIP', 200, 1, '${zipSha}', '2099-01-01T00:00:00Z', 'test-only/soi-${n}',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.artifact_member (artifact_id, member_path, byte_size, sha256, run_id)
VALUES ((SELECT id FROM raw.artifact WHERE sha256 = '${zipSha}'), 'soi.tsv', 1, '${memberSha}',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
    parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
VALUES ((SELECT id FROM raw.artifact WHERE sha256 = '${zipSha}'),
        (SELECT id FROM raw.artifact_member WHERE sha256 = '${memberSha}'),
        'SOI', E'\\t',
        ARRAY['adsh', 'cik', 'name', 'ddate', 'qtrs', 'Investment, Identifier Axis',
              'Investment Owned, Balance, Principal Amount', 'Adjusted cost basis', 'Investment Owned, Cost',
              'Investment Interest Rate', 'Investment, Interest Rate, Paid in Kind'],
        repeat('1', 64),
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.parser'),
        1, 0, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT tl.id, 2, ${lineSql}, encode(sha256(convert_to(${lineSql}, 'UTF8')), 'hex'),
       string_to_array(${lineSql}, E'\\t'), 11, 'OK', (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.table_load tl
JOIN raw.artifact a ON a.id = tl.artifact_id
WHERE a.sha256 = '${zipSha}';
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
SELECT 'L1_STRUCTURED_DATASET', a.id, 'TSV_ROW', r.id, (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.tabular_row r
JOIN raw.table_load tl ON tl.id = r.table_load_id
JOIN raw.artifact a ON a.id = tl.artifact_id
WHERE a.sha256 = '${zipSha}';
INSERT INTO registry.filing (accession_number, run_id, evidence_id)
SELECT '${accession}', (SELECT id FROM ops.run WHERE run_kind = 'TEST'), e.id
FROM evidence.evidence e
JOIN raw.artifact a ON a.id = e.artifact_id
WHERE a.sha256 = '${zipSha}' AND e.locator_type = 'TSV_ROW';
INSERT INTO obs.soi_row_observation (tabular_row_id, filing_id, reported_date_raw, reported_date,
    date_precision, qtrs_raw, qtrs, duration_kind, identifier_raw, rule_version_id, evidence_id, run_id)
SELECT r.id, f.id, '${PERIOD}', '${PERIOD}', 'MONTH_END_ROUNDED', '0', 0, 'POINT_IN_TIME', '${holding}',
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.project'), e.id,
       (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM raw.tabular_row r
JOIN raw.table_load tl ON tl.id = r.table_load_id
JOIN raw.artifact a ON a.id = tl.artifact_id
JOIN evidence.evidence e ON e.tabular_row_id = r.id AND e.artifact_id = a.id
JOIN registry.filing f ON f.accession_number = '${accession}'
WHERE a.sha256 = '${zipSha}';
INSERT INTO obs.soi_row_classification (soi_row_observation_id, row_kind, period_role, rule_version_id, run_id)
SELECT s.id, 'IDENTIFIER_ROW', 'UNRESOLVED',
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.classify'),
       (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM obs.soi_row_observation s
JOIN registry.filing f ON f.id = s.filing_id
WHERE f.accession_number = '${accession}';
INSERT INTO obs.position_observation (origin_soi_row_observation_id, filing_id, reported_date,
    date_precision, duration_kind, holding_descriptor_raw, rule_version_id, evidence_id, run_id)
SELECT s.id, s.filing_id, s.reported_date, s.date_precision, s.duration_kind, s.identifier_raw,
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.position'), s.evidence_id,
       (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM obs.soi_row_observation s
JOIN registry.filing f ON f.id = s.filing_id
WHERE f.accession_number = '${accession}';
INSERT INTO obs.position_observation_source (position_observation_id, soi_row_observation_id, source_role, run_id)
SELECT p.id, p.origin_soi_row_observation_id, 'PRIMARY', (SELECT id FROM ops.run WHERE run_kind = 'TEST')
FROM obs.position_observation p
JOIN registry.filing f ON f.id = p.filing_id
WHERE f.accession_number = '${accession}';
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('${url}', '${url}', 'SEC_FILING_DOCUMENT', 200, 1, '${filingSha}', '2099-01-02T00:00:00Z', 'test-only/block-${n}',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
VALUES ('L2_ORIGINAL_FILING', (SELECT id FROM raw.artifact WHERE sha256 = '${filingSha}'), 'DOCUMENT',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
VALUES ((SELECT id FROM registry.filing WHERE accession_number = '${accession}'), 'test-only-${n}.htm', '${url}',
        'FILING_INDEX_JSON',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.parser'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'),
        (SELECT e.id FROM evidence.evidence e JOIN raw.artifact a ON a.id = e.artifact_id
          WHERE a.sha256 = '${filingSha}' AND e.locator_type = 'DOCUMENT'));
INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
VALUES ((SELECT id FROM registry.filing_document WHERE document_url = '${url}'),
        (SELECT id FROM raw.artifact WHERE sha256 = '${filingSha}'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
COMMIT;`);
  return {
    n,
    holding,
    positionObservationId: Number(scalar(`
      SELECT p.id FROM obs.position_observation p
      JOIN registry.filing f ON f.id = p.filing_id
      WHERE f.accession_number = '${accession}'`)),
    filingId: Number(scalar(`SELECT id FROM registry.filing WHERE accession_number = '${accession}'`)),
    artifactId: Number(scalar(`SELECT id FROM raw.artifact WHERE sha256 = '${filingSha}'`)),
  };
}

function loadInput(position, html, runId) {
  return {
    database: dbName,
    runId,
    html,
    artifact: { id: position.artifactId, sourceType: "SEC_FILING_DOCUMENT" },
    filingLink: { artifactId: position.artifactId, filingId: position.filingId },
    positionFilingId: position.filingId,
    positionObservationId: position.positionObservationId,
    holdingDescriptorRaw: position.holding,
    reportedDate: PERIOD,
  };
}

function nameSignature() {
  return query(dbName, `
SELECT b.id::text || '|' || b.raw_text || '|' || b.evidence_id::text || '|' || b.extraction_state
       || '|' || e.html_row_ordinal::text || '|' || e.html_slot_ordinal::text
       || '|' || e.block_evidence_id::text || '|' || coalesce(e.column_label, '')
FROM obs.borrower_name_observation b
JOIN evidence.evidence e ON e.id = b.evidence_id
ORDER BY b.id`).join("\n");
}

test("exact-bind research fields keep evidence, rule 34, and unrelated rows", withDb(async () => {
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
COMMIT;`);

  const exact = seedPosition(1, HOLDING);
  const sibling = seedPosition(2, SIBLING);
  const trailing = seedPosition(3, HOLDING);
  const wrongPeriod = seedPosition(4, HOLDING);
  const singleRow = seedPosition(5, HOLDING);
  const extraNames = [6, 7, 8].map((n) => seedPosition(n, `TEST NAME ${n}, First Lien`));
  const testRunId = Number(scalar("SELECT id FROM ops.run WHERE run_kind = 'TEST'"));

  const nameTargets = [
    { position: exact, html: exactHtml, rawText: "TEST COMPANY" },
    ...extraNames.map((position) => ({
      position,
      html: nameHtml(`TEST NAME ${position.n}`),
      rawText: `TEST NAME ${position.n}`,
    })),
  ];
  for (const target of nameTargets) {
    const block = parseScheduleDisclosureBlocks(target.html).blocks[0];
    ingestFilingCompanyCell({
      database: dbName,
      runId: testRunId,
      html: target.html,
      artifact: { id: target.position.artifactId, sourceType: "SEC_FILING_DOCUMENT" },
      filingLink: { artifactId: target.position.artifactId, filingId: target.position.filingId },
      positionFilingId: target.position.filingId,
      positionObservationId: target.position.positionObservationId,
      blockEvidence: {
        id: 1,
        locatorType: "DISCLOSURE_BLOCK",
        artifactId: target.position.artifactId,
        htmlRowOrdinal: block.startRowOrdinal,
        htmlRowEndOrdinal: block.endRowOrdinal,
      },
      evidence: {
        locatorType: "HTML_TABLE_CELL",
        artifactId: target.position.artifactId,
        blockEvidenceId: 1,
        htmlRowOrdinal: block.startRowOrdinal,
        htmlSlotOrdinal: block.portfolioCompanySlot,
      },
      rawText: target.rawText,
    });
  }
  assert.equal(scalar("SELECT count(*) FROM obs.borrower_name_observation"), "4");
  const namesBefore = nameSignature();
  const parserBefore = scalar(`
SELECT id::text || ' ' || definition_sha256
FROM ops.rule_version WHERE rule_code = '${PARSER_CODE}' AND version = '${PARSER_VERSION}'`);
  assert.equal(parserBefore.endsWith(PARSER_SHA), true);

  query(dbName, `
INSERT INTO obs.position_field_value (
  position_observation_id, field_code, raw_value, normalized_text, currency_state, scale_state,
  value_state, normalization_rule_version_id, evidence_id, run_id)
SELECT ${exact.positionObservationId}, 'GEOGRAPHY', 'TEST GEOGRAPHY', 'TEST GEOGRAPHY',
       'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED',
       (SELECT id FROM ops.rule_version WHERE rule_code = 'test.position'),
       e.id, ${testRunId}
FROM evidence.evidence e
WHERE e.artifact_id = ${exact.artifactId} AND e.locator_type = 'DOCUMENT'`);
  const geographyBefore = scalar(`
SELECT id::text || ' ' || raw_value FROM obs.position_field_value WHERE field_code = 'GEOGRAPHY'`);
  const sourceCountsBefore = scalar(`
SELECT (SELECT count(*) FROM obs.position_observation)::text || ' '
    || (SELECT count(*) FROM obs.soi_row_observation)::text || ' '
    || (SELECT count(*) FROM obs.borrower_name_observation)::text || ' '
    || (SELECT count(*) FROM identity.legal_entity)::text || ' '
    || (SELECT count(*) FROM resolution.entity_resolution_decision)::text`);

  const researchRunId = Number(scalar(`
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('RESEARCH_FIELD_EXACT', 'test', '{}'::jsonb, now()) RETURNING id`));
  const first = ingestExactResearchFields(loadInput(exact, exactHtml, researchRunId));
  const siblingResult = ingestExactResearchFields(loadInput(sibling, exactHtml, researchRunId));
  const trailingResult = ingestExactResearchFields(loadInput(trailing, trailingHtml, researchRunId));
  const wrongPeriodResult = ingestExactResearchFields(loadInput(wrongPeriod, wrongPeriodHtml, researchRunId));
  const singleRowResult = ingestExactResearchFields(loadInput(singleRow, singleRowHtml, researchRunId));

  assert.deepEqual(trailingResult.fields, []);
  assert.deepEqual(wrongPeriodResult.fields, []);
  assert.deepEqual(singleRowResult.fields, []);
  assert.equal(siblingResult.fields.map((item) => item.fieldCode).join(","), "INSTRUMENT_TYPE");
  assert.equal(siblingResult.fields[0].rawText, "First Lien(4)");
  assert.equal(first.fields.map((item) => item.fieldCode).sort().join(","), "INDUSTRY,INSTRUMENT_TYPE");

  const industry = first.fields.find((item) => item.fieldCode === "INDUSTRY");
  const instrument = first.fields.find((item) => item.fieldCode === "INSTRUMENT_TYPE");
  assert.equal(industry.rawText, "TEST INDUSTRY CELL");
  assert.equal(instrument.rawText, INSTRUMENT);
  assert.equal(scalar(`
SELECT raw_value || '|' || normalized_text || '|' || value_state::text
FROM obs.position_field_value WHERE id = ${industry.fieldValueId}`),
  "TEST INDUSTRY CELL|TEST INDUSTRY CELL|REPORTED");
  assert.equal(scalar(`
SELECT raw_value || '|' || normalized_text FROM obs.position_field_value WHERE id = ${instrument.fieldValueId}`),
  `${INSTRUMENT}|${INSTRUMENT}`);
  const exactBlock = parseScheduleDisclosureBlocks(exactHtml).blocks[0];
  assert.equal(scalar(`
SELECT e.locator_type || '|' || e.html_row_ordinal::text || '|' || e.html_slot_ordinal::text
       || '|' || coalesce(e.column_label, '') || '|' || e.artifact_id::text
       || '|' || e.block_evidence_id::text || '|' || parent.locator_type
       || '|' || parent.html_row_ordinal::text || '|' || parent.html_row_end_ordinal::text
       || '|' || (e.html_row_ordinal > parent.html_row_ordinal)::text
FROM evidence.evidence e
JOIN evidence.evidence parent ON parent.id = e.block_evidence_id
WHERE e.id = ${industry.evidenceId}`),
  `HTML_TABLE_CELL|${industry.htmlRowOrdinal}|${industry.htmlSlotOrdinal}||${exact.artifactId}|${first.blockEvidenceId}|DISCLOSURE_BLOCK|${exactBlock.startRowOrdinal}|${exactBlock.endRowOrdinal}|true`);
  assert.equal(industry.evidenceId === instrument.evidenceId, false);
  assert.equal(siblingResult.blockEvidenceId === first.blockEvidenceId, false);
  assert.equal(scalar(`
SELECT artifact_id::text FROM evidence.evidence WHERE id = ${siblingResult.blockEvidenceId}`),
  String(sibling.artifactId));
  assert.equal(scalar(`
SELECT block_evidence_id::text FROM evidence.evidence WHERE id = ${instrument.evidenceId}`),
  String(first.blockEvidenceId));
  assert.equal(scalar(`
SELECT count(*) FROM evidence.evidence
WHERE artifact_id = ${exact.artifactId} AND locator_type = 'DISCLOSURE_BLOCK'`), "1");
  assert.equal(scalar(`
SELECT count(*) FROM evidence.evidence
WHERE artifact_id = ${singleRow.artifactId} AND locator_type = 'DISCLOSURE_BLOCK'`), "0");
  assert.equal(scalar(`
SELECT count(*) FROM obs.position_field_value
WHERE position_observation_id = ${sibling.positionObservationId} AND field_code = 'INDUSTRY'`), "0");
  assert.equal(scalar(`
SELECT count(*) FROM obs.position_field_value
WHERE position_observation_id IN (${trailing.positionObservationId}, ${wrongPeriod.positionObservationId}, ${singleRow.positionObservationId})
  AND field_code IN ('INDUSTRY', 'INSTRUMENT_TYPE')`), "0");
  assert.equal(scalar(`
SELECT count(*) FROM obs.position_field_value
WHERE field_code IN ('MATURITY_DATE', 'ACQUISITION_DATE')`), "0");

  const namesAfter = nameSignature();
  assert.equal(namesAfter, namesBefore);
  assert.equal(scalar(`
SELECT id::text || ' ' || definition_sha256
FROM ops.rule_version WHERE rule_code = '${PARSER_CODE}' AND version = '${PARSER_VERSION}'`), parserBefore);
  assert.equal(scalar(`
SELECT count(*) FROM ops.run_rule_version rr
JOIN ops.rule_version rv ON rv.id = rr.rule_version_id
WHERE rr.run_id = ${researchRunId} AND rv.rule_code = '${PARSER_CODE}'`), "0");
  assert.equal(scalar(`
SELECT rv.rule_code || ' ' || rv.version
FROM ops.run_rule_version rr
JOIN ops.rule_version rv ON rv.id = rr.rule_version_id
WHERE rr.run_id = ${researchRunId}`), "obs.research_field.exact_disclosure_cell 1");
  const researchRule = RULES.find((item) => item.code === "obs.research_field.exact_disclosure_cell");
  assert.equal(first.definitionSha256, ruleDefinitionSha(researchRule));
  assert.equal(scalar(`
SELECT (SELECT count(*) FROM obs.position_observation)::text || ' '
    || (SELECT count(*) FROM obs.soi_row_observation)::text || ' '
    || (SELECT count(*) FROM obs.borrower_name_observation)::text || ' '
    || (SELECT count(*) FROM identity.legal_entity)::text || ' '
    || (SELECT count(*) FROM resolution.entity_resolution_decision)::text`), sourceCountsBefore);
  assert.equal(scalar(`
SELECT id::text || ' ' || raw_value FROM obs.position_field_value WHERE field_code = 'GEOGRAPHY'`), geographyBefore);

  const evidenceCount = scalar("SELECT count(*) FROM evidence.evidence");
  const fieldCount = scalar("SELECT count(*) FROM obs.position_field_value");
  const second = ingestExactResearchFields(loadInput(exact, exactHtml, researchRunId));
  assert.equal(second.fields.every((item) => item.inserted === false), true);
  assert.deepEqual(
    second.fields.map((item) => item.fieldValueId).sort(),
    first.fields.map((item) => item.fieldValueId).sort(),
  );
  assert.equal(scalar("SELECT count(*) FROM evidence.evidence"), evidenceCount);
  assert.equal(scalar("SELECT count(*) FROM obs.position_field_value"), fieldCount);
  assert.equal(nameSignature(), namesBefore);
}));
