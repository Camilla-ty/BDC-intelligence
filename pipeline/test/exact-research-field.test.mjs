import assert from "node:assert/strict";
import test from "node:test";
import { selectExactResearchFields } from "../extract/exact-research-field.mjs";
import { RULES, ruleDefinitionSha } from "../load/rules.mjs";

const PERIOD = "2099-09-30";
const OTHER_PERIOD = "2099-06-30";
const HOLDING = "TEST HOLDING, First Lien 1";
const SIBLING = "TEST HOLDING, First Lien 2";
const INSTRUMENT = "First lien (2)(3)";

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

function schedule(contextsHtml, body) {
  return `${contextsHtml}<table>${header()}${body}</table>`;
}

function field(result, code) {
  return result.fields.find((item) => item.fieldCode === code) ?? null;
}

test("exact domain and period returns industry and instrument type", () => {
  const html = schedule(
    context("c1", HOLDING, PERIOD),
    companyRow("TEST COMPANY") + detailRow("TEST INDUSTRY CELL", INSTRUMENT, fact("f1", "c1")),
  );
  const result = selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  });
  assert.equal(field(result, "INDUSTRY").rawText, "TEST INDUSTRY CELL");
  assert.equal(field(result, "INSTRUMENT_TYPE").rawText, INSTRUMENT);
  assert.equal(field(result, "INDUSTRY").htmlSlotOrdinal, result.block.portfolioCompanySlot);
  assert.equal(field(result, "INSTRUMENT_TYPE").htmlSlotOrdinal, result.block.typeSlot);
  assert.equal(field(result, "INDUSTRY").htmlRowOrdinal, field(result, "INSTRUMENT_TYPE").htmlRowOrdinal);
  assert.ok(field(result, "INDUSTRY").htmlRowOrdinal > result.block.startRowOrdinal);
  assert.deepEqual(result.fields.map((item) => item.fieldCode).sort(), ["INDUSTRY", "INSTRUMENT_TYPE"]);
});

test("empty industry cell writes no industry field", () => {
  const html = schedule(
    context("c1", HOLDING, PERIOD),
    companyRow("TEST COMPANY") + detailRow("", INSTRUMENT, fact("f1", "c1")),
  );
  const result = selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  });
  assert.equal(field(result, "INDUSTRY"), null);
  assert.equal(field(result, "INSTRUMENT_TYPE").rawText, INSTRUMENT);
});

test("sibling industry is not copied onto an empty industry row", () => {
  const html = schedule(
    context("c1", HOLDING, PERIOD) + context("c2", SIBLING, PERIOD),
    companyRow("TEST COMPANY")
      + detailRow("TEST INDUSTRY CELL", "First Lien(2)", fact("f1", "c1"))
      + detailRow("", "First Lien(4)", fact("f2", "c2")),
  );
  const sibling = selectExactResearchFields({
    html, holdingDescriptorRaw: SIBLING, reportedDate: PERIOD,
  });
  assert.equal(field(sibling, "INDUSTRY"), null);
  assert.equal(field(sibling, "INSTRUMENT_TYPE").rawText, "First Lien(4)");
  const first = selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  });
  assert.equal(field(first, "INDUSTRY").rawText, "TEST INDUSTRY CELL");
  assert.notEqual(field(first, "INDUSTRY").htmlRowOrdinal, field(sibling, "INSTRUMENT_TYPE").htmlRowOrdinal);
});

test("trailing-space identifier produces no field", () => {
  const html = schedule(
    context("c1", `${HOLDING} `, PERIOD),
    companyRow("TEST COMPANY") + detailRow("TEST INDUSTRY CELL", INSTRUMENT, fact("f1", "c1")),
  );
  const result = selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  });
  assert.deepEqual(result.fields, []);
  assert.equal(result.block, null);
});

test("wrong context period produces no field", () => {
  const html = schedule(
    context("c1", HOLDING, OTHER_PERIOD),
    companyRow("TEST COMPANY") + detailRow("TEST INDUSTRY CELL", INSTRUMENT, fact("f1", "c1")),
  );
  const result = selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  });
  assert.deepEqual(result.fields, []);
});

test("single-row schedule layout is ignored", () => {
  const html = context("c1", HOLDING, PERIOD)
    + "<table><tr>"
    + td("Portfolio Company") + td("Industry") + td("Type") + td("Date") + td("Fair Value")
    + "</tr><tr>"
    + td("TEST COMPANY") + td("Building products") + td("First Lien") + td("12/19/2099") + td(fact("f1", "c1"))
    + "</tr></table>";
  const result = selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  });
  assert.deepEqual(result.fields, []);
  assert.equal(result.block, null);
});

test("raw cell text is preserved exactly", () => {
  const html = schedule(
    context("c1", HOLDING, PERIOD),
    companyRow("TEST COMPANY") + detailRow("TEST INDUSTRY CELL", "First lien (2)(3)", fact("f1", "c1")),
  );
  const result = selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  });
  assert.equal(field(result, "INSTRUMENT_TYPE").rawText, "First lien (2)(3)");
  assert.equal(field(result, "INDUSTRY").rawText, "TEST INDUSTRY CELL");
});

test("holding text is not trimmed before comparison", () => {
  const html = schedule(
    context("c1", HOLDING, PERIOD),
    companyRow("TEST COMPANY") + detailRow("TEST INDUSTRY CELL", INSTRUMENT, fact("f1", "c1")),
  );
  const result = selectExactResearchFields({
    html, holdingDescriptorRaw: `${HOLDING} `, reportedDate: PERIOD,
  });
  assert.deepEqual(result.fields, []);
});

test("two exact rows for one holding are refused", () => {
  const html = schedule(
    context("c1", HOLDING, PERIOD) + context("c2", HOLDING, PERIOD),
    companyRow("TEST COMPANY")
      + detailRow("TEST INDUSTRY CELL", "First Lien(2)", fact("f1", "c1"))
      + detailRow("TEST INDUSTRY CELL", "First Lien(4)", fact("f2", "c2")),
  );
  assert.throws(() => selectExactResearchFields({
    html, holdingDescriptorRaw: HOLDING, reportedDate: PERIOD,
  }), /more than one detail row/);
});

test("parser rule version 2 definition is unchanged", () => {
  const rule = RULES.find((item) => item.code === "parser.sec_schedule_disclosure_block" && item.version === "2");
  assert.deepEqual(rule.files, [
    "pipeline/parse/schedule-disclosure-block.mjs",
    "pipeline/parse/filing-cell-writer.mjs",
    "pipeline/load/filing-cell.mjs",
  ]);
  assert.equal(ruleDefinitionSha(rule), "6356c716c4ec99d7cd3959a199c1812c16d3b595814ab8b86c0aca437c666d65");
  const research = RULES.find((item) => item.code === "obs.research_field.exact_disclosure_cell" && item.version === "1");
  assert.ok(research);
  assert.equal(research.files.includes("pipeline/parse/schedule-disclosure-block.mjs"), false);
  assert.equal(research.files.includes("pipeline/load/filing-cell.mjs"), false);
  assert.equal(research.files.includes("pipeline/parse/filing-cell-writer.mjs"), false);
});
