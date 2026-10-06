import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../lib/store.mjs";
import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { normalizeDateHeading } from "../normalize/date-heading.mjs";
import { listIxContextRows } from "../normalize/ix-context-row.mjs";
import {
  NO_BIND_REASON, bindMaturityContext, bindMaturityContextRows, normalizeDisplayedDate, rejectSharedContextBinds,
} from "../normalize/maturity-context-bind.mjs";
import { RULE_TEXT, RULE_TEXT_VERSION_3, RULE_VERSION } from "../load/maturity-inspection-batch.mjs";

const REPORTED = "2099-12-31";

// A string period is an instant; { start, end } is a duration.
function contextDeclarations(periodEnds) {
  return Object.entries(periodEnds).map(([id, period]) => {
    const body = typeof period === "string"
      ? `<xbrli:instant>${period}</xbrli:instant>`
      : `<xbrli:startDate>${period.start}</xbrli:startDate><xbrli:endDate>${period.end}</xbrli:endDate>`;
    return `<xbrli:context id="${id}"><xbrli:entity></xbrli:entity><xbrli:period>${body}</xbrli:period></xbrli:context>`;
  }).join("");
}

// Declares every contextRef in the HTML with one period end unless given explicitly.
function withContexts(html, periodEnds = {}) {
  const declared = { ...periodEnds };
  for (const match of html.matchAll(/contextRef="([^"]+)"/g)) {
    if (!(match[1] in declared)) declared[match[1]] = REPORTED;
  }
  return `<ix:header><ix:resources>${contextDeclarations(declared)}</ix:resources></ix:header>${html}`;
}

function bind(html, fields, reportedDate = REPORTED, periodEnds = {}) {
  return bindMaturityContext(withContexts(html, periodEnds), fields, reportedDate);
}

function row(contextId, facts, extra = "") {
  const tags = facts.map((fact) => {
    const scale = fact.scale == null ? "" : ` scale="${fact.scale}"`;
    const sign = fact.sign ? ` sign="${fact.sign}"` : "";
    const format = fact.format ? ` format="${fact.format}"` : "";
    return `<ix:nonFraction contextRef="${contextId}" id="${fact.id}" name="us-gaap:${fact.name}"${scale}${sign}${format}>${fact.text}</ix:nonFraction>`;
  }).join("");
  return `<tr>${tags}${extra}</tr>`;
}

const TWO_CONTEXTS = [
  row("c-1", [
    { id: "f-1", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "5,000" },
    { id: "f-2", name: "InvestmentInterestRate", scale: "-2", text: "8.44" },
  ], "<span>2/4/2030</span>"),
  row("c-2", [
    { id: "f-9", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "9,250" },
    { id: "f-8", name: "InvestmentInterestRate", scale: "-2", text: "8.44" },
  ], "<span>2/4/2030</span>"),
].join("");

test("a four-digit month/day/year normalizes and a two-digit year does not", () => {
  assert.equal(normalizeDisplayedDate("2/4/2030"), "2030-02-04");
  assert.equal(normalizeDisplayedDate("12/30/26"), null);
  assert.equal(normalizeDisplayedDate("2/31/2030"), null);
});

test("the context whose tagged amounts match is the only bind", () => {
  const bound = bind(TWO_CONTEXTS, [
    { field_code: "PRINCIPAL_AMOUNT", raw_value: "5000000.0000", normalized_numeric: "5000000.0000" },
    { field_code: "INTEREST_RATE", raw_value: "0.0844", normalized_numeric: null },
  ]);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.contextId, "c-1");
  assert.equal(bound.rawValue, "2/4/2030");
  assert.equal(bound.normalizedDate, "2030-02-04");
  assert.deepEqual(bound.facts.map((fact) => fact.id), ["f-1", "f-2"]);
});

test("a shared rate without a distinguishing amount stays unbound", () => {
  const bound = bind(TWO_CONTEXTS, [
    { field_code: "INTEREST_RATE", raw_value: "0.0844", normalized_numeric: null },
  ]);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.reason, "more than one context matched");
});

test("no matching context stays unbound", () => {
  const bound = bind(TWO_CONTEXTS, [
    { field_code: "PRINCIPAL_AMOUNT", raw_value: "1.0000", normalized_numeric: "1.0000" },
  ]);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.reason, "no context matched every comparable field");
});

test("a tagged two-digit maturity is unresolved and keeps the raw text", () => {
  const html = row("c-1", [
    { id: "f-1", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "5,000" },
    { id: "f-d", name: "InvestmentMaturityDate", text: "12/30/26" },
  ]);
  const bound = bind(html, [
    { field_code: "PRINCIPAL_AMOUNT", raw_value: "5000000.0000", normalized_numeric: "5000000.0000" },
  ]);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates, [{ raw: "12/30/26", normalized: null, factId: "f-d" }]);
});

test("a tagged four-digit maturity is the displayed date", () => {
  const html = row("c-1", [
    { id: "f-1", name: "InvestmentOwnedAtCost", scale: "0", text: "(28,000)" },
    { id: "f-d", name: "InvestmentMaturityDate", text: "05/31/2028" },
  ]);
  const bound = bind(html, [
    { field_code: "COST", raw_value: "-28000.0000", normalized_numeric: "-28000.0000" },
  ]);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "05/31/2028");
  assert.equal(bound.normalizedDate, "2028-05-31");
});

test("a rendered month and year is kept raw and is not given a day", () => {
  const html = row("c-1", [
    { id: "f-1", name: "InvestmentOwnedAtCost", scale: "3", text: "(28)" },
  ], "<span>11/2030</span>");
  const bound = bind(html, [
    { field_code: "COST", raw_value: "-28000.0000", normalized_numeric: "-28000.0000" },
  ]);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates, [{ raw: "11/2030", normalized: null, factId: null }]);
});

