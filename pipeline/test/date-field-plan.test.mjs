import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { planVerifiedDates, stackedDayMaturityWrite, summarizeDatePlan } from "../normalize/date-field-plan.mjs";
import { dryRunVerifiedDates, loadDateArtifactHtml, VERIFIED_DATE_BINDINGS } from "../load/date-heading-dry-run.mjs";
import { DATE_HEADING_CODE, DATE_HEADING_VERSION } from "../normalize/date-heading.mjs";
import { RULES, ruleDefinitionSha } from "../load/rules.mjs";

const PERIOD = "2099-09-30";
const OTHER_PERIOD = "2099-12-31";

function context(id, period) {
  return `<xbrli:context id="${id}"><xbrli:period><xbrli:instant>${period}</xbrli:instant></xbrli:period></xbrli:context>`;
}

function td(inner, colspan = 3) {
  return `<td colspan="${colspan}">${inner}</td>`;
}

function filing(body, contexts = context("c1", PERIOD)) {
  return `${contexts}<table>${body}</table>`;
}

function purchaseBinding(overrides = {}) {
  return {
    observationId: 9001,
    artifactId: 1,
    reportedDate: PERIOD,
    valueRow: 2,
    valueSlot: 0,
    rawDate: "04/2099",
    expectedField: "ACQUISITION_DATE",
    headings: [{ row: 1, slot: 0, matchedText: "Purchase Date" }],
    ...overrides,
  };
}

function purchaseHtml() {
  return filing(
    `<tr>${td("Purchase Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1" name="us-gaap:InvestmentOwnedAtFairValue">04/2099</ix:nonFraction>')}</tr>`,
  );
}

function plan(bindings, html, artifactId = 1) {
  return planVerifiedDates(bindings, new Map([[artifactId, html]]));
}

test("a supplied Purchase Date cell becomes one month field and one heading", () => {
  const result = plan([purchaseBinding()], purchaseHtml());
  assert.equal(result.accepted, true);
  assert.equal(result.fields.length, 1);
  assert.equal(result.headings.length, 1);
  const field = result.fields[0];
  assert.equal(field.fieldCode, "ACQUISITION_DATE");
  assert.equal(field.rawValue, "04/2099");
  assert.equal(field.precision, "MONTH");
  assert.equal(field.datePrecision, "MONTH");
  assert.equal(field.normalizedYear, 2099);
  assert.equal(field.normalizedMonth, 4);
  assert.equal(field.normalizedDate, null);
  assert.equal(result.headings[0].rawText, "Purchase Date");
  assert.equal(result.headings[0].matchedText, "Purchase Date");
  assert.equal(Object.hasOwn(result.headings[0], "fieldCode"), false);
});

test("two value rows reuse one heading", () => {
  const html = filing(
    `<tr>${td("Acquisition Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">05/2099</ix:nonFraction>')}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">05/2099</ix:nonFraction>')}</tr>`,
  );
  const heading = [{ row: 1, slot: 0, matchedText: "Acquisition Date" }];
  const result = plan([
    purchaseBinding({ observationId: 9001, valueRow: 2, rawDate: "05/2099", headings: heading }),
    purchaseBinding({ observationId: 9002, valueRow: 3, rawDate: "05/2099", headings: heading }),
  ], html);
  assert.equal(result.accepted, true);
  assert.equal(result.fields.length, 2);
  assert.equal(result.headings.length, 1);
  assert.equal(result.fields[0].headingKeys[0], result.fields[1].headingKeys[0]);
  assert.equal(summarizeDatePlan(result).reusedHeadings, 1);
});

test("a line break stays in the raw heading and the matched heading keeps the space", () => {
  const html = filing(
    `<tr>${td("Maturity/Expiration<br/>Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">12/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    rawDate: "12/2099",
    expectedField: "MATURITY_DATE",
    headings: [{ row: 1, slot: 0, matchedText: "Maturity/Expiration Date" }],
  })], html);
  assert.equal(result.accepted, true);
  assert.equal(result.headings[0].rawText, "Maturity/ExpirationDate");
  assert.equal(result.headings[0].matchedText, "Maturity/Expiration Date");
});

test("a Maturity cell over a Date cell is a day maturity", () => {
  const html = filing(
    `<tr>${td("Maturity")}</tr><tr>${td("Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">12/19/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    valueRow: 3,
    rawDate: "12/19/2099",
    expectedField: "MATURITY_DATE",
    headings: [
      { row: 1, slot: 0, matchedText: "Maturity" },
      { row: 2, slot: 0, matchedText: "Date" },
    ],
  })], html);
  assert.equal(result.accepted, true);
  assert.equal(result.fields[0].precision, "DAY");
  assert.equal(result.fields[0].datePrecision, null);
  assert.equal(result.fields[0].normalizedYear, null);
  assert.equal(result.fields[0].normalizedMonth, null);
  assert.equal(result.fields[0].normalizedDate, "2099-12-19");
  assert.equal(result.headings.length, 2);
  assert.equal(result.headings[1].stackAboveKey, result.headings[0].key);
});

