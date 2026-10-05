#!/usr/bin/env node
// Local Golden-slice load for the nine exact-bind New Mountain observations.
// Refuses a hosted database URL. Does not fetch. Does not update source observations.

import { createHash } from "node:crypto";
import { query as localQuery } from "../../scripts/db/pg.mjs";
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE } from "../lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "../lib/db.mjs";
import { readFetchLog } from "../lib/fetch-log.mjs";
import { createStore } from "../lib/store.mjs";
import { linkFilingDocumentArtifact } from "./filing-document-artifact.mjs";
import { selectExactResearchFields } from "../extract/exact-research-field.mjs";
import { ingestExactResearchFields } from "./exact-research-field.mjs";
import { pipelineCodeVersion } from "./run.mjs";

const CASE_KEY = "geo-parent-corporation";
const DATABASE = DEFAULT_DATABASE;

const EXPECTED = {
  893583: { document: "nmg4-20240930.htm", industry: "Business Services", instrument: "First Lien(2)(6)(8)", row: 296, industrySlot: 0, typeSlot: 15 },
  893584: { document: "nmg4-20240930.htm", industry: null, instrument: "First Lien(4)(7)(8)", row: 297, industrySlot: 0, typeSlot: 15 },
  893587: { document: "nmslf-20240930.htm", industry: "Business Services", instrument: "First Lien(2)(3)(6)", row: 395, industrySlot: 0, typeSlot: 6 },
  981407: { document: "nmg4-20240630.htm", industry: "Business Services", instrument: "First Lien(2)(5)", row: 275, industrySlot: 0, typeSlot: 9 },
  981408: { document: "nmg4-20240630.htm", industry: null, instrument: "First Lien(4)(5)", row: 276, industrySlot: 0, typeSlot: 9 },
  981411: { document: "nmslf-20240630.htm", industry: "Business Services", instrument: "First Lien(2)(3)", row: 387, industrySlot: 0, typeSlot: 6 },
  1067074: { document: "nmg4if-20240331.htm", industry: "Business Services", instrument: "First Lien(2)", row: 236, industrySlot: 0, typeSlot: 6 },
  1146287: { document: "nmg4-20231231.htm", industry: "Business Services", instrument: "First Lien(2)(4)", row: 420, industrySlot: 0, typeSlot: 6 },
  1146289: { document: "nmslf-20231231.htm", industry: "Business Services", instrument: "First lien (2)(3)", row: 1373, industrySlot: 0, typeSlot: 6 },
};

const TARGET_IDS = Object.keys(EXPECTED).map(Number);

function refuseHosted() {
  if (process.env.PIPELINE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim()) {
    throw new Error("refusing to run while a hosted database URL is set");
  }
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("refusing to run unless the pipeline target is the local database");
  }
  if (DATABASE !== "bdc_local") throw new Error("refusing a database other than bdc_local");
}

function one(sql) {
  const rows = queryRows(DATABASE, sql);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
  return rows[0];
}

function cell(result, code) {
  return result.fields.find((item) => item.fieldCode === code) ?? null;
}

function matchesExpected(selected, expected) {
  const industry = cell(selected, "INDUSTRY");
  const instrument = cell(selected, "INSTRUMENT_TYPE");
  if (selected.fields.some((item) => item.fieldCode !== "INDUSTRY" && item.fieldCode !== "INSTRUMENT_TYPE")) return false;
  if (expected.industry == null) {
    if (industry) return false;
  } else if (!industry || industry.rawText !== expected.industry
    || industry.htmlRowOrdinal !== expected.row || industry.htmlSlotOrdinal !== expected.industrySlot) return false;
  if (!instrument || instrument.rawText !== expected.instrument
    || instrument.htmlRowOrdinal !== expected.row || instrument.htmlSlotOrdinal !== expected.typeSlot) return false;
  return true;
}

function memberIds() {
  return localQuery(DATABASE, `
SELECT m.position_observation_id::text
FROM review.candidate_member m
JOIN review.current_candidate c ON c.candidate_id = m.candidate_id
WHERE c.case_key = '${CASE_KEY}'
ORDER BY m.position_observation_id`).map((line) => Number(line));
}