test("a bound row with no displayed maturity is unavailable", () => {
  const html = row("c-1", [
    { id: "f-1", name: "InvestmentOwnedAtFairValue", scale: "3", sign: "-", text: "28" },
  ]);
  const bound = bind(html, [
    { field_code: "FAIR_VALUE", raw_value: "-28000.0000", normalized_numeric: "-28000.0000" },
  ]);
  assert.equal(bound.outcome, "UNAVAILABLE");
  assert.equal(bound.contextId, "c-1");
});

test("two untagged dates stay unresolved and neither is selected", () => {
  const html = row("c-1", [
    { id: "f-1", name: "InvestmentInterestRate", scale: "-2", text: "7.66" },
  ], "<span>1/2/2099</span><span>3/4/2099</span>");
  const bound = bind(html, [
    { field_code: "INTEREST_RATE", raw_value: "0.0766", normalized_numeric: null },
  ]);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates.map((candidate) => candidate.normalized), ["2099-01-02", "2099-03-04"]);
});

test("one rendered context is not assigned to two positions", () => {
  const html = row("c-shared", [
    { id: "f-a", name: "InvestmentInterestRate", scale: "-2", text: "8.23" },
    { id: "f-b", name: "InvestmentBasisSpreadVariableRate", scale: "-2", text: "4.50" },
  ], "<span>12/31/2031</span>");
  const fields = [
    { field_code: "INTEREST_RATE", raw_value: "0.0823", normalized_numeric: null },
    { field_code: "SPREAD", raw_value: "0.0450", normalized_numeric: null },
  ];
  const [left, right] = rejectSharedContextBinds([
    bind(html, fields),
    bind(html, fields),
  ]);
  assert.equal(left.outcome, "UNKNOWN");
  assert.equal(right.outcome, "UNKNOWN");
  assert.equal(left.contextId, null);
  assert.equal(left.reason, "context matched more than one position");
  assert.equal(left.normalizedDate, null);
});

test("every unbound result carries a stable no-bind reason", () => {
  const principal = [{ field_code: "PRINCIPAL_AMOUNT", raw_value: "5000000.0000", normalized_numeric: "5000000.0000" }];
  const rate = [{ field_code: "INTEREST_RATE", raw_value: "0.0844", normalized_numeric: null }];
  assert.equal(bind(TWO_CONTEXTS, principal, null).noBindReason, NO_BIND_REASON.NO_REPORTED_DATE);
  assert.equal(bind(TWO_CONTEXTS, [{ field_code: "MATURITY_DATE", raw_value: "", normalized_numeric: null }]).noBindReason,
    NO_BIND_REASON.NO_COMPARABLE_FIELD);
  assert.equal(bind(TWO_CONTEXTS, [{ ...principal[0], raw_value: "1.0000", normalized_numeric: "1.0000" }]).noBindReason,
    NO_BIND_REASON.NO_MATCH);
  assert.equal(bind(TWO_CONTEXTS, rate).noBindReason, NO_BIND_REASON.MULTIPLE_ROWS);
  const split = row("c-1", [{ id: "f-1", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "5,000" }])
    + row("c-1", [{ id: "f-2", name: "InvestmentInterestRate", scale: "-2", text: "8.44" }]);
  assert.equal(bind(split, principal).noBindReason, NO_BIND_REASON.CONTEXT_NOT_SINGLE_ROW);
  const single = row("c-1", [{ id: "f-1", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "5,000" }]);
  const [shared] = rejectSharedContextBinds([bind(single, principal), bind(single, principal)]);
  assert.equal(shared.noBindReason, NO_BIND_REASON.SHARED_ROW);
  assert.equal(bind(single, principal).noBindReason, undefined);
});

function td(text, colspan = 3, options = {}) {
  const rowspan = options.rowspan && options.rowspan !== 1 ? ` rowspan="${options.rowspan}"` : "";
  const open = `<td colspan="${colspan}"${rowspan}`;
  if (options.self || text == null) return `${open}/>`;
  return `${open}>${text}</td>`;
}

const PRINCIPAL_FACT = `<td colspan="3"><ix:nonFraction contextRef="c-1" id="f-1" name="us-gaap:InvestmentOwnedBalancePrincipalAmount" scale="0">100</ix:nonFraction></td>`;
const PRINCIPAL_FIELD = [{ field_code: "PRINCIPAL_AMOUNT", raw_value: "100", normalized_numeric: "100" }];

function width54Header() {
  return `<tr>${[
    td("Portfolio Company"),
    td(null),
    td("Type of Investment"),
    td(null),
    td("Current Interest Rate", 15),
    td(null),
    td("Acquisition Date 14"),
    td("Maturity"),
    td(null),
    td("Principal"),
    td("Cost"),
    td("Fair Value"),
    td(null),
    td("% of Net Assets"),
  ].join("")}</tr>`;
}

function width54Data({ company = td("Example Co"), acquisition, maturity }) {
  return `<tr>${[
    company,
    td(null),
    td("Term"),
    td(null),
    td("1%"),
    td("REF"),
    td("1%"),
    td("1%"),
    td("0"),
    td(null),
    td(acquisition),
    td(maturity),
    td(null),
    PRINCIPAL_FACT,
  ].join("")}</tr>`;
}

function width57Header() {
  return `<tr>${[
    td("Portfolio Company"),
    td(null),
    td("Type of Investment"),
    td(null),
    td("Current Interest Rate", 15),
    td(null),
    td("Acquisition Date 14"),
    td(null),
    td("Maturity"),
    td(null),
    td("Principal"),
  ].join("")}</tr>`;
}

function width57Data(acquisition, maturity) {
  return `<tr>${[
    td("Example Co"),
    td(null),
    td("Term"),
    td(null),
    td("1%"),
    td("REF"),
    td("1%"),
    td("1%"),
    td("0"),
    td(null),
    td(acquisition),
    td(null),
    td(maturity),
    td(null),
    PRINCIPAL_FACT,
  ].join("")}</tr>`;
}