test("a Maturity over Date stack is one day write bound to the lower heading", () => {
  const html = filing(
    `<tr>${td("Maturity")}</tr><tr>${td("Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">12/19/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    valueRow: 3,
    rawDate: "12/19/2099",
    expectedField: "MATURITY_DATE",
    headings: [
      { row: 1, slot: 0, matchedText: "Maturity" },
      { row: 2, slot: 0, matchedText: "Date" },
    ],
  })], html);
  const write = stackedDayMaturityWrite(result);
  assert.equal(write.headings[0].rawText, "Maturity");
  assert.equal(write.headings[0].stackAboveKey, null);
  assert.equal(write.headings[1].rawText, "Date");
  assert.equal(write.headings[1].stackAboveKey, write.headings[0].key);
  assert.equal(write.cell.headingKey, write.headings[1].key);
  assert.equal(write.cell.rowOrdinal, 3);
  assert.equal(write.field.rawValue, "12/19/2099");
  assert.equal(write.field.datePrecision, null);
  assert.equal(write.field.normalizedYear, null);
  assert.equal(write.field.normalizedMonth, null);
  assert.equal(write.field.normalizedDate, "2099-12-19");
  assert.throws(() => stackedDayMaturityWrite(plan([purchaseBinding()], purchaseHtml())), /one field and two headings/);
  const shifted = structuredClone(result);
  shifted.fields[0].normalizedDate = "2099-12-01";
  assert.throws(() => stackedDayMaturityWrite(shifted), /raw day does not match/);
});

test("generic Date without Maturity is rejected", () => {
  const html = filing(
    `<tr>${td("Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">12/19/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    rawDate: "12/19/2099",
    expectedField: "MATURITY_DATE",
    headings: [{ row: 1, slot: 0, matchedText: "Date" }],
  })], html);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "generic Date");
});

test("a missing heading is rejected", () => {
  const result = plan([purchaseBinding({ headings: [] })], purchaseHtml());
  assert.equal(result.reason, "missing heading");
});

test("an artifact with no stored HTML is rejected", () => {
  const result = planVerifiedDates([purchaseBinding({ artifactId: 2 })], new Map([[1, purchaseHtml()]]));
  assert.equal(result.reason, "wrong artifact");
});

test("a different artifact's HTML cannot satisfy the binding", () => {
  const other = filing(`<tr>${td("Other")}</tr><tr>${td("Other")}</tr>`);
  const result = plan([purchaseBinding()], other);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "value cell text does not match");
});

test("the wrong slot is rejected", () => {
  const result = plan([purchaseBinding({ valueSlot: 9, headings: [{ row: 1, slot: 9, matchedText: "Purchase Date" }] })], purchaseHtml());
  assert.equal(result.reason, "wrong slot");
});

test("the wrong value row is rejected", () => {
  const result = plan([purchaseBinding({ valueRow: 9 })], purchaseHtml());
  assert.equal(result.reason, "wrong value row");
});

test("a later heading is rejected", () => {
  const result = plan([purchaseBinding({
    valueRow: 2,
    headings: [{ row: 4, slot: 0, matchedText: "Purchase Date" }],
  })], purchaseHtml());
  assert.equal(result.reason, "later heading");
});

test("a heading on the value row is rejected", () => {
  const result = plan([purchaseBinding({
    headings: [{ row: 2, slot: 0, matchedText: "Purchase Date" }],
  })], purchaseHtml());
  assert.equal(result.reason, "same-row heading");
});