function priorFieldDigest(ids) {
  const rows = queryRows(DATABASE, `
SELECT fv.id::text, fv.position_observation_id::text, fv.field_code, fv.raw_value,
       coalesce(fv.normalized_text, ''), coalesce(fv.normalized_numeric::text, ''),
       coalesce(fv.normalized_date::text, ''), fv.value_state::text
FROM obs.position_field_value fv
WHERE fv.position_observation_id IN (${ids.join(",")})
  AND fv.field_code NOT IN ('INDUSTRY', 'INSTRUMENT_TYPE')
  AND NOT EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id)
ORDER BY fv.id`);
  const hash = createHash("sha256");
  for (const row of rows) hash.update(`${row.join("\t")}\n`);
  return { count: rows.length, sha256: hash.digest("hex") };
}

function evidenceDigest(maxId) {
  const rows = queryRows(DATABASE, `
SELECT id::text, locator_type, coalesce(html_row_ordinal::text, ''), coalesce(html_row_end_ordinal::text, ''),
       coalesce(html_slot_ordinal::text, ''), coalesce(block_evidence_id::text, ''), coalesce(column_label, '')
FROM evidence.evidence
WHERE id <= ${num(maxId)}
  AND evidence_level = 'L2_ORIGINAL_FILING'
ORDER BY id`);
  const hash = createHash("sha256");
  for (const row of rows) hash.update(`${row.join("\t")}\n`);
  return { count: rows.length, sha256: hash.digest("hex") };
}

function resolveDocument(positionId) {
  const rows = queryRows(DATABASE, `
SELECT d.id::text, d.document_name, d.document_url,
       coalesce(a.artifact_count::text, '0'),
       coalesce(a.artifact_id::text, ''),
       coalesce(a.storage_key, ''),
       coalesce(a.sha256, '')
FROM obs.position_observation p
JOIN LATERAL (
  SELECT fd.id, fd.document_name, fd.document_url
  FROM registry.filing_document fd
  WHERE fd.filing_id = p.filing_id
    AND fd.document_url LIKE 'https://www.sec.gov/Archives/edgar/data/%'
  ORDER BY CASE WHEN fd.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT' THEN 0 ELSE 1 END, fd.id
  LIMIT 1
) d ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS artifact_count, min(art.id) AS artifact_id,
         (array_agg(art.storage_key ORDER BY art.id))[1] AS storage_key,
         (array_agg(art.sha256 ORDER BY art.id))[1] AS sha256
  FROM registry.filing_document_artifact fda
  JOIN raw.artifact art ON art.id = fda.artifact_id
  WHERE fda.filing_document_id = d.id
    AND art.source_type_code = 'SEC_FILING_DOCUMENT'
) a ON true
WHERE p.id = ${num(positionId)}`);
  if (rows.length !== 1) throw new Error(`position ${positionId} does not have one primary filing document`);
  const [filingDocumentId, documentName, documentUrl, artifactCount, artifactId, storageKey, sha256] = rows[0];
  if (Number(artifactCount) > 1) throw new Error(`position ${positionId} has more than one filing-document artifact`);
  return {
    positionId,
    filingDocumentId: Number(filingDocumentId),
    documentName,
    documentUrl,
    artifactId: artifactId === "" ? null : Number(artifactId),
    storageKey: storageKey || null,
    sha256: sha256 || null,
  };
}

function positionIdentity(positionId) {
  const [filingId, reportedDate, holding] = one(`
SELECT filing_id::text, reported_date::text, holding_descriptor_raw
FROM obs.position_observation WHERE id = ${num(positionId)}`);
  return { filingId: Number(filingId), reportedDate, holding };
}

