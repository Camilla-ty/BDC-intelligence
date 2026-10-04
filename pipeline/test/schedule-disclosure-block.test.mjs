import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { tableRows } from "../normalize/ix-context-row.mjs";
import { ingestFilingCompanyCell } from "../load/filing-cell.mjs";
import { ensureAndLinkRuleForRun } from "../load/rules.mjs";
import { prepareFilingCellObservation } from "../parse/filing-cell-writer.mjs";
import {
  PARSER_CODE, PARSER_VERSION, PARSER_VERSION_V1, ROW_KIND, assertFilingCompanyCell, assertLineFact, cellText,
  parseScheduleDisclosureBlocks, parseScheduleDisclosureBlocksV1,
} from "../parse/schedule-disclosure-block.mjs";

const NMSLF = ".data/sec/raw/sha256/11/1198e53d4e4112e184f81b370b72d069d78995cd9c443c2e6b9dcf69819ad0c5";
const NMG4 = ".data/sec/raw/sha256/c2/c20adec5bed72b1b59b706ea5396efb77888ee25bc1a40bda29c1518a6d6e05b";
const INCOME = ".data/sec/raw/sha256/31/310d5cfeb4464a2546ca61fe4a4c68a02f611acf91fe88571cbc646b7600767a";

function td(text, colspan = 1) {
  return `<td colspan="${colspan}">${text}</td>`;
}

function header(label = "Portfolio Company, Location and Industry(1)") {
  return `<tr>${td(label, 3)}${td("Type of Investment", 3)}${td("Fair Value", 3)}</tr>`;
}

function contexts(entries) {
  return entries.map(([id, domain]) => (
    `<xbrli:context id="${id}"><xbrli:entity><xbrli:segment>`
    + `<xbrldi:typedMember dimension="us-gaap:InvestmentIdentifierAxis">`
    + `<us-gaap:InvestmentIdentifierAxis.domain>${domain}</us-gaap:InvestmentIdentifierAxis.domain>`
    + `</xbrldi:typedMember></xbrli:segment></xbrli:entity></xbrli:context>`
  )).join("");
}

function fact(id, contextId, name, text) {
  return `<ix:nonFraction id="${id}" contextRef="${contextId}" name="${name}">${text}</ix:nonFraction>`;
}

function schedule(body, contextEntries) {
  return `${contexts(contextEntries)}<table>${header()}${body}</table>`;
}

test("parser version is explicit", () => {
  assert.equal(PARSER_CODE, "parser.sec_schedule_disclosure_block");
  assert.equal(PARSER_VERSION_V1, "1");
  assert.equal(PARSER_VERSION, "2");
});

test("cell text keeps interior spaces and omits markup whitespace", () => {
  assert.equal(cellText("Geo  Parent Corporation"), "Geo  Parent Corporation");
  assert.equal(cellText("\n  <span>First Lien(2)(3)</span>\n"), "First Lien(2)(3)");
  assert.equal(cellText("&#160;"), "");
  assert.equal(cellText("5.25&amp;"), "5.25&");
});

test("colspan reconstruction places the type column on its slot", () => {
  const html = schedule(
    `<tr>${td("Geo Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr>${td("Business Services", 3)}${td("First Lien(2)(3)", 3)}${td(fact("f-1", "c-1", "us-gaap:InvestmentOwnedAtFairValue", "11,952"), 3)}</tr>`,
    [["c-1", "Geo Parent Corporation, First Lien"]],
  );
  const block = parseScheduleDisclosureBlocks(html).blocks[0];
  assert.equal(block.portfolioCompanySlot, 0);
  assert.equal(block.typeSlot, 3);
  assert.equal(block.fairValueSlot, 6);
  assert.equal(block.rows[1].cells.find((cell) => cell.slot === 3).text, "First Lien(2)(3)");
});