function listed(html) {
  const rows = listIxContextRows(html);
  assert.equal(rows.length, 1);
  return rows[0];
}

function placement(row, raw) {
  return row.datePlacements.find((item) => item.raw === raw);
}

test("width-54 grid keeps 12/30/2027 in the Maturity column", () => {
  const html = `<table>${width54Header()}${width54Data({ acquisition: "7/17/2017", maturity: "12/30/2027" })}</table>`;
  const row = listed(html);
  assert.equal(row.acquisitionColumn, 30);
  assert.equal(row.maturityColumn, 33);
  assert.equal(placement(row, "7/17/2017").startColumn, 30);
  assert.equal(placement(row, "12/30/2027").startColumn, 33);
  assert.equal(placement(row, "12/30/2027").rowspan, 1);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "12/30/2027");
  assert.equal(bound.normalizedDate, "2027-12-30");
});

test("width-57 grid keeps 12/30/2027 on that table's Maturity header", () => {
  const html = `<table>${width57Header()}${width57Data("7/17/2017", "12/30/2027")}</table>`;
  const row = listed(html);
  assert.equal(row.acquisitionColumn, 30);
  assert.equal(row.maturityColumn, 36);
  assert.notEqual(row.maturityColumn, 33);
  assert.equal(placement(row, "7/17/2017").startColumn, row.acquisitionColumn);
  assert.equal(placement(row, "12/30/2027").startColumn, row.maturityColumn);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "12/30/2027");
  assert.equal(bound.normalizedDate, "2027-12-30");
});

test("width-54 grid reads the Maturity column for 2/4/2030, including when the dates are swapped", () => {
  const html = `<table>${width54Header()}${width54Data({ acquisition: "2/3/2025", maturity: "2/4/2030" })}</table>`;
  const row = listed(html);
  assert.equal(placement(row, "2/3/2025").startColumn, 30);
  assert.equal(placement(row, "2/4/2030").startColumn, 33);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "2/4/2030");
  assert.equal(bound.normalizedDate, "2030-02-04");

  const swapped = `<table>${width54Header()}${width54Data({ acquisition: "2/4/2030", maturity: "2/3/2025" })}</table>`;
  const swappedRow = listed(swapped);
  assert.equal(placement(swappedRow, "2/4/2030").startColumn, swappedRow.acquisitionColumn);
  assert.equal(placement(swappedRow, "2/3/2025").startColumn, swappedRow.maturityColumn);
  const swappedBound = bind(swapped, PRINCIPAL_FIELD);
  assert.equal(swappedBound.outcome, "FILING_DISPLAYED");
  assert.equal(swappedBound.rawValue, "2/3/2025");
  assert.equal(swappedBound.normalizedDate, "2025-02-03");
});

test("width-30 grid has a Maturity column and no Acquisition Date column", () => {
  const header = `<tr>${[
    td("Portfolio Company"),
    td("Type of Investment"),
    td("Current Interest Rate", 12),
    td("Maturity"),
    td("Principal"),
    td("Cost"),
    td("Fair Value"),
  ].join("")}</tr>`;
  const data = `<tr>${[
    td("Example Co"),
    td("Term"),
    td("1%"),
    td("REF"),
    td("1%"),
    td("1%"),
    td("2/4/2030"),
    PRINCIPAL_FACT,
  ].join("")}</tr>`;
  const html = `<table>${header}${data}</table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, 18);
  assert.equal(row.acquisitionColumn, null);
  assert.equal(placement(row, "2/4/2030").startColumn, 18);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "2/4/2030");
  assert.equal(bound.normalizedDate, "2030-02-04");
});

test("a continuation row with an empty company cell stays on the Maturity header", () => {
  const html = `<table>${width54Header()}${width54Data({
    company: td(null),
    acquisition: "7/17/2017",
    maturity: "12/30/2027",
  })}</table>`;
  const row = listed(html);
  assert.equal(placement(row, "7/17/2017").startColumn, row.acquisitionColumn);
  assert.equal(placement(row, "12/30/2027").startColumn, row.maturityColumn);
  assert.equal(row.maturityColumn, 33);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.rawValue, "12/30/2027");
  assert.equal(bound.normalizedDate, "2027-12-30");
});

test("self-closing spacer cells keep the Maturity column after PIK", () => {
  const html = `<table>${width54Header()}${width54Data({ acquisition: "7/17/2017", maturity: "12/30/2027" })}</table>`;
  const row = listed(html);
  const maturity = placement(row, "12/30/2027");
  const acquisition = placement(row, "7/17/2017");
  assert.equal(acquisition.startColumn, 30);
  assert.equal(maturity.startColumn, 33);
  assert.equal(maturity.startColumn - acquisition.startColumn, maturity.colspan);
  assert.equal(maturity.startColumn, row.maturityColumn);
  assert.equal(bind(html, PRINCIPAL_FIELD).rawValue, "12/30/2027");
});

test("an Acquisition Date is unavailable when the table has no Maturity header", () => {
  const html = `<table><tr>${[
    td("Portfolio Company"),
    td("Type of Investment"),
    td("Acquisition Date 14"),
    td("Cost"),
  ].join("")}</tr><tr>${[
    td("Example Co"),
    td("Class A Units"),
    td("4/15/2024"),
    PRINCIPAL_FACT,
  ].join("")}</tr></table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, null);
  assert.equal(placement(row, "4/15/2024").startColumn, row.acquisitionColumn);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNAVAILABLE");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates, []);
});