export function loadExactResearchSlice({ database = DATABASE } = {}) {
  if (database !== DATABASE) throw new Error("refusing a database other than bdc_local");
  refuseHosted();
  const ids = memberIds();
  if (ids.length !== 32) throw new Error(`expected 32 case members, found ${ids.length}`);
  for (const id of TARGET_IDS) {
    if (!ids.includes(id)) throw new Error(`position ${id} is not a case member`);
  }
  const beforeFields = priorFieldDigest(ids);
  if (beforeFields.count !== 170) throw new Error(`expected 170 stored field values, found ${beforeFields.count}`);
  const beforePositions = one("SELECT count(*)::text FROM obs.position_observation")[0];
  const beforeNames = one("SELECT count(*)::text FROM obs.borrower_name_observation")[0];
  const beforeParser = queryRows(DATABASE, `
SELECT id::text, definition_sha256 FROM ops.rule_version
WHERE rule_code = 'parser.sec_schedule_disclosure_block' AND version = '2'`);
  const log = readFetchLog(DEFAULT_DATA_DIR);
  const byUrl = new Map(log.entries.map((entry) => [entry.url, entry]));
  const store = createStore(DEFAULT_DATA_DIR);
  const plans = [];
  for (const positionId of TARGET_IDS) {
    const document = resolveDocument(positionId);
    const expected = EXPECTED[positionId];
    if (document.documentName !== expected.document) {
      throw new Error(`position ${positionId} document is ${document.documentName}`);
    }
    const entry = byUrl.get(document.documentUrl);
    const storageKey = document.storageKey ?? entry?.storage_key;
    const sha256 = document.sha256 ?? entry?.sha256;
    if (!storageKey || !sha256) throw new Error(`position ${positionId} has no stored filing bytes`);
    if (entry && document.sha256 && entry.sha256 !== document.sha256) {
      throw new Error(`position ${positionId} artifact checksum differs from the fetch log`);
    }
    const html = store.read(storageKey, sha256).toString("utf8");
    const identity = positionIdentity(positionId);
    const selected = selectExactResearchFields({
      html,
      holdingDescriptorRaw: identity.holding,
      reportedDate: identity.reportedDate,
    });
    if (!matchesExpected(selected, expected)) {
      throw new Error(`position ${positionId} parsed cells do not match the approved inventory: ${JSON.stringify(selected.fields)}`);
    }
    plans.push({ positionId, document, entry, identity, selected, html });
  }

  const runId = Number(one(`
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('RESEARCH_FIELD_EXACT', ${lit(pipelineCodeVersion())},
        ${lit(JSON.stringify({ case_key: CASE_KEY, position_observation_ids: TARGET_IDS }))}::jsonb,
        now())
RETURNING id`)[0]);
  const linkedDocuments = [];
  const artifactByDocument = new Map();
  for (const plan of plans) {
    if (artifactByDocument.has(plan.document.filingDocumentId)) continue;
    let artifactId = plan.document.artifactId;
    let linkInserted = 0;
    if (artifactId == null) {
      if (!plan.entry || plan.entry.http_status !== 200) {
        throw new Error(`position ${plan.positionId} fetch log entry is not a stored 200 response`);
      }
      const linked = linkFilingDocumentArtifact({
        database,
        runId,
        filingDocumentId: plan.document.filingDocumentId,
        entry: plan.entry,
      });
      artifactId = Number(linked.artifact_id);
      linkInserted = Number(linked.link_inserted);
    }
    artifactByDocument.set(plan.document.filingDocumentId, artifactId);
    linkedDocuments.push({ filingDocumentId: plan.document.filingDocumentId, artifactId, linkInserted });
  }
  const evidenceMax = Number(one("SELECT coalesce(max(id), 0)::text FROM evidence.evidence")[0]);
  const evidenceBefore = evidenceDigest(evidenceMax);

  const written = [];
  for (const plan of plans) {
    const artifactId = artifactByDocument.get(plan.document.filingDocumentId);
    const result = ingestExactResearchFields({
      database,
      runId,
      html: plan.html,
      artifact: { id: artifactId, sourceType: "SEC_FILING_DOCUMENT" },
      filingLink: { artifactId, filingId: plan.identity.filingId },
      positionFilingId: plan.identity.filingId,
      positionObservationId: plan.positionId,
      holdingDescriptorRaw: plan.identity.holding,
      reportedDate: plan.identity.reportedDate,
    });
    written.push({ positionId: plan.positionId, result });
  }
  const rerun = [];
  for (const plan of plans) {
    const artifactId = artifactByDocument.get(plan.document.filingDocumentId);
    const result = ingestExactResearchFields({
      database,
      runId,
      html: plan.html,
      artifact: { id: artifactId, sourceType: "SEC_FILING_DOCUMENT" },
      filingLink: { artifactId, filingId: plan.identity.filingId },
      positionFilingId: plan.identity.filingId,
      positionObservationId: plan.positionId,
      holdingDescriptorRaw: plan.identity.holding,
      reportedDate: plan.identity.reportedDate,
    });
    rerun.push(result);
  }

  const afterFields = priorFieldDigest(ids);
  const afterIds = memberIds();
  const afterParser = queryRows(DATABASE, `
SELECT id::text, definition_sha256 FROM ops.rule_version
WHERE rule_code = 'parser.sec_schedule_disclosure_block' AND version = '2'`);
  const evidenceAfter = evidenceDigest(evidenceMax);
  const industryRows = queryRows(DATABASE, `
SELECT fv.position_observation_id::text, fv.raw_value
FROM obs.position_field_value fv
WHERE fv.position_observation_id IN (${TARGET_IDS.join(",")})
  AND fv.field_code = 'INDUSTRY'
  AND NOT EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id)
ORDER BY fv.position_observation_id`);
  const instrumentRows = queryRows(DATABASE, `
SELECT fv.position_observation_id::text, fv.raw_value
FROM obs.position_field_value fv
WHERE fv.position_observation_id IN (${TARGET_IDS.join(",")})
  AND fv.field_code = 'INSTRUMENT_TYPE'
  AND NOT EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id)
ORDER BY fv.position_observation_id`);
  const others = ids.filter((id) => !TARGET_IDS.includes(id));
  const otherFields = Number(one(`
SELECT count(*)::text FROM obs.position_field_value
WHERE position_observation_id IN (${others.join(",")})
  AND field_code IN ('INDUSTRY', 'INSTRUMENT_TYPE')`)[0]);
  const dateFields = Number(one(`
SELECT count(*)::text FROM obs.position_field_value
WHERE position_observation_id IN (${ids.join(",")})
  AND field_code IN ('MATURITY_DATE', 'ACQUISITION_DATE')`)[0]);
  if (afterFields.count !== 170 || afterFields.sha256 !== beforeFields.sha256) {
    throw new Error("existing field values changed");
  }
  if (afterIds.join(",") !== ids.join(",")) throw new Error("case member ids changed");
  if (one("SELECT count(*)::text FROM obs.position_observation")[0] !== beforePositions) {
    throw new Error("position observation count changed");
  }
  if (one("SELECT count(*)::text FROM obs.borrower_name_observation")[0] !== beforeNames) {
    throw new Error("borrower-name observation count changed");
  }
  if (JSON.stringify(afterParser) !== JSON.stringify(beforeParser)) {
    throw new Error("parser rule version 2 changed");
  }
  if (evidenceAfter.sha256 !== evidenceBefore.sha256 || evidenceAfter.count !== evidenceBefore.count) {
    throw new Error("pre-existing Level 2 evidence rows changed");
  }
  const newEvidence = queryRows(DATABASE, `
SELECT locator_type, count(*)::text
FROM evidence.evidence
WHERE id > ${num(evidenceMax)}
GROUP BY locator_type
ORDER BY locator_type`);
  const newKinds = newEvidence.map((row) => row[0]);
  if (newKinds.some((kind) => kind !== "DISCLOSURE_BLOCK" && kind !== "HTML_TABLE_CELL")) {
    throw new Error("new evidence is not a disclosure block or HTML table cell");
  }
  if (industryRows.length !== 7 || instrumentRows.length !== 9 || otherFields !== 0 || dateFields !== 0) {
    throw new Error("research field counts do not match the approved slice");
  }
  if (rerun.some((result) => result.fields.some((field) => field.inserted))) {
    throw new Error("rerun inserted a field");
  }
  queryRows(DATABASE, `
INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
SELECT ${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify({
    industry_values: industryRows.length,
    instrument_values: instrumentRows.length,
    document_links_inserted: linkedDocuments.filter((item) => item.linkInserted > 0).length,
  }))}::jsonb
WHERE NOT EXISTS (SELECT 1 FROM ops.run_outcome existing WHERE existing.run_id = ${num(runId)})
RETURNING id`);
  return {
    database: DATABASE,
    runId,
    priorFieldCount: beforeFields.count,
    priorFieldSha256: beforeFields.sha256,
    industry: industryRows.map(([id, raw]) => ({ positionObservationId: Number(id), raw })),
    instrument: instrumentRows.map(([id, raw]) => ({ positionObservationId: Number(id), raw })),
    otherPositionsWithoutFields: others.length,
    dateFieldCount: dateFields,
    documentLinksInserted: linkedDocuments.filter((item) => item.linkInserted > 0).length,
    borrowerNameCount: Number(beforeNames),
    parserRuleUnchanged: true,
    idempotent: true,
    evidenceLocators: written.map((item) => ({
      positionObservationId: item.positionId,
      blockEvidenceId: item.result.blockEvidenceId,
      fields: item.result.fields.map((field) => ({
        fieldCode: field.fieldCode,
        fieldValueId: field.fieldValueId,
        evidenceId: field.evidenceId,
        htmlRowOrdinal: field.htmlRowOrdinal,
        htmlSlotOrdinal: field.htmlSlotOrdinal,
        rawText: field.rawText,
      })),
    })),
    ruleVersionId: written[0].result.ruleVersionId,
    definitionSha256: written[0].result.definitionSha256,
  };
}

const isDirect = process.argv[1] && process.argv[1].endsWith("exact-research-field-slice.mjs");
if (isDirect) {
  try {
    console.log(JSON.stringify(loadExactResearchSlice(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
