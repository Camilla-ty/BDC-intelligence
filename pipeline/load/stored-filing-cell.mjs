// Idempotent company-cell ingestion from already-stored SEC_FILING_DOCUMENT HTML.
// Binds one parsed company cell to exactly one position_observation_id.
// Does not fetch, does not invent names from Identifier Axis or blank issuer columns,
// and does not write entity-resolution decisions.

import { createStore } from "../lib/store.mjs";
import { lit, num, queryRows } from "../lib/db.mjs";
import { COMPANY_CELL_NAME_SOURCE } from "../normalize/company-cell-entity.mjs";
import { parseScheduleDisclosureBlocks } from "../parse/schedule-disclosure-block.mjs";
import { completeFilingCellIngest } from "./filing-cell-outcome.mjs";
import { ensureAndLinkRuleForRun } from "./rules.mjs";
import { normalizeBorrowerNames } from "./borrower-name-normalize-run.mjs";
import { BORROWER_NAME_RULE_CODE, BORROWER_NAME_RULE_VERSION } from "../normalize/borrower-name.mjs";

function positiveInt(value, name) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${name} must be a positive integer`);
  return id;
}

function parseJsonCell(rows) {
  if (rows.length === 0) return null;
  return JSON.parse(rows[0][0]);
}

// Read-only. The position's filing and its single linked HTML artifact.
export function loadStoredFilingHtmlContext(database, positionObservationId) {
  const po = positiveInt(positionObservationId, "position_observation_id");
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce((
  SELECT json_build_object(
    'positionObservationId', p.id,
    'filingId', p.filing_id,
    'accessionNumber', f.accession_number,
    'artifactId', a.id,
    'sourceType', a.source_type_code,
    'storageKey', a.storage_key,
    'sha256', a.sha256
  )
  FROM obs.position_observation p
  JOIN registry.filing f ON f.id = p.filing_id
  JOIN registry.filing_document fd ON fd.filing_id = f.id
  JOIN registry.filing_document_artifact fda ON fda.filing_document_id = fd.id
  JOIN raw.artifact a ON a.id = fda.artifact_id
  WHERE p.id = ${num(po)}
    AND a.source_type_code = 'SEC_FILING_DOCUMENT'
), 'null'::json)::text;`));
  if (parsed == null) {
    throw new Error(`position_observation ${po} has no linked SEC_FILING_DOCUMENT HTML artifact`);
  }
  const count = Number(queryRows(database, `
SELECT count(*)::text
FROM obs.position_observation p
JOIN registry.filing_document fd ON fd.filing_id = p.filing_id
JOIN registry.filing_document_artifact fda ON fda.filing_document_id = fd.id
JOIN raw.artifact a ON a.id = fda.artifact_id
WHERE p.id = ${num(po)}
  AND a.source_type_code = 'SEC_FILING_DOCUMENT'`)[0][0]);
  if (count !== 1) {
    throw new Error(`position_observation ${po} has ${count} linked SEC_FILING_DOCUMENT artifacts; expected 1`);
  }
  return {
    positionObservationId: Number(parsed.positionObservationId),
    filingId: Number(parsed.filingId),
    accessionNumber: parsed.accessionNumber,
    artifactId: Number(parsed.artifactId),
    sourceType: parsed.sourceType,
    storageKey: parsed.storageKey,
    sha256: parsed.sha256,
  };
}

export function readStoredFilingHtml(dataDir, context) {
  if (!dataDir) throw new Error("dataDir is required to read stored filing HTML");
  return createStore(dataDir).read(context.storageKey, context.sha256).toString("utf8");
}

// Prefer a block that carries the investment domain when several company cells share a name.
// Domain matching is exact string equality against iXBRL InvestmentIdentifierAxis.domain text
// (same bytes as the SOI Identifier Axis when the sources agree). Trailing-space or trimmed
// variants are not accepted: comparative schedule blocks that differ only by whitespace stay
// distinct, and ambiguous multi-block cases fail closed.
export function findCompanyBlock(html, { companyText, investmentDomain = null } = {}) {
  if (typeof companyText !== "string" || companyText === "") {
    throw new Error("companyText must be non-empty source text from the filing cell");
  }
  const { blocks } = parseScheduleDisclosureBlocks(html);
  const named = blocks.filter((block) => block.companyText === companyText);
  if (named.length === 0) {
    throw new Error(`no schedule disclosure block has company text ${JSON.stringify(companyText)}`);
  }
  if (investmentDomain == null || investmentDomain === "") {
    if (named.length > 1) {
      throw new Error(`company text ${JSON.stringify(companyText)} matches ${named.length} blocks; pass investmentDomain`);
    }
    return named[0];
  }
  if (typeof investmentDomain !== "string") {
    throw new Error("investmentDomain must be a string when supplied");
  }
  const matched = named.filter((block) => block.rows.some((row) => (
    (row.lines ?? []).some((line) => line.domain === investmentDomain)
  )));
  if (matched.length === 0) {
    throw new Error(`no block for ${JSON.stringify(companyText)} carries exact investment domain ${JSON.stringify(investmentDomain)}`);
  }
  if (matched.length > 1) {
    throw new Error(`exact investment domain ${JSON.stringify(investmentDomain)} matches ${matched.length} blocks`);
  }
  return matched[0];
}