test("warrant expiration prose is not a maturity and the Acquisition Date is not promoted", () => {
  const html = `<table><tr>${[
    td("Portfolio Company"),
    td("Type of Investment", 6),
    td("Acquisition Date 14"),
    td("Cost"),
  ].join("")}</tr><tr>${[
    td(null),
    td("Warrants (Expiration - December 18, 2030)", 6),
    td("12/18/2025"),
    PRINCIPAL_FACT,
  ].join("")}</tr></table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, null);
  assert.equal(placement(row, "12/18/2025").startColumn, row.acquisitionColumn);
  assert.equal(row.untaggedDates.includes("12/18/2030"), false);
  assert.equal(row.datePlacements.some((item) => item.raw === "12/18/2030"), false);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNAVAILABLE");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.equal(bound.candidates.some((candidate) => candidate.raw === "12/18/2025" || candidate.raw === "12/18/2030"), false);
});

test("debt Acquisition Date 4/15/2024 stays out of Maturity 4/13/2029", () => {
  const html = `<table>${width54Header()}${width54Data({ acquisition: "4/15/2024", maturity: "4/13/2029" })}</table>`;
  const row = listed(html);
  assert.equal(placement(row, "4/15/2024").startColumn, row.acquisitionColumn);
  assert.equal(placement(row, "4/13/2029").startColumn, row.maturityColumn);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "4/13/2029");
  assert.equal(bound.normalizedDate, "2029-04-13");
});

test("a Maturity Date header is not treated as the exact Maturity column", () => {
  const html = `<table><tr>${[
    td("Pooling Date (1)"),
    td(null),
    td("Maturity Date"),
    td(null),
    td("Fixed Interest Rate"),
  ].join("")}</tr><tr>${[
    td("9/22/2021"),
    td(null),
    td("9/1/2031"),
    td(null),
    PRINCIPAL_FACT,
  ].join("")}</tr></table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, null);
  assert.equal(row.acquisitionColumn, null);
  assert.equal(placement(row, "9/22/2021").startColumn, 0);
  assert.equal(placement(row, "9/1/2031").startColumn, 6);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates.map((candidate) => candidate.raw), ["9/22/2021", "9/1/2031"]);
});

test("a date under Acquisition Date is not a maturity candidate", () => {
  const html = `<table>${width54Header()}${width54Data({ acquisition: "2/3/2025", maturity: "" })}</table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, 33);
  assert.equal(placement(row, "2/3/2025").startColumn, row.acquisitionColumn);
  assert.equal(row.datePlacements.some((item) => item.startColumn === row.maturityColumn), false);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNAVAILABLE");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
});

test("a table without a Maturity header keeps both untagged dates unresolved", () => {
  const html = `<table><tr>${td("Portfolio Company")}${td("Notes")}</tr><tr>${PRINCIPAL_FACT}${td("1/2/2099")}${td("3/4/2099")}</tr></table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, null);
  assert.equal(row.acquisitionColumn, null);
  assert.equal(placement(row, "1/2/2099").startColumn, 3);
  assert.equal(placement(row, "3/4/2099").startColumn, 6);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates.map((candidate) => candidate.raw), ["1/2/2099", "3/4/2099"]);
});