test("a single company block stops before the next company", () => {
  const html = schedule(
    `<tr>${td("Geo Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr>${td("Business Services", 3)}${td("First Lien(2)(3)", 3)}${td(fact("f-1", "c-1", "us-gaap:InvestmentBasisSpreadVariableRate", "5.25"), 3)}</tr>`
    + `<tr>${td("Nielsen Consumer Inc.**", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr>${td("Business Services", 3)}${td("First Lien(2)", 3)}${td(fact("f-2", "c-2", "us-gaap:InvestmentBasisSpreadVariableRate", "6.25"), 3)}</tr>`,
    [
      ["c-1", "Geo Parent Corporation, First Lien"],
      ["c-2", "Nielsen Consumer Inc, First Lien"],
    ],
  );
  const { blocks } = parseScheduleDisclosureBlocks(html);
  const geo = blocks.find((block) => block.companyText === "Geo Parent Corporation");
  const nielsen = blocks.find((block) => block.companyText === "Nielsen Consumer Inc.**");
  assert.equal(geo.rows.filter((row) => row.kind === ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER).length, 1);
  assert.equal(geo.rows[1].lines[0].domain, "Geo Parent Corporation, First Lien");
  assert.ok(nielsen.startRowOrdinal > geo.endRowOrdinal);
  assert.throws(() => assertLineFact(geo, { rowOrdinal: nielsen.rows[1].rowOrdinal, contextId: "c-2" }), /row outside block|context mismatch/);
  assert.throws(() => assertLineFact(geo, { rowOrdinal: geo.rows[1].rowOrdinal, contextId: "c-2" }), /context mismatch/);
});

test("two lien lines and a total stay in one company block", () => {
  const html = schedule(
    `<tr>${td("Geo Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr>${td("Business Services", 3)}${td("First Lien(2)(5)", 3)}${td(fact("f-1", "c-81", "us-gaap:InvestmentOwnedBalancePrincipalAmount", "17,717"), 3)}</tr>`
    + `<tr>${td("", 3)}${td("First Lien(4)(5)", 3)}${td(fact("f-2", "c-82", "us-gaap:InvestmentOwnedBalancePrincipalAmount", "3,299"), 3)}</tr>`
    + `<tr>${td("", 3)}${td("", 3)}${td(fact("f-3", "c-83", "us-gaap:InvestmentOwnedBalancePrincipalAmount", "21,016"), 3)}</tr>`
    + `<tr>${td("iCIMS, Inc.", 3)}${td("", 3)}${td("", 3)}</tr>`,
    [
      ["c-81", "Geo Parent Corporation, First Lien 1"],
      ["c-82", "Geo Parent Corporation, First Lien 2"],
    ],
  );
  const block = parseScheduleDisclosureBlocks(html).blocks[0];
  assert.equal(block.companyText, "Geo Parent Corporation");
  assert.deepEqual(block.rows.filter((row) => row.kind === ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER).map((row) => row.lines[0].domain), [
    "Geo Parent Corporation, First Lien 1",
    "Geo Parent Corporation, First Lien 2",
  ]);
  assert.equal(block.rows.filter((row) => row.kind === ROW_KIND.TOTAL_OR_SUBTOTAL).length, 1);
  assert.equal(block.rows.filter((row) => row.kind === "company").length, 1);
  assert.equal(block.endRowOrdinal, block.startRowOrdinal + 3);
});

test("a repeated schedule header starts a separate section", () => {
  const html = `${contexts([["c-1", "Geo Parent Corporation, First Lien"], ["c-2", "Geo Parent Corporation"]])}`
    + `<table>${header()}`
    + `<tr>${td("Geo Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr>${td("Business Services", 3)}${td("First Lien(2)(3)", 3)}${td(fact("f-1", "c-1", "us-gaap:InvestmentInterestRate", "10.80"), 3)}</tr>`
    + `${header("Portfolio Company, Location and Industry (1)")}`
    + `<tr>${td("Geo Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr>${td("Business Services", 3)}${td("First lien (2)(3)", 3)}${td(fact("f-2", "c-2", "us-gaap:InvestmentInterestRate", "9.44"), 3)}</tr>`
    + `</table>`;
  const blocks = parseScheduleDisclosureBlocks(html).blocks.filter((block) => block.companyText === "Geo Parent Corporation");
  assert.equal(blocks.length, 2);
  assert.notEqual(blocks[0].startRowOrdinal, blocks[1].startRowOrdinal);
  assert.notEqual(blocks[0].headerRowOrdinal, blocks[1].headerRowOrdinal);
  assert.equal(blocks[1].rows[1].lines[0].domain, "Geo Parent Corporation");
});

test("a concentration table and a wrong table produce no block", () => {
  const concentration = "<table><tr><td>Industry Type</td><td>Percent of Total</td></tr>"
    + "<tr><td>Geo Parent Corporation</td><td>4.2 %</td></tr></table>";
  const wrong = "<table><tr><td>Portfolio Company</td><td>Balance</td></tr>"
    + "<tr><td>Geo Parent Corporation</td></tr></table>";
  assert.equal(parseScheduleDisclosureBlocks(concentration).blocks.length, 0);
  assert.equal(parseScheduleDisclosureBlocks(wrong).blocks.length, 0);
});