// Read-only. Current company-cell name row for one observation, if any.
export function currentCompanyCellObservation(database, positionObservationId) {
  const po = positiveInt(positionObservationId, "position_observation_id");
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce((
  SELECT json_build_object(
    'id', b.id,
    'rawText', b.raw_text,
    'normalizedText', b.normalized_text,
    'extractionState', b.extraction_state,
    'evidenceId', b.evidence_id,
    'artifactId', e.artifact_id
  )
  FROM obs.current_borrower_name_observation b
  JOIN evidence.evidence e ON e.id = b.evidence_id
  WHERE b.position_observation_id = ${num(po)}
    AND b.name_source = ${lit(COMPANY_CELL_NAME_SOURCE)}
  ORDER BY b.id
  LIMIT 1
), 'null'::json)::text;`));
  if (parsed == null) return null;
  return {
    id: Number(parsed.id),
    rawText: parsed.rawText,
    normalizedText: parsed.normalizedText,
    extractionState: parsed.extractionState,
    evidenceId: Number(parsed.evidenceId),
    artifactId: Number(parsed.artifactId),
  };
}

function ingestInput({ runId, html, context, block, companyText }) {
  return {
    runId,
    html,
    artifact: { id: context.artifactId, sourceType: "SEC_FILING_DOCUMENT" },
    filingLink: { artifactId: context.artifactId, filingId: context.filingId },
    positionFilingId: context.filingId,
    positionObservationId: context.positionObservationId,
    evidence: {
      locatorType: "HTML_TABLE_CELL",
      artifactId: context.artifactId,
      blockEvidenceId: 1,
      htmlRowOrdinal: block.startRowOrdinal,
      htmlSlotOrdinal: block.portfolioCompanySlot,
    },
    blockEvidence: {
      id: 1,
      locatorType: "DISCLOSURE_BLOCK",
      artifactId: context.artifactId,
      htmlRowOrdinal: block.startRowOrdinal,
      htmlRowEndOrdinal: block.endRowOrdinal,
    },
    rawText: companyText,
  };
}

// Inserts a company-cell name for one observation from stored HTML, or skips when identical.
export function ingestStoredFilingCompanyCell({
  database,
  dataDir,
  runId,
  positionObservationId,
  companyText,
  investmentDomain = null,
}) {
  const run = positiveInt(runId, "run_id");
  const context = loadStoredFilingHtmlContext(database, positionObservationId);
  const html = readStoredFilingHtml(dataDir, context);
  const block = findCompanyBlock(html, { companyText, investmentDomain });
  const existing = currentCompanyCellObservation(database, context.positionObservationId);
  if (existing) {
    if (existing.rawText === companyText && existing.artifactId === context.artifactId) {
      return {
        status: "ALREADY_PRESENT",
        positionObservationId: context.positionObservationId,
        observationId: existing.id,
        evidenceId: existing.evidenceId,
        artifactId: context.artifactId,
        rawText: existing.rawText,
        extractionState: existing.extractionState,
        blockStartRow: block.startRowOrdinal,
        blockEndRow: block.endRowOrdinal,
      };
    }
    throw new Error(
      `position_observation ${context.positionObservationId} already has a company cell `
      + `(raw ${JSON.stringify(existing.rawText)}, artifact ${existing.artifactId}); refuse to attach another`,
    );
  }
  const inserted = completeFilingCellIngest({
    database,
    ...ingestInput({ runId: run, html, context, block, companyText }),
  });
  return {
    status: "INSERTED",
    positionObservationId: context.positionObservationId,
    observationId: inserted.observationId,
    evidenceId: inserted.evidenceId,
    artifactId: context.artifactId,
    rawText: inserted.payload.rawText,
    extractionState: "RAW_ONLY",
    blockStartRow: block.startRowOrdinal,
    blockEndRow: block.endRowOrdinal,
    ruleVersionId: inserted.ruleVersionId,
  };
}

// Append-only RAW_ONLY → EXTRACTED normalize for one company-cell root.
export function normalizeStoredFilingCompanyCell(database, { runId, rootId }) {
  const run = positiveInt(runId, "run_id");
  const root = positiveInt(rootId, "rootId");
  const linked = ensureAndLinkRuleForRun(database, run, {
    code: BORROWER_NAME_RULE_CODE,
    version: BORROWER_NAME_RULE_VERSION,
  });
  const plan = normalizeBorrowerNames(database, {
    runId: run,
    rootIds: [root],
    rule: { id: linked.id, code: BORROWER_NAME_RULE_CODE, version: BORROWER_NAME_RULE_VERSION },
  });
  return { runId: run, ruleId: linked.id, plan };
}