test("rowspan occupancy moves the next row past the spanned columns", () => {
  const html = `<table><tr>${td("Maturity", 3, { rowspan: 2 })}${td("Label")}</tr><tr><td colspan="3"><ix:nonFraction contextRef="c-1" id="f-1" name="us-gaap:InvestmentOwnedBalancePrincipalAmount" scale="0">100</ix:nonFraction>1/2/2099</td></tr></table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, 0);
  assert.equal(placement(row, "1/2/2099").startColumn, 3);
  assert.equal(placement(row, "1/2/2099").rowspan, 1);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNAVAILABLE");
  assert.equal(bound.rawValue, null);
});

// Fixed-zero and context-period cases. Names, amounts, and dates are fake.

const MARCH = "2099-03-31";
const JUNE = "2099-06-30";
const EM_DASH_ENTITY = "&#8212;";

function factCell(contextId, id, name, text, options = {}) {
  const scale = options.scale == null ? "" : ` scale="${options.scale}"`;
  const format = options.format ? ` format="${options.format}"` : "";
  return `<td colspan="3"><ix:nonFraction contextRef="${contextId}" id="${id}" name="us-gaap:${name}"${scale}${format}>${text}</ix:nonFraction></td>`;
}

function zeroCell(contextId, id, name) {
  return factCell(contextId, id, name, EM_DASH_ENTITY, { scale: "3", format: "ixt:fixed-zero" });
}

function equityHeader() {
  return `<tr>${[
    td("Portfolio Company"),
    td("Type of Investment"),
    td("Acquisition Date"),
    td("Cost"),
    td("Fair Value"),
  ].join("")}</tr>`;
}

function equityRow(contextId, prefix, { company = "TEST BORROWER A", type = "Class A Units", acquired = "1/2/2099", cost = "100" } = {}) {
  return `<tr>${[
    td(company),
    td(type),
    td(acquired),
    factCell(contextId, `${prefix}-cost`, "InvestmentOwnedAtCost", cost, { scale: "3" }),
    zeroCell(contextId, `${prefix}-fv`, "InvestmentOwnedAtFairValue"),
  ].join("")}</tr>`;
}

const ZERO_FV_EQUITY_FIELDS = [
  { field_code: "COST", raw_value: "100000.0000", normalized_numeric: "100000.0000" },
  { field_code: "FAIR_VALUE", raw_value: "0.0000", normalized_numeric: "0.0000" },
];

test("a fixed-zero em dash compares equal to a stored zero", () => {
  const html = `<table>${row("c-1", [
    { id: "f-p", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", format: "ixt:fixed-zero", text: EM_DASH_ENTITY },
    { id: "f-r", name: "InvestmentInterestRate", scale: "-2", text: "1.00" },
  ], "<td>2/4/2099</td>")}</table>`;
  const listedRow = listIxContextRows(html)[0];
  assert.equal(listedRow.facts[0].format, "ixt:fixed-zero");
  assert.equal(listedRow.facts[0].text, "\u2014");
  const bound = bind(html, [
    { field_code: "PRINCIPAL_AMOUNT", raw_value: "0.0000", normalized_numeric: "0.0000" },
    { field_code: "INTEREST_RATE", raw_value: "0.0100", normalized_numeric: null },
  ]);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.contextId, "c-1");
  assert.equal(bound.rawValue, "2/4/2099");
  assert.deepEqual(bound.facts.map((fact) => fact.id), ["f-p", "f-r"]);
});

test("a fixed-zero em dash does not equal a stored non-zero amount", () => {
  const html = `<table><tr>${zeroCell("c-1", "f-fv", "InvestmentOwnedAtFairValue")}</tr></table>`;
  const bound = bind(html, [{ field_code: "FAIR_VALUE", raw_value: "1000.0000", normalized_numeric: "1000.0000" }]);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.reason, "no context matched every comparable field");
});

test("an em dash without ixt:fixed-zero is not read as zero", () => {
  const html = `<table><tr>${factCell("c-1", "f-fv", "InvestmentOwnedAtFairValue", EM_DASH_ENTITY, { scale: "3" })}</tr></table>`;
  const bound = bind(html, [{ field_code: "FAIR_VALUE", raw_value: "0.0000", normalized_numeric: "0.0000" }]);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.reason, "no context matched every comparable field");
});

test("ixt:fixed-zero with a display other than an em dash is not compared", () => {
  const html = `<table><tr>${factCell("c-1", "f-fv", "InvestmentOwnedAtFairValue", "none", { format: "ixt:fixed-zero" })}</tr></table>`;
  const bound = bind(html, [{ field_code: "FAIR_VALUE", raw_value: "0.0000", normalized_numeric: "0.0000" }]);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.reason, "no context matched every comparable field");
});

const TWO_PERIODS = `<table>${row("c-mar", [
  { id: "f-m", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "100" },
], "<td>2/4/2099</td>")}${row("c-jun", [
  { id: "f-j", name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "100" },
], "<td>2/4/2099</td>")}</table>`;
const TWO_PERIOD_ENDS = { "c-mar": MARCH, "c-jun": JUNE };
const PRINCIPAL_100 = [{ field_code: "PRINCIPAL_AMOUNT", raw_value: "100000.0000", normalized_numeric: "100000.0000" }];

test("a March position cannot match an otherwise identical June row", () => {
  const bound = bind(TWO_PERIODS, PRINCIPAL_100, MARCH, TWO_PERIOD_ENDS);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.contextId, "c-mar");
  assert.deepEqual(bound.facts.map((fact) => fact.id), ["f-m"]);
});

test("same-period matching still binds the June row for a June position", () => {
  const bound = bind(TWO_PERIODS, PRINCIPAL_100, JUNE, TWO_PERIOD_ENDS);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.contextId, "c-jun");
});

test("a reported date that is not exactly a context period end binds nothing", () => {
  const notMonthEnd = bind(TWO_PERIODS, PRINCIPAL_100, "2099-03-30", TWO_PERIOD_ENDS);
  assert.equal(notMonthEnd.outcome, "UNKNOWN");
  assert.equal(notMonthEnd.reason, "no context matched every comparable field");
});

test("a position with no reported date stays unbound", () => {
  for (const reportedDate of [null, "", "03/31/2099"]) {
    const bound = bind(TWO_PERIODS, PRINCIPAL_100, reportedDate, TWO_PERIOD_ENDS);
    assert.equal(bound.outcome, "UNKNOWN");
    assert.equal(bound.reason, "position has no reported date");
    assert.equal(bound.contextId, null);
  }
});

test("without the period check both periods would match; the duplicate stays ambiguous within one period", () => {
  const samePeriod = bind(TWO_PERIODS, PRINCIPAL_100, MARCH, { "c-mar": MARCH, "c-jun": MARCH });
  assert.equal(samePeriod.outcome, "UNKNOWN");
  assert.equal(samePeriod.reason, "more than one context matched");
  assert.deepEqual(samePeriod.contextIds, ["c-mar", "c-jun"]);
});

test("zero-value equity units: fixed-zero compares, two same-period rows stay ambiguous, no date", () => {
  const html = `<table>${equityHeader()}${equityRow("c-u1", "u1")}${equityRow("c-u2", "u2", { company: "TEST BORROWER B" })}</table>`;
  const bound = bind(html, ZERO_FV_EQUITY_FIELDS, MARCH, { "c-u1": MARCH, "c-u2": MARCH });
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.reason, "more than one context matched");
  assert.deepEqual(bound.contextIds, ["c-u1", "c-u2"]);
  assert.equal(bound.contextId, null);
  assert.equal(bound.normalizedDate ?? null, null);
  assert.equal(bound.rawValue ?? null, null);

  const single = bind(`<table>${equityHeader()}${equityRow("c-u1", "u1")}</table>`, ZERO_FV_EQUITY_FIELDS, MARCH, { "c-u1": MARCH });
  assert.equal(single.outcome, "UNAVAILABLE");
  assert.equal(single.contextId, "c-u1");
  assert.equal(single.rawValue, null);
  assert.deepEqual(single.candidates, []);
});

test("equity preferred units: the March position selects only the March row and is unavailable", () => {
  const html = `<table>${equityHeader()}${equityRow("c-pm", "pm", { type: "Class A Preferred Units" })}${equityRow("c-pj", "pj", { type: "Class A Preferred Units" })}</table>`;
  const periods = { "c-pm": MARCH, "c-pj": JUNE };
  const march = bind(html, ZERO_FV_EQUITY_FIELDS, MARCH, periods);
  assert.equal(march.outcome, "UNAVAILABLE");
  assert.equal(march.contextId, "c-pm");
  assert.deepEqual(march.facts.map((fact) => fact.id), ["pm-cost", "pm-fv"]);
  assert.equal(march.rawValue, null);
  assert.equal(march.normalizedDate, null);
  assert.deepEqual(march.candidates, []);
  const june = bind(html, ZERO_FV_EQUITY_FIELDS, JUNE, periods);
  assert.equal(june.contextId, "c-pj");
});

function debtScheduleWithAffiliatesRow() {
  const debtHeader = `<tr>${[td("Portfolio Company"), td("Type of Investment"), td("Maturity"), td("Principal"), td("Fair Value")].join("")}</tr>`;
  const debtRow = `<tr>${[
    td("TEST BORROWER A"),
    td("First Lien 1"),
    td("4/13/2099"),
    factCell("c-s", "s-p", "InvestmentOwnedBalancePrincipalAmount", "100", { scale: "3" }),
    factCell("c-s", "s-fv", "InvestmentOwnedAtFairValue", "50", { scale: "3" }),
    factCell("c-s", "s-r", "InvestmentInterestRate", "1.00", { scale: "-2" }),
  ].join("")}</tr>`;
  const affiliatesHeader = `<tr>${[td("Portfolio Company"), td("Principal"), td("Opening"), td("Closing")].join("")}</tr>`;
  const affiliatesRow = `<tr>${[
    td("Test Borrower A | First Lien 1"),
    factCell("c-a1", "a-p", "InvestmentOwnedBalancePrincipalAmount", "100", { scale: "3" }),
    factCell("c-a3", "a-open", "InvestmentOwnedAtFairValue", "40", { scale: "3" }),
    factCell("c-a1", "a-fv", "InvestmentOwnedAtFairValue", "50", { scale: "3" }),
    factCell("c-a2", "a-int", "InvestmentInterestRate", "1.00", { scale: "-2" }),
  ].join("")}</tr>`;
  const html = `<table>${debtHeader}${debtRow}</table><table>${affiliatesHeader}${affiliatesRow}</table>`;
  return withContexts(html, {
    "c-s": JUNE,
    "c-a1": JUNE,
    "c-a2": { start: "2099-01-01", end: JUNE },
    "c-a3": MARCH,
  });
}

const DEBT_FIELDS = [
  { field_code: "PRINCIPAL_AMOUNT", raw_value: "100000.0000", normalized_numeric: "100000.0000" },
  { field_code: "FAIR_VALUE", raw_value: "50000.0000", normalized_numeric: "50000.0000" },
  { field_code: "INTEREST_RATE", raw_value: "0.0100", normalized_numeric: null },
];
const AFFILIATES_FIELDS = [
  { field_code: "PRINCIPAL_AMOUNT", raw_value: "100000.0000", normalized_numeric: "100000.0000" },
  { field_code: "FAIR_VALUE", raw_value: "50000.0000", normalized_numeric: "50000.0000" },
];

test("first-lien duplicate positions: the shared schedule row is rejected and its maturity is not assigned", () => {
  const html = debtScheduleWithAffiliatesRow();
  const rows = listIxContextRows(html);
  const scheduleOnly = bindMaturityContextRows(rows, DEBT_FIELDS, JUNE);
  assert.equal(scheduleOnly.outcome, "FILING_DISPLAYED");
  assert.equal(scheduleOnly.contextId, "c-s");
  assert.equal(scheduleOnly.rawValue, "4/13/2099");
  const affiliatesClaim = bindMaturityContextRows(rows, AFFILIATES_FIELDS, JUNE);
  assert.equal(affiliatesClaim.contextId, "c-s");
  const [debt, affiliates] = rejectSharedContextBinds([scheduleOnly, affiliatesClaim]);
  for (const bound of [debt, affiliates]) {
    assert.equal(bound.outcome, "UNKNOWN");
    assert.equal(bound.reason, "context matched more than one position");
    assert.equal(bound.contextId, null);
    assert.equal(bound.rawValue, null);
    assert.equal(bound.normalizedDate, null);
  }
});

test("a multi-context affiliates row is never a binding candidate, and its periods are exposed", () => {
  const html = debtScheduleWithAffiliatesRow();
  const rows = listIxContextRows(html);
  const affiliatesRow = rows.find((item) => item.contextIds.length > 1);
  assert.deepEqual(affiliatesRow.contextIds, ["c-a1", "c-a3", "c-a2"]);
  assert.deepEqual(affiliatesRow.contextPeriodEnds, [JUNE, MARCH, JUNE]);
  const openingOnly = bindMaturityContextRows(rows, [
    { field_code: "FAIR_VALUE", raw_value: "40000.0000", normalized_numeric: "40000.0000" },
  ], MARCH);
  assert.equal(openingOnly.outcome, "UNKNOWN");
  assert.equal(openingOnly.reason, "no context matched every comparable field");
});

test("exact Maturity and 4/13/2029 is a calendar date", () => {
  const html = `<table><tr>${td("Maturity")}</tr><tr>${td("4/13/2029")}${PRINCIPAL_FACT}</tr></table>`;
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "4/13/2029");
  assert.equal(bound.normalizedDate, "2029-04-13");
  assert.equal(bound.displayedYear, null);
  assert.equal(bound.displayedMonth, null);
});

test("Maturity/Expiration Date selects the month and Purchase Date does not", () => {
  const html = `<table><tr>${td("Purchase Date")}${td("Maturity/Expiration Date")}</tr><tr>${td("10/2023")}${td("12/2028")}${PRINCIPAL_FACT}</tr></table>`;
  const row = listed(html);
  assert.equal(placement(row, "10/2023").startColumn, row.acquisitionColumn);
  assert.equal(placement(row, "12/2028").startColumn, row.maturityColumn);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_MONTH");
  assert.equal(bound.rawValue, "12/2028");
  assert.equal(bound.normalizedDate, null);
  assert.equal(bound.displayedYear, 2028);
  assert.equal(bound.displayedMonth, 12);
  assert.deepEqual(bound.candidates, []);
});

test("Purchase Date has no numbered suffix and Maturity Date stays unrecognized", () => {
  const html = `<table><tr>${td("Purchase Date 2")}${td("Maturity Date")}</tr><tr>${td("10/2023")}${td("12/2028")}${PRINCIPAL_FACT}</tr></table>`;
  const row = listed(html);
  assert.equal(row.acquisitionColumn, null);
  assert.equal(row.maturityColumn, null);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates.map((candidate) => candidate.raw), ["10/2023", "12/2028"]);
});

test("Acquisition Date with a numbered suffix still excludes that date", () => {
  const html = `<table><tr>${td("Acquisition Date 14")}${td("Maturity")}</tr><tr>${td("4/15/2024")}${td("4/13/2029")}${PRINCIPAL_FACT}</tr></table>`;
  const row = listed(html);
  assert.equal(placement(row, "4/15/2024").startColumn, row.acquisitionColumn);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.rawValue, "4/13/2029");
  assert.equal(bound.normalizedDate, "2029-04-13");
});

test("two dates in the maturity column stay unresolved", () => {
  const html = `<table><tr>${td("Maturity/Expiration Date")}</tr><tr>${td("12/2028 11/2027")}${PRINCIPAL_FACT}</tr></table>`;
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates.map((candidate) => candidate.raw), ["12/2028", "11/2027"]);
});

test("competing maturity headers fail closed", () => {
  const html = `<table><tr>${td("Maturity")}${td("Maturity/Expiration Date")}</tr><tr>${td("4/13/2029")}${td("5/1/2030")}${PRINCIPAL_FACT}</tr></table>`;
  const row = listed(html);
  assert.equal(row.maturityColumn, null);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNRESOLVED");
  assert.equal(bound.rawValue, null);
});

test("a purchase month beside an unrecognized maturity header is not selected", () => {
  const html = `<table><tr>${td("Purchase Date")}${td("Notes")}</tr><tr>${td("10/2023")}${PRINCIPAL_FACT}</tr></table>`;
  const row = listed(html);
  assert.equal(typeof row.acquisitionColumn, "number");
  assert.equal(row.maturityColumn, null);
  const bound = bind(html, PRINCIPAL_FIELD);
  assert.equal(bound.outcome, "UNAVAILABLE");
  assert.equal(bound.rawValue, null);
  assert.deepEqual(bound.candidates, []);
});

test("the maturity and purchase headers are the norm.date_heading v1 strings", () => {
  const heading = (raw) => ({
    artifactId: 1, rowOrdinal: 1, slotOrdinal: 1, rawText: raw, matchedText: raw,
  });
  assert.equal(normalizeDateHeading([heading("Purchase Date")]).fieldCode, "ACQUISITION_DATE");
  assert.equal(normalizeDateHeading([heading("Maturity/Expiration Date")]).fieldCode, "MATURITY_DATE");
  assert.equal(normalizeDateHeading([heading("Maturity Date")]).accepted, false);
});

test("stored accession 0001976719-24-000003 selects the maturity month", (t) => {
  const sha = "310d5cfeb4464a2546ca61fe4a4c68a02f611acf91fe88571cbc646b7600767a";
  let html;
  try {
    html = createStore(DEFAULT_DATA_DIR).read(`raw/sha256/31/${sha}`, sha).toString("utf8");
  } catch {
    t.skip("stored filing artifact is not present");
    return;
  }
  const row = listIxContextRows(html).find((item) => item.contextIds.length === 1 && item.contextIds[0] === "c-16");
  assert.ok(row);
  assert.equal(row.datePlacements.find((item) => item.startColumn === row.acquisitionColumn)?.raw, "10/2023");
  assert.equal(row.datePlacements.find((item) => item.startColumn === row.maturityColumn)?.raw, "12/2028");
  const fact = row.facts.find((item) => item.name.endsWith(":InvestmentInterestRate"));
  assert.ok(fact);
  const scale = Number(fact.scale ?? "0");
  const [whole, fraction = ""] = fact.text.replace(/,/g, "").split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const exponent = fraction.length - scale;
  const raw = exponent === 0 ? digits : `0.${"0".repeat(exponent - digits.length)}${digits}`;
  const bound = bindMaturityContextRows([row], [{ field_code: "INTEREST_RATE", raw_value: raw }], row.contextPeriodEnds[0]);
  assert.equal(bound.outcome, "FILING_MONTH");
  assert.equal(bound.rawValue, "12/2028");
  assert.equal(bound.normalizedDate, null);
  assert.equal(bound.displayedYear, 2028);
  assert.equal(bound.displayedMonth, 12);
  assert.notEqual(bound.rawValue, "10/2023");
});

const STORED_ACQUISITION = { field_code: "ACQUISITION_DATE", raw_value: "04/2099", normalized_numeric: null };
const PRINCIPAL_WITH_ACQUISITION = [
  { field_code: "PRINCIPAL_AMOUNT", raw_value: "100000.0000", normalized_numeric: "100000.0000" },
  STORED_ACQUISITION,
];

function principalRow(contextId, factId, extraFacts = [], cells = "") {
  return row(contextId, [
    { id: factId, name: "InvestmentOwnedBalancePrincipalAmount", scale: "3", text: "100" },
    ...extraFacts,
  ], cells);
}

function acquisitionNames(bound) {
  return bound.facts.filter((fact) => String(fact.name).endsWith("InvestmentAcquisitionDate")).map((fact) => fact.id);
}

test("a missing InvestmentAcquisitionDate fact does not reject a unique principal match", () => {
  const html = `<table><tr>${td("Purchase Date")}${td("Maturity")}</tr>${principalRow("c-1", "f-p", [], `${td("04/2099")}${td("12/2099")}`)}</table>`;
  const bound = bind(html, PRINCIPAL_WITH_ACQUISITION);
  assert.equal(bound.outcome, "FILING_MONTH");
  assert.equal(bound.contextId, "c-1");
  assert.equal(bound.rawValue, "12/2099");
  assert.equal(bound.displayedYear, 2099);
  assert.equal(bound.displayedMonth, 12);
  assert.deepEqual(bound.facts.map((fact) => fact.id), ["f-p"]);
  assert.deepEqual(acquisitionNames(bound), []);
});

test("a matching InvestmentAcquisitionDate fact still binds", () => {
  const html = `<table><tr>${td("Maturity")}</tr>${principalRow("c-1", "f-p", [
    { id: "f-a", name: "InvestmentAcquisitionDate", text: "04/2099" },
  ], td("12/2099"))}</table>`;
  const bound = bind(html, PRINCIPAL_WITH_ACQUISITION);
  assert.equal(bound.outcome, "FILING_MONTH");
  assert.equal(bound.contextId, "c-1");
  assert.deepEqual(acquisitionNames(bound), ["f-a"]);
});

test("a different InvestmentAcquisitionDate fact rejects the candidate", () => {
  const html = `<table>${principalRow("c-1", "f-p", [
    { id: "f-a", name: "InvestmentAcquisitionDate", text: "05/2099" },
  ])}</table>`;
  const bound = bind(html, PRINCIPAL_WITH_ACQUISITION);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.noBindReason, NO_BIND_REASON.NO_MATCH);
  assert.equal(bound.contextId, null);
  assert.deepEqual(bound.facts, []);
});

test("untagged Purchase Date text is not an acquisition-date fact", () => {
  const html = `<table><tr>${td("Purchase Date")}${td("Maturity")}</tr>${principalRow("c-1", "f-p", [], `${td("05/2099")}${td("12/2099")}`)}</table>`;
  const bound = bind(html, PRINCIPAL_WITH_ACQUISITION);
  assert.equal(bound.outcome, "FILING_MONTH");
  assert.equal(bound.rawValue, "12/2099");
  assert.notEqual(bound.rawValue, "05/2099");
  assert.deepEqual(acquisitionNames(bound), []);
});

test("a different context instant is rejected when acquisition date is absent", () => {
  const html = `<table>${principalRow("c-mar", "f-m", [], "<td>2/4/2099</td>")}${principalRow("c-jun", "f-j", [], "<td>2/4/2099</td>")}</table>`;
  const bound = bind(html, PRINCIPAL_WITH_ACQUISITION, MARCH, { "c-mar": MARCH, "c-jun": JUNE });
  assert.equal(bound.outcome, "FILING_DISPLAYED");
  assert.equal(bound.contextId, "c-mar");
  assert.equal(bound.normalizedDate, "2099-02-04");
  assert.deepEqual(bound.facts.map((fact) => fact.id), ["f-m"]);
});

test("two rows that still match after skipping acquisition date stay unresolved", () => {
  const html = `<table>${principalRow("c-1", "f-1")}${principalRow("c-2", "f-2")}</table>`;
  const bound = bind(html, PRINCIPAL_WITH_ACQUISITION);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.noBindReason, NO_BIND_REASON.MULTIPLE_ROWS);
  assert.equal(bound.reason, "more than one context matched");
  assert.equal(bound.contextId, null);
  assert.deepEqual(bound.contextIds, ["c-1", "c-2"]);
  assert.equal(bound.rawValue ?? null, null);
});

test("a missing principal fact still rejects the row when acquisition date is absent", () => {
  const html = `<table>${row("c-1", [
    { id: "f-r", name: "InvestmentInterestRate", scale: "-2", text: "8.44" },
  ])}</table>`;
  const bound = bind(html, [
    { field_code: "PRINCIPAL_AMOUNT", raw_value: "100000.0000", normalized_numeric: "100000.0000" },
    { field_code: "INTEREST_RATE", raw_value: "0.0844", normalized_numeric: null },
    STORED_ACQUISITION,
  ]);
  assert.equal(bound.outcome, "UNKNOWN");
  assert.equal(bound.noBindReason, NO_BIND_REASON.NO_MATCH);
  assert.equal(bound.contextId, null);
});

test("maturity bind rule version 4 is separate from the stored version 3 definition", () => {
  assert.equal(RULE_VERSION, "4");
  assert.match(RULE_TEXT_VERSION_3, /^pipeline\.maturity_context_bind version 3\n/);
  assert.equal(RULE_TEXT_VERSION_3.includes("no InvestmentAcquisitionDate fact"), false);
  assert.match(RULE_TEXT, /^pipeline\.maturity_context_bind version 4\n/);
  assert.match(RULE_TEXT, /except a stored ACQUISITION_DATE on a context that has no InvestmentAcquisitionDate fact/);
  assert.match(RULE_TEXT, /untagged Purchase Date text is not used/);
  assert.equal(RULE_TEXT.includes("A context row is eligible only when its context period end"), true);
});

test("a zero-value warrant keeps acquisition date and expiration prose out of maturity", () => {
  const html = `<table>${equityHeader()}${equityRow("c-w", "w", {
    type: "Warrants (Expiration - January 17, 2099)",
    acquired: "1/17/2098",
  })}</table>`;
  const bound = bind(html, ZERO_FV_EQUITY_FIELDS, MARCH, { "c-w": MARCH });
  assert.equal(bound.outcome, "UNAVAILABLE");
  assert.equal(bound.contextId, "c-w");
  assert.equal(bound.rawValue, null);
  assert.equal(bound.normalizedDate, null);
  assert.deepEqual(bound.candidates, []);
});