test("malformed markup and a nested table refuse the candidate block", () => {
  const nested = schedule(
    `<tr>${td("Geo Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr><td colspan="3"><table><tr><td>inner</td></tr></table></td>${td("", 3)}${td("", 3)}</tr>`,
    [],
  );
  const nestedResult = parseScheduleDisclosureBlocks(nested);
  assert.equal(nestedResult.blocks.length, 0);
  assert.equal(nestedResult.refusals[0].reason, "nested table");

  const unclosed = "<tr><td>Portfolio Company, Location and Industry</td>";
  assert.equal(parseScheduleDisclosureBlocks(unclosed).blocks.length, 0);

  const brokenCell = schedule(
    `<tr>${td("Geo Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + "<tr><td colspan=\"3\">Business Services<td colspan=\"3\">First Lien</td><td colspan=\"3\"></td></tr>",
    [],
  );
  const broken = parseScheduleDisclosureBlocks(brokenCell);
  assert.equal(broken.blocks.length, 0);
  assert.equal(broken.refusals[0].reason, "unclosed cell");
});

test("the same bytes produce the same blocks", () => {
  const html = schedule(
    `<tr>${td("Geo  Parent Corporation", 3)}${td("", 3)}${td("", 3)}</tr>`
    + `<tr>${td("", 3)}${td("First Lien(2)(3)", 3)}${td("", 3)}</tr>`,
    [],
  );
  const first = parseScheduleDisclosureBlocks(html);
  const second = parseScheduleDisclosureBlocks(Buffer.from(html));
  assert.deepEqual(second, first);
  assert.equal(first.blocks[0].companyText, "Geo  Parent Corporation");
  assert.throws(() => assertFilingCompanyCell(first.blocks[0], { slot: 3, rawText: "Geo  Parent Corporation" }), /slot mismatch/);
  assert.throws(() => assertFilingCompanyCell(first.blocks[0], { slot: 0, rawText: "Geo Parent Corporation" }), /company text mismatch/);
  assert.doesNotThrow(() => assertFilingCompanyCell(first.blocks[0], { slot: 0, rawText: "Geo  Parent Corporation" }));
});

test("row ordinals follow the shared tr scan", () => {
  const html = "<div><tr><td>one</td></tr><span>tricky</span><tr><td>two</td></tr></div>";
  const parsed = parseScheduleDisclosureBlocks(html);
  assert.equal(tableRows(html).length, 2);
  assert.equal(parsed.blocks.length, 0);
});

test("verified NMF filing: Geo Parent rows 534-535 and Nielsen starts the next block", () => {
  const html = readFileSync(NMSLF);
  const { blocks } = parseScheduleDisclosureBlocks(html);
  const geo = blocks.find((block) => block.startRowOrdinal === 534);
  assert.ok(geo);
  assert.equal(geo.endRowOrdinal, 535);
  assert.equal(geo.companyText, "Geo Parent Corporation");
  assert.equal(geo.portfolioCompanySlot, 0);
  assert.equal(geo.rows[0].cells.find((cell) => cell.slot === 0).text, "Geo Parent Corporation");
  const detail = geo.rows.find((row) => row.rowOrdinal === 535);
  assert.equal(detail.kind, ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER);
  assert.equal(detail.cells.find((cell) => cell.slot === 6).text, "First Lien(2)(3)");
  assert.equal(detail.cells.find((cell) => cell.slot === 30).text, "05/2020");
  assert.equal(detail.cells.find((cell) => cell.slot === 36).text, "12/2028");
  const line = detail.lines[0];
  assert.equal(line.contextId, "c-183");
  assert.equal(line.domain, "Geo Parent Corporation, First Lien ");
  const byName = Object.fromEntries(line.facts.map((fact) => [fact.name, fact.text]));
  assert.equal(byName["us-gaap:InvestmentBasisSpreadVariableRate"], "5.25");
  assert.equal(byName["us-gaap:InvestmentInterestRate"], "10.80");
  assert.equal(byName["us-gaap:InvestmentOwnedBalancePrincipalAmount"], "11,952");
  assert.equal(byName["us-gaap:InvestmentOwnedAtCost"], "11,823");
  assert.equal(byName["us-gaap:InvestmentOwnedAtFairValue"], "11,952");
  const nielsen = blocks.find((block) => block.startRowOrdinal > 535 && block.companyText.startsWith("Nielsen Consumer"));
  assert.ok(nielsen);
  assert.ok(nielsen.startRowOrdinal > geo.endRowOrdinal);
  assert.throws(() => assertLineFact(geo, { rowOrdinal: nielsen.rows.find((row) => row.kind === ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER).rowOrdinal, contextId: nielsen.rows.find((row) => row.kind === ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER).lines[0].contextId }), /row outside block/);
  const again = parseScheduleDisclosureBlocks(html);
  assert.equal(again.blocks.length, blocks.length);
  assert.equal(again.blocks.find((block) => block.startRowOrdinal === 534).companyText, geo.companyText);
  const comparative = blocks.filter((block) => block.companyText === "Geo Parent Corporation" && block.startRowOrdinal !== 534);
  assert.ok(comparative.length >= 1);
  assert.ok(comparative.every((block) => block.headerRowOrdinal !== geo.headerRowOrdinal || block.startRowOrdinal !== geo.startRowOrdinal));
});

test("verified Guardian filing: First Lien 1, First Lien 2, and a total share one company cell", () => {
  const { blocks } = parseScheduleDisclosureBlocks(readFileSync(NMG4));
  const block = blocks.find((item) => item.rows.some((row) => row.lines.some((line) => line.domain === "Geo Parent Corporation, First Lien 1")));
  assert.ok(block);
  assert.equal(block.companyText, "Geo Parent Corporation");
  assert.equal(block.rows.filter((row) => row.kind === "company").length, 1);
  const domains = block.rows.filter((row) => row.kind === ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER).map((row) => row.lines[0].domain);
  assert.deepEqual(domains, ["Geo Parent Corporation, First Lien 1", "Geo Parent Corporation, First Lien 2"]);
  assert.ok(block.rows.some((row) => row.kind === ROW_KIND.TOTAL_OR_SUBTOTAL));
  assert.equal(block.rows.filter((row) => row.kind === ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER).length, 2);
});

test("version 1 still ends Atlas at the following section totals", () => {
  const { blocks } = parseScheduleDisclosureBlocksV1(readFileSync(NMSLF));
  const atlas = blocks.find((block) => block.startRowOrdinal === 757);
  assert.equal(atlas.endRowOrdinal, 762);
  assert.ok(atlas.rows.some((row) => row.rowOrdinal === 761));
  assert.ok(atlas.rows.some((row) => row.rowOrdinal === 762));
});

test("version 2 ends Atlas before the section aggregate rows", () => {
  const { blocks, excludedRows } = parseScheduleDisclosureBlocks(readFileSync(NMSLF));
  const atlas = blocks.find((block) => block.startRowOrdinal === 757);
  assert.equal(atlas.companyText, "Atlas AU Bidco Pty Ltd**");
  assert.equal(atlas.endRowOrdinal, 760);
  assert.equal(atlas.rows.at(-1).kind, ROW_KIND.TOTAL_OR_SUBTOTAL);
  assert.equal(atlas.rows.at(-1).lines.length, 0);
  assert.ok(!atlas.rows.some((row) => row.rowOrdinal === 761 || row.rowOrdinal === 762));
  assert.equal(excludedRows.find((row) => row.rowOrdinal === 761).classification, ROW_KIND.SECTION_BOUNDARY);
  assert.equal(excludedRows.find((row) => row.rowOrdinal === 762).text, "Total Funded Debt Investments");
  const pioneer = blocks.find((block) => block.startRowOrdinal === 764);
  assert.equal(pioneer.companyText, "Pioneer Topco I, L.P.");
  assert.ok(pioneer.startRowOrdinal > atlas.endRowOrdinal);
});

test("Guardian and Income Fund section totals stay outside the last company", () => {
  const guardian = parseScheduleDisclosureBlocks(readFileSync(NMG4));
  const guardianAtlas = guardian.blocks.find((block) => block.startRowOrdinal === 539);
  assert.equal(guardianAtlas.endRowOrdinal, 542);
  assert.equal(guardianAtlas.rows.at(-1).kind, ROW_KIND.TOTAL_OR_SUBTOTAL);
  assert.equal(guardian.excludedRows.find((row) => row.rowOrdinal === 543).text, "Total Funded Debt Investments - Australia");
  assert.ok(!guardianAtlas.rows.some((row) => row.rowOrdinal === 543 || row.rowOrdinal === 544));

  const income = parseScheduleDisclosureBlocks(readFileSync(INCOME));
  const incomeAtlas = income.blocks.find((block) => block.startRowOrdinal === 491);
  assert.equal(incomeAtlas.endRowOrdinal, 492);
  assert.equal(incomeAtlas.rows[1].kind, ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER);
  assert.equal(income.excludedRows.find((row) => row.rowOrdinal === 493).classification, ROW_KIND.SECTION_BOUNDARY);
});

test("an industry detail row stays inside and a section banner is not a company block", () => {
  const { blocks, excludedRows } = parseScheduleDisclosureBlocks(readFileSync(NMSLF));
  const geo = blocks.find((block) => block.startRowOrdinal === 534);
  const detail = geo.rows.find((row) => row.rowOrdinal === 535);
  assert.equal(detail.portfolioSlotText, "Business Services");
  assert.equal(detail.cells.find((cell) => cell.slot === geo.typeSlot).text, "First Lien(2)(3)");
  assert.equal(detail.kind, ROW_KIND.INVESTMENT_LINE_WITH_IDENTIFIER);
  const nielsen = blocks.find((block) => block.companyText.startsWith("Nielsen Consumer"));
  assert.ok(nielsen.startRowOrdinal > geo.endRowOrdinal);
  for (const label of [
    "Non-Controlled/Non-Affiliated Investments",
    "Funded Debt Investments - United States",
    "Equity - United States",
    "Funded Debt Investments - Australia",
  ]) {
    assert.equal(blocks.some((block) => block.companyText === label), false);
    assert.ok(excludedRows.some((row) => row.text === label));
  }
});

test("Pioneer Topco ordinary shares are an investment line without an identifier", () => {
  const { blocks } = parseScheduleDisclosureBlocks(readFileSync(NMSLF));
  const pioneer = blocks.find((block) => block.startRowOrdinal === 764);
  assert.equal(pioneer.endRowOrdinal, 765);
  const shares = pioneer.rows.find((row) => row.rowOrdinal === 765);
  assert.equal(shares.kind, ROW_KIND.INVESTMENT_LINE_WITHOUT_IDENTIFIER);
  assert.equal(shares.lines.length, 0);
  assert.equal(shares.cells.find((cell) => cell.text.startsWith("Ordinary Shares")).text, "Ordinary Shares(3)(6)");
  assert.ok(!pioneer.rows.some((row) => row.kind === ROW_KIND.TOTAL_OR_SUBTOTAL));
});

test("the filing-cell writer calls the company-cell check", () => {
  const html = readFileSync(NMSLF);
  const base = {
    html,
    artifact: { id: 361, sourceType: "SEC_FILING_DOCUMENT" },
    filingLink: { artifactId: 361, filingId: 7 },
    positionFilingId: 7,
    evidence: {
      id: 50,
      locatorType: "HTML_TABLE_CELL",
      artifactId: 361,
      blockEvidenceId: 10,
      htmlRowOrdinal: 534,
      htmlSlotOrdinal: 0,
    },
    blockEvidence: {
      id: 10,
      locatorType: "DISCLOSURE_BLOCK",
      artifactId: 361,
      htmlRowOrdinal: 534,
      htmlRowEndOrdinal: 535,
    },
    rawText: "Geo Parent Corporation",
  };
  const prepared = prepareFilingCellObservation(base);
  assert.equal(prepared.locatorType, "HTML_TABLE_CELL");
  assert.equal(prepared.rawText, "Geo Parent Corporation");
  assert.equal(prepared.htmlSlotOrdinal, 0);
  assert.throws(() => prepareFilingCellObservation({ ...base, evidence: { ...base.evidence, htmlSlotOrdinal: 6 } }), /slot mismatch/);
  assert.throws(() => prepareFilingCellObservation({ ...base, evidence: { ...base.evidence, htmlRowOrdinal: 535 } }), /cell row is not the block start/);
  assert.throws(() => prepareFilingCellObservation({
    ...base,
    evidence: { locatorType: "IXBRL_FACT", factName: "us-gaap:InvestmentInterestRate" },
    rawText: "10.80",
  }), /spread or rate fact/);
  assert.throws(() => prepareFilingCellObservation({
    ...base,
    evidence: { locatorType: "IXBRL_FACT", factName: "us-gaap:InvestmentOwnedAtFairValue" },
    rawText: "11,952",
  }), /spread or rate fact/);
  assert.throws(() => prepareFilingCellObservation({ ...base, rawText: "Geo Parent" }), /company text mismatch/);
  assert.throws(() => prepareFilingCellObservation({ ...base, evidence: { ...base.evidence, blockEvidenceId: 99 } }), /wrong block/);
  assert.throws(() => prepareFilingCellObservation({ ...base, evidence: { ...base.evidence, artifactId: 999 } }), /wrong artifact/);
  assert.throws(() => prepareFilingCellObservation({
    ...base,
    blockEvidence: { ...base.blockEvidence, htmlRowEndOrdinal: 762 },
  }), /parser did not resolve the block/);
  const anchor = prepareFilingCellObservation({
    ...base,
    evidence: { locatorType: "HTML_ANCHOR", htmlAnchor: "ix-context-row:c-183" },
    rawText: "Geo Parent Corporation",
  });
  assert.equal(anchor.locatorType, "HTML_ANCHOR");
  assert.throws(() => prepareFilingCellObservation({
    ...base,
    evidence: { locatorType: "IXBRL_FACT", factName: "us-gaap:InvestmentBasisSpreadVariableRate" },
    rawText: "5.25",
  }), /spread or rate fact/);
  assert.throws(() => prepareFilingCellObservation({
    ...base,
    evidence: { locatorType: "IXBRL_FACT" },
    rawText: "5.25",
  }), /merely because it is L2/);
  const writer = readFileSync(new URL("../parse/filing-cell-writer.mjs", import.meta.url), "utf8");
  assert.match(writer, /assertFilingCompanyCell\(/);
});

test("FILING_CELL ingestion calls the writer and has no second insert path", () => {
  const loader = readFileSync(new URL("../load/filing-cell.mjs", import.meta.url), "utf8");
  const soi = readFileSync(new URL("../load/p4-min.mjs", import.meta.url), "utf8");
  const call = loader.indexOf("prepareFilingCellObservation(");
  const ensure = loader.indexOf("ensureAndLinkRuleForRun(");
  const insert = loader.indexOf("INSERT INTO obs.borrower_name_observation");
  assert.ok(call > 0 && ensure > call && insert > ensure);
  assert.match(loader, /code: PARSER_CODE/);
  assert.match(loader, /version: PARSER_VERSION/);
  assert.doesNotMatch(loader, /registerRules\(/);
  assert.match(loader, /\$\{lit\(payload\.nameSource\)\}/);
  assert.match(loader, /\$\{lit\(payload\.rawText\)\}/);
  assert.match(loader, /\$\{num\(payload\.blockStartRow\)\}/);
  assert.doesNotMatch(soi, /FILING_CELL/);
  assert.doesNotMatch(soi, /prepareFilingCellObservation/);
  const loaders = readdirSync(new URL("../load/", import.meta.url))
    .filter((name) => name.endsWith(".mjs"))
    .filter((name) => readFileSync(new URL(`../load/${name}`, import.meta.url), "utf8").includes("FILING_CELL"));
  assert.deepEqual(loaders, ["filing-cell.mjs"]);
  assert.throws(() => ingestFilingCompanyCell({
    database: "bdc_must_not_be_contacted",
    runId: 1,
    html: "<html></html>",
    artifact: { id: 1, sourceType: "SEC_FILING_DOCUMENT" },
    filingLink: { artifactId: 1, filingId: 1 },
    positionFilingId: 1,
    positionObservationId: 1,
    evidence: {
      locatorType: "HTML_TABLE_CELL", artifactId: 1, blockEvidenceId: 1, htmlRowOrdinal: 9, htmlSlotOrdinal: 0,
    },
    blockEvidence: {
      id: 1, locatorType: "DISCLOSURE_BLOCK", artifactId: 1, htmlRowOrdinal: 2, htmlRowEndOrdinal: 3,
    },
    rawText: "TEST COMPANY CELL",
  }), /cell row is not the block start/);

  assert.throws(() => ensureAndLinkRuleForRun("bdc_must_not_be_contacted", 1, {
    code: "parser.sec_schedule_disclosure_block",
    version: "3",
  }), /not in the current RULES catalog/);
  assert.throws(() => ensureAndLinkRuleForRun("bdc_must_not_be_contacted", 1, {
    code: "pipeline.not_a_rule",
    version: "1",
  }), /not in the current RULES catalog/);
});

test("a concentration-list Geo Parent row is not a schedule block", () => {
  const { blocks } = parseScheduleDisclosureBlocks(readFileSync(INCOME));
  assert.ok(blocks.every((block) => block.rows[0].cells.every((cell) => cell.text !== "4.2")));
  assert.ok(blocks.filter((block) => block.companyText === "Geo Parent Corporation").every((block) => (
    block.rows.some((row) => row.lines.some((line) => line.domain.startsWith("Geo Parent Corporation")))
  )));
});