test("a nonconsecutive Maturity and Date stack is rejected", () => {
  const html = filing(
    `<tr>${td("Maturity")}</tr><tr>${td("Interest")}</tr><tr>${td("Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">12/19/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    valueRow: 4,
    rawDate: "12/19/2099",
    expectedField: "MATURITY_DATE",
    headings: [
      { row: 1, slot: 0, matchedText: "Maturity" },
      { row: 3, slot: 0, matchedText: "Date" },
    ],
  })], html);
  assert.equal(result.reason, "ambiguous Maturity/Date stack");
});

test("a sibling row's date cannot be used as the heading", () => {
  const html = filing(
    `<tr>${td("08/2099")}</tr>`
    + `<tr>${td("Purchase Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">04/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    valueRow: 3,
    headings: [{ row: 1, slot: 0, matchedText: "08/2099" }],
  })], html);
  assert.equal(result.reason, "sibling-row date copy");
});

test("the same value cell cannot be planned for a second observation", () => {
  const result = plan([
    purchaseBinding(),
    purchaseBinding({ observationId: 9002 }),
  ], purchaseHtml());
  assert.equal(result.reason, "sibling-row date copy");
});

test("Purchase Date is not stored as maturity", () => {
  const result = plan([purchaseBinding({ expectedField: "MATURITY_DATE" })], purchaseHtml());
  assert.equal(result.reason, "semantic field does not match the heading");
});

