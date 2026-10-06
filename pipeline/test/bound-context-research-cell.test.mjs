import test from "node:test";
import assert from "node:assert/strict";
import { boundContextResearchCells, researchHeadAction } from "../extract/bound-context-research-cell.mjs";

const CURRENT = "i3209c8499d854347ae9587c162ae445a_I20230331";
const COMPARATIVE = "i5eb6ad985d904f6a9343fd73a3935455_I20220331";

function fact(contextId) {
  return `<ix:nonFraction contextRef="${contextId}" id="f-${contextId}" name="us-gaap:InvestmentOwnedBalancePrincipalAmount" scale="3">6,769</ix:nonFraction>`;
}

function schedule(rows) {
  const header = "<tr><td colspan=\"3\">Investment</td><td colspan=\"3\">Maturity</td><td colspan=\"3\">Interest</td></tr>"
    + "<tr><td colspan=\"3\">Portfolio Company</td><td colspan=\"3\">Industry</td><td colspan=\"3\">Type</td>"
    + "<td colspan=\"3\">Date</td><td colspan=\"3\">Rate</td></tr>";
  return `<table>${header}${rows}</table>`;
}

function dataRow(company, industry, type, contextId, rateText) {
  return `<tr><td colspan="3">${company}</td><td colspan="3">${industry}</td><td colspan="3">${type}</td>`
    + `<td colspan="3">12/19/2025</td><td colspan="3">${rateText}${fact(contextId)}</td></tr>`;
}

function domain(contextId, identifier) {
  return `<xbrli:context id="${contextId}"><xbrldi:typedMember dimension="us-gaap-supplement:InvestmentIdentifierAxis">`
    + `<us-gaap-supplement:InvestmentIdentifierAxis.domain>${identifier}</us-gaap-supplement:InvestmentIdentifierAxis.domain>`
    + "</xbrldi:typedMember></xbrli:context>";
}

function field(result, code) {
  return result.fields.find((item) => item.fieldCode === code);
}

test("the bound 2023 row supplies industry and type from its cells", () => {
  const html = domain(CURRENT, "Geo Parent Corporation, First Lien")
    + schedule(dataRow(
      "Geo Parent Corporation",
      "Building &amp; infrastructure products",
      "First Lien",
      CURRENT,
      "SOFR+",
    ));
  const result = boundContextResearchCells(html, CURRENT);
  assert.equal(result.contextId, CURRENT);
  assert.equal(field(result, "INDUSTRY").rawText, "Building & infrastructure products");
  assert.equal(field(result, "INSTRUMENT_TYPE").rawText, "First Lien");
  assert.equal(field(result, "INDUSTRY").heading.matchedText, "Industry");
  assert.equal(field(result, "INSTRUMENT_TYPE").heading.matchedText, "Type");
  assert.equal(field(result, "INDUSTRY").slotOrdinal, field(result, "INDUSTRY").heading.slotOrdinal);
  assert.equal(field(result, "INSTRUMENT_TYPE").slotOrdinal, field(result, "INSTRUMENT_TYPE").heading.slotOrdinal);
  assert.equal(result.fields.some((item) => item.rawText.includes("SOFR")), false);
  assert.equal(result.fields.some((item) => item.rawText === "Geo Parent Corporation"), false);
});

test("a different type cell is kept when the identifier text says First Lien", () => {
  const html = domain(CURRENT, "Geo Parent Corporation, First Lien")
    + schedule(dataRow("Geo Parent Corporation", "Software", "Second Lien", CURRENT, "SOFR+"));
  const result = boundContextResearchCells(html, CURRENT);
  assert.equal(field(result, "INSTRUMENT_TYPE").rawText, "Second Lien");
  assert.equal(field(result, "INDUSTRY").rawText, "Software");
});

test("the 2022 context stays on its own row", () => {
  const html = schedule(
    dataRow("Geo Parent Corporation", "Building &amp; infrastructure products", "First Lien", CURRENT, "SOFR+")
    + dataRow("Geo Parent Corporation", "Prior year industry", "First Lien", COMPARATIVE, "L+"),
  );
  const later = boundContextResearchCells(html, CURRENT);
  const earlier = boundContextResearchCells(html, COMPARATIVE);
  assert.equal(field(later, "INDUSTRY").rawText, "Building & infrastructure products");
  assert.equal(field(earlier, "INDUSTRY").rawText, "Prior year industry");
  assert.notEqual(later.rowOrdinal, earlier.rowOrdinal);
  assert.equal(later.contextId, CURRENT);
  assert.equal(earlier.contextId, COMPARATIVE);
});

test("a New Mountain header is not read as Industry and Type", () => {
  const html = "<table><tr><td>Portfolio Company, Location and Industry</td><td>Type of Investment</td><td>Fair Value</td></tr>"
    + `<tr><td>Business Services</td><td>First Lien(2)(3)</td><td>${fact("nm")}</td></tr></table>`;
  assert.equal(boundContextResearchCells(html, "nm"), null);
});

test("an existing identical head is kept and a different head conflicts", () => {
  const raw = "Building & infrastructure products";
  assert.equal(researchHeadAction([], raw), "INSERT");
  assert.equal(researchHeadAction([{ rawValue: raw, normalizedText: raw, valueState: "REPORTED" }], raw), "KEEP");
  assert.equal(researchHeadAction([{ rawValue: "Software", normalizedText: "Software", valueState: "REPORTED" }], raw), "CONFLICT");
  assert.equal(researchHeadAction([
    { rawValue: raw, normalizedText: raw, valueState: "REPORTED" },
    { rawValue: raw, normalizedText: raw, valueState: "REPORTED" },
  ], raw), "CONFLICT");
});
