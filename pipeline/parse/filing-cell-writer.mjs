// FILING_CELL insert gate. The database trigger checks structure only.
// This module parses the filing and is the only path that may produce an
// HTML_TABLE_CELL borrower-name payload. It does not insert rows.

import {
  PARSER_VERSION,
  assertFilingCompanyCell,
  parseScheduleDisclosureBlocks,
} from "./schedule-disclosure-block.mjs";

const RATE_FACTS = new Set([
  "us-gaap:InvestmentBasisSpreadVariableRate",
  "us-gaap:InvestmentInterestRate",
]);
const CONTEXT_ROW_ANCHOR = /^ix-context-row:[A-Za-z0-9_-]+$/;
const NUMERIC_FACT_TEXT = /^[0-9][0-9,.]*%?$/;

function requireFilingDocument(input) {
  if (input.artifact?.sourceType !== "SEC_FILING_DOCUMENT") {
    throw new Error("artifact must be SEC_FILING_DOCUMENT");
  }
  if (input.filingLink?.artifactId !== input.artifact.id || input.filingLink?.filingId !== input.positionFilingId) {
    throw new Error("filing link does not match the position filing");
  }
  if (input.rawText == null || input.rawText === "") {
    throw new Error("FILING_CELL raw_text must be non-empty");
  }
}

function prepareHtmlAnchor(input) {
  requireFilingDocument(input);
  if (!CONTEXT_ROW_ANCHOR.test(input.evidence?.htmlAnchor ?? "")) {
    throw new Error("HTML_ANCHOR must be an ix-context-row anchor");
  }
  return {
    nameSource: "FILING_CELL",
    locatorType: "HTML_ANCHOR",
    rawText: input.rawText,
    evidenceId: input.evidence.id ?? null,
  };
}

function prepareIxbrlFact(input) {
  requireFilingDocument(input);
  const factName = input.evidence?.factName;
  if (!factName) {
    throw new Error("IXBRL_FACT is not borrower-name evidence merely because it is L2");
  }
  if (RATE_FACTS.has(factName) || NUMERIC_FACT_TEXT.test(input.rawText)) {
    throw new Error("a spread or rate fact is not borrower-name evidence");
  }
  return {
    nameSource: "FILING_CELL",
    locatorType: "IXBRL_FACT",
    rawText: input.rawText,
    evidenceId: input.evidence.id ?? null,
    factName,
  };
}

function prepareHtmlTableCell(input) {
  requireFilingDocument(input);
  const evidence = input.evidence;
  const parent = input.blockEvidence;
  if (evidence?.artifactId !== input.artifact.id || parent?.artifactId !== input.artifact.id) {
    throw new Error("wrong artifact");
  }
  if (parent?.locatorType !== "DISCLOSURE_BLOCK" || evidence?.blockEvidenceId !== parent.id) {
    throw new Error("wrong block");
  }
  if (evidence.htmlRowOrdinal !== parent.htmlRowOrdinal) {
    throw new Error("cell row is not the block start");
  }
  const parsed = parseScheduleDisclosureBlocks(input.html);
  const block = parsed.blocks.find((item) => (
    item.startRowOrdinal === parent.htmlRowOrdinal && item.endRowOrdinal === parent.htmlRowEndOrdinal
  ));
  if (!block) throw new Error("parser did not resolve the block");
  assertFilingCompanyCell(block, { slot: evidence.htmlSlotOrdinal, rawText: input.rawText });
  return {
    nameSource: "FILING_CELL",
    locatorType: "HTML_TABLE_CELL",
    rawText: input.rawText,
    evidenceId: evidence.id ?? null,
    blockEvidenceId: parent.id,
    htmlRowOrdinal: evidence.htmlRowOrdinal,
    htmlSlotOrdinal: evidence.htmlSlotOrdinal,
    blockStartRow: block.startRowOrdinal,
    blockEndRow: block.endRowOrdinal,
    parserVersion: PARSER_VERSION,
  };
}

export function prepareFilingCellObservation(input) {
  const locator = input.evidence?.locatorType;
  if (locator === "HTML_TABLE_CELL") return prepareHtmlTableCell(input);
  if (locator === "HTML_ANCHOR") return prepareHtmlAnchor(input);
  if (locator === "IXBRL_FACT") return prepareIxbrlFact(input);
  throw new Error("FILING_CELL locator is not HTML_TABLE_CELL, HTML_ANCHOR, or IXBRL_FACT");
}