test("Acquisition Date is not stored as maturity", () => {
  const html = filing(
    `<tr>${td("Acquisition Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">05/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    rawDate: "05/2099",
    expectedField: "MATURITY_DATE",
    headings: [{ row: 1, slot: 0, matchedText: "Acquisition Date" }],
  })], html);
  assert.equal(result.reason, "semantic field does not match the heading");
});

test("a month value is not stored as the first day", () => {
  const result = plan([purchaseBinding({ requestedStorage: { normalizedDate: "2099-04-01" } })], purchaseHtml());
  assert.equal(result.reason, "month/year converted to a day");
  assert.equal(result.fields.length, 0);
});

test("a month value is not stored as the month end", () => {
  const result = plan([purchaseBinding({ requestedStorage: { normalizedDate: "2099-04-30" } })], purchaseHtml());
  assert.equal(result.reason, "month/year converted to a day");
});

test("a disclosed day is not stored as MONTH", () => {
  const html = filing(
    `<tr>${td("Maturity")}</tr><tr>${td("Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">12/19/2099</ix:nonFraction>')}</tr>`,
  );
  const result = plan([purchaseBinding({
    valueRow: 3,
    rawDate: "12/19/2099",
    expectedField: "MATURITY_DATE",
    headings: [
      { row: 1, slot: 0, matchedText: "Maturity" },
      { row: 2, slot: 0, matchedText: "Date" },
    ],
    requestedStorage: { precision: "MONTH" },
  })], html);
  assert.equal(result.reason, "day value cannot be stored as MONTH");
});

test("a different reported period is rejected", () => {
  const result = plan([purchaseBinding({ reportedDate: OTHER_PERIOD })], purchaseHtml());
  assert.equal(result.reason, "cross-period");
});

test("the planner does not trim a trailing-space identifier", () => {
  const html = `<xbrli:context id="c1"><xbrli:entity><xbrli:segment>`
    + `<xbrldi:typedMember dimension="us-gaap:InvestmentIdentifierAxis">`
    + `<us-gaap:InvestmentIdentifierAxis.domain>TEST HOLDING </us-gaap:InvestmentIdentifierAxis.domain>`
    + `</xbrldi:typedMember></xbrli:segment></xbrli:entity>`
    + `<xbrli:period><xbrli:instant>${PERIOD}</xbrli:instant></xbrli:period></xbrli:context>`
    + `<table><tr>${td("Purchase Date")}</tr>`
    + `<tr>${td('<ix:nonFraction contextRef="c1">04/2099</ix:nonFraction>')}</tr></table>`;
  const result = plan([purchaseBinding()], html);
  assert.equal(result.accepted, true);
  assert.equal(result.fields[0].rawValue, "04/2099");
  assert.match(html, /TEST HOLDING /);
  const source = readFileSync(new URL("../normalize/date-field-plan.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("holding_descriptor"), false);
  assert.equal(source.includes("domain.trim"), false);
});

test("the dry-run modules do not open a database", () => {
  const planner = readFileSync(new URL("../normalize/date-field-plan.mjs", import.meta.url), "utf8");
  const runner = readFileSync(new URL("../load/date-heading-dry-run.mjs", import.meta.url), "utf8");
  assert.equal(planner.includes("db.mjs"), false);
  assert.equal(runner.includes("db.mjs"), false);
  assert.equal(runner.includes("INSERT"), false);
});

test("norm.date_heading stays version 1", () => {
  const rule = RULES.find((item) => item.code === DATE_HEADING_CODE && item.version === DATE_HEADING_VERSION);
  assert.ok(rule);
  assert.deepEqual(rule.files, ["pipeline/normalize/date-heading.mjs"]);
  assert.equal(ruleDefinitionSha(rule), "415bb04d9f257d5d2f1ccc40732b27a93941a3d99d0155ae2258a0e36e15dadc");
});

test("the verified local filings produce 26 date plans and reuse four headings", (t) => {
  const sample = ".data/sec/raw/sha256/e0/e0c6e1728e2ef4bc1f0bea545fab669d4a9f96a826cfcffc74c997f37d594f32";
  if (!existsSync(sample)) {
    t.skip("stored filing bytes are not present");
    return;
  }
  const result = dryRunVerifiedDates();
  const summary = summarizeDatePlan(result);
  assert.equal(result.accepted, true);
  assert.equal(summary.fields, 26);
  assert.equal(summary.acquisition, 10);
  assert.equal(summary.maturity, 16);
  assert.equal(summary.month, 20);
  assert.equal(summary.day, 6);
  assert.equal(summary.nullNormalizedDate, 20);
  assert.deepEqual(summary.dayNormalizedDate, Array(6).fill("2025-12-19"));
  assert.equal(summary.valueCells, 26);
  assert.equal(summary.headings, 28);
  assert.equal(summary.headingCitations, 32);
  assert.equal(summary.reusedHeadings, 4);
  const current = result.fields.find((field) => field.observationId === 1146286 && field.fieldCode === "MATURITY_DATE");
  const comparative = result.fields.find((field) => field.observationId === 1146289 && field.fieldCode === "MATURITY_DATE");
  assert.equal(current.rawValue, "12/2028");
  assert.equal(current.valueRow, 535);
  assert.equal(current.normalizedYear, 2028);
  assert.equal(current.normalizedDate, null);
  assert.equal(comparative.rawValue, "12/2025");
  assert.equal(comparative.valueRow, 1373);
  assert.equal(comparative.normalizedYear, 2025);
  assert.notEqual(current.headingKeys[0], comparative.headingKeys[0]);
  const broken = result.headings.find((heading) => heading.key === "364:366:36");
  assert.equal(broken.rawText, "Maturity/ExpirationDate");
  assert.equal(broken.matchedText, "Maturity/Expiration Date");
  for (const field of result.fields) {
    if (field.precision === "MONTH") {
      assert.equal(field.normalizedDate, null);
      assert.equal(field.datePrecision, "MONTH");
    } else {
      assert.equal(field.precision, "DAY");
      assert.equal(field.datePrecision, null);
      assert.equal(field.normalizedDate, "2025-12-19");
    }
  }
});

test("observation 1146289 cannot take observation 1146286's row", (t) => {
  if (!existsSync(".data/sec/raw/sha256/11/1198e53d4e4112e184f81b370b72d069d78995cd9c443c2e6b9dcf69819ad0c5")) {
    t.skip("stored filing bytes are not present");
    return;
  }
  const current = VERIFIED_DATE_BINDINGS.find((binding) => binding.observationId === 1146286 && binding.valueSlot === 36);
  const replaced = { ...current, observationId: 1146289, reportedDate: "2022-12-31" };
  const result = planVerifiedDates([replaced], loadDateArtifactHtml());
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "cross-period");
  assert.equal(result.observationId, 1146289);
});

test("observation 1146286 cannot take observation 1146289's row", (t) => {
  if (!existsSync(".data/sec/raw/sha256/11/1198e53d4e4112e184f81b370b72d069d78995cd9c443c2e6b9dcf69819ad0c5")) {
    t.skip("stored filing bytes are not present");
    return;
  }
  const comparative = VERIFIED_DATE_BINDINGS.find((binding) => binding.observationId === 1146289 && binding.valueSlot === 36);
  const replaced = { ...comparative, observationId: 1146286, reportedDate: "2023-12-31" };
  const result = planVerifiedDates([replaced], loadDateArtifactHtml());
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "cross-period");
  assert.equal(result.observationId, 1146286);
});
