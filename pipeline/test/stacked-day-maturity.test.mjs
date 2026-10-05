import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { planVerifiedDates, stackedDayMaturityWrite } from "../normalize/date-field-plan.mjs";

const PERIOD = "2099-09-30";
const UPPER_ROW = 1360;
const LOWER_ROW = 1361;
const VALUE_ROW = 1377;
const SLOT = 18;

function context(period) {
  return `<xbrli:context id="c1"><xbrli:period><xbrli:instant>${period}</xbrli:instant></xbrli:period></xbrli:context>`;
}

function cell(inner) {
  return `<td colspan="3">${inner}</td>`;
}

function rowAtSlot(inner) {
  return `<tr>${cell("TEST ONLY").repeat(6)}${cell(inner)}</tr>`;
}

function filing(raw, period = PERIOD) {
  const rows = [];
  for (let row = 1; row <= VALUE_ROW; row += 1) {
    if (row === UPPER_ROW) rows.push(rowAtSlot("Maturity"));
    else if (row === LOWER_ROW) rows.push(rowAtSlot("Date"));
    else if (row === VALUE_ROW) rows.push(rowAtSlot(`<ix:nonFraction contextRef="c1">${raw}</ix:nonFraction>`));
    else rows.push("<tr><td>TEST ONLY</td></tr>");
  }
  return `${context(period)}<table>${rows.join("")}</table>`;
}

function binding(raw, overrides = {}) {
  return {
    observationId: 9000000001,
    artifactId: 1,
    reportedDate: PERIOD,
    valueRow: VALUE_ROW,
    valueSlot: SLOT,
    rawDate: raw,
    expectedField: "MATURITY_DATE",
    headings: [
      { row: UPPER_ROW, slot: SLOT, matchedText: "Maturity" },
      { row: LOWER_ROW, slot: SLOT, matchedText: "Date" },
    ],
    ...overrides,
  };
}

function plan(raw = "12/19/2099", overrides = {}) {
  return planVerifiedDates([binding(raw, overrides)], new Map([[1, filing(raw)]]));
}

test("a Maturity over Date stack at the validated coordinates is one day maturity", () => {
  const result = plan();
  const write = stackedDayMaturityWrite(result);
  assert.equal(write.headings[0].rawText, "Maturity");
  assert.equal(write.headings[0].matchedText, "Maturity");
  assert.equal(write.headings[0].rowOrdinal, UPPER_ROW);
  assert.equal(write.headings[0].slotOrdinal, SLOT);
  assert.equal(write.headings[0].stackAboveKey, null);
  assert.equal(write.headings[1].rawText, "Date");
  assert.equal(write.headings[1].matchedText, "Date");
  assert.equal(write.headings[1].rowOrdinal, LOWER_ROW);
  assert.equal(write.headings[1].slotOrdinal, SLOT);
  assert.equal(write.headings[1].stackAboveKey, write.headings[0].key);
  assert.equal(write.cell.rowOrdinal, VALUE_ROW);
  assert.equal(write.cell.slotOrdinal, SLOT);
  assert.equal(write.cell.headingKey, write.headings[1].key);
  assert.equal(write.field.fieldCode, "MATURITY_DATE");
  assert.equal(write.field.rawValue, "12/19/2099");
  assert.equal(write.field.datePrecision, null);
  assert.equal(write.field.normalizedYear, null);
  assert.equal(write.field.normalizedMonth, null);
  assert.equal(write.field.normalizedDate, "2099-12-19");
  assert.notEqual(write.field.normalizedDate, "2099-12-01");
  assert.notEqual(write.field.normalizedDate, "2099-12-31");
});

test("a month plan is rejected by the stacked day writer", () => {
  const month = planVerifiedDates([{
    observationId: 9000000001,
    artifactId: 1,
    reportedDate: PERIOD,
    valueRow: 2,
    valueSlot: 0,
    rawDate: "04/2099",
    expectedField: "ACQUISITION_DATE",
    headings: [{ row: 1, slot: 0, matchedText: "Purchase Date" }],
  }], new Map([[1, `${context(PERIOD)}<table><tr><td colspan="3">Purchase Date</td></tr><tr><td colspan="3"><ix:nonFraction contextRef="c1">04/2099</ix:nonFraction></td></tr></table>`]]));
  assert.equal(month.accepted, true);
  assert.equal(month.fields[0].datePrecision, "MONTH");
  assert.throws(() => stackedDayMaturityWrite(month), /one field and two headings/);
});

test("a normalized day that differs from the raw day is rejected", () => {
  const shifted = structuredClone(plan());
  shifted.fields[0].normalizedDate = "2099-12-01";
  assert.throws(() => stackedDayMaturityWrite(shifted), /raw day does not match/);
  shifted.fields[0].normalizedDate = "2099-12-31";
  assert.throws(() => stackedDayMaturityWrite(shifted), /raw day does not match/);
});

test("a heading from another artifact is rejected", () => {
  const shifted = structuredClone(plan());
  shifted.headings[0].artifactId = 2;
  assert.throws(() => stackedDayMaturityWrite(shifted), /heading from another artifact/);
  assert.equal(planVerifiedDates([binding("12/19/2099", { artifactId: 2 })], new Map([[1, filing("12/19/2099")]])).reason, "wrong artifact");
});

test("a heading that is not above the value, or a Date without Maturity, is rejected", () => {
  const later = planVerifiedDates([binding("12/19/2099", {
    headings: [
      { row: VALUE_ROW, slot: SLOT, matchedText: "Maturity" },
      { row: VALUE_ROW + 1, slot: SLOT, matchedText: "Date" },
    ],
  })], new Map([[1, filing("12/19/2099")]]));
  assert.equal(later.accepted, false);
  const generic = planVerifiedDates([{
    observationId: 9000000001,
    artifactId: 1,
    reportedDate: PERIOD,
    valueRow: 2,
    valueSlot: 0,
    rawDate: "12/19/2099",
    expectedField: "MATURITY_DATE",
    headings: [{ row: 1, slot: 0, matchedText: "Date" }],
  }], new Map([[1, `${context(PERIOD)}<table><tr><td colspan="3">Date</td></tr><tr><td colspan="3"><ix:nonFraction contextRef="c1">12/19/2099</ix:nonFraction></td></tr></table>`]]));
  assert.equal(generic.accepted, false);
  assert.equal(generic.reason, "generic Date");
  assert.throws(() => stackedDayMaturityWrite(generic), /one field and two headings/);
});

test("the stored stacked day cell keeps the disclosed day", (t) => {
  const sha = "2b472c1f58a3eb6dab7fbc42e5af4cfe07ae407fee40ac1419278e0c4cacf705";
  const file = `.data/sec/raw/sha256/${sha.slice(0, 2)}/${sha}`;
  if (!existsSync(file)) {
    t.skip("stored filing bytes are not present");
    return;
  }
  const bytes = readFileSync(file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha);
  const result = planVerifiedDates([{
    observationId: 9000000002,
    artifactId: 358,
    reportedDate: "2022-09-30",
    valueRow: VALUE_ROW,
    valueSlot: SLOT,
    rawDate: "12/19/2025",
    expectedField: "MATURITY_DATE",
    headings: [
      { row: UPPER_ROW, slot: SLOT, matchedText: "Maturity" },
      { row: LOWER_ROW, slot: SLOT, matchedText: "Date" },
    ],
  }], new Map([[358, bytes.toString("utf8")]]));
  const write = stackedDayMaturityWrite(result);
  assert.equal(write.headings[0].rawText, "Maturity");
  assert.equal(write.headings[0].rowOrdinal, UPPER_ROW);
  assert.equal(write.headings[0].slotOrdinal, SLOT);
  assert.equal(write.headings[1].rawText, "Date");
  assert.equal(write.headings[1].rowOrdinal, LOWER_ROW);
  assert.equal(write.headings[1].slotOrdinal, SLOT);
  assert.equal(write.headings[1].stackAboveKey, write.headings[0].key);
  assert.equal(write.cell.headingKey, write.headings[1].key);
  assert.equal(write.cell.rowOrdinal, VALUE_ROW);
  assert.equal(write.cell.slotOrdinal, SLOT);
  assert.equal(write.field.fieldCode, "MATURITY_DATE");
  assert.equal(write.field.rawValue, "12/19/2025");
  assert.equal(write.field.datePrecision, null);
  assert.equal(write.field.normalizedDate, "2025-12-19");
  assert.notEqual(write.field.normalizedDate, "2025-12-01");
  assert.notEqual(write.field.normalizedDate, "2025-12-31");
});
