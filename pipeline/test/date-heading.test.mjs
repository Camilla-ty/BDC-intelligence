import test from "node:test";
import assert from "node:assert/strict";
import { acceptDateCell, bindObservationDate, normalizeDateHeading, normalizeDisclosedDate } from "../normalize/date-heading.mjs";

const ARTIFACT = "TEST-ONLY-ARTIFACT-2099";
const OTHER = "TEST-ONLY-OTHER-ARTIFACT-2099";

function heading(matchedText, rowOrdinal, extras = {}) {
  return {
    artifactId: ARTIFACT,
    rowOrdinal,
    slotOrdinal: 18,
    rawText: matchedText,
    matchedText,
    ...extras,
  };
}

function value(rowOrdinal = 40) {
  return { artifactId: ARTIFACT, rowOrdinal, slotOrdinal: 18 };
}

test("Purchase Date maps to ACQUISITION_DATE and keeps the raw heading", () => {
  const decision = acceptDateCell(value(), [heading("Purchase Date", 10)]);
  assert.equal(decision.accepted, true);
  assert.equal(decision.fieldCode, "ACQUISITION_DATE");
  assert.deepEqual(decision.rawHeadings, ["Purchase Date"]);
  assert.equal(decision.rawHeadings[0] === decision.fieldCode, false);
});

test("Acquisition Date maps to the same canonical field and stays a distinct heading", () => {
  const purchase = acceptDateCell(value(), [heading("Purchase Date", 10)]);
  const acquisition = acceptDateCell(value(), [heading("Acquisition Date", 10)]);
  assert.equal(purchase.fieldCode, "ACQUISITION_DATE");
  assert.equal(acquisition.fieldCode, "ACQUISITION_DATE");
  assert.notEqual(purchase.rawHeadings[0], acquisition.rawHeadings[0]);
});

test("Maturity/Expiration Date maps to MATURITY_DATE", () => {
  const raw = "Maturity/ExpirationDate";
  const decision = acceptDateCell(value(), [heading("Maturity/Expiration Date", 10, { rawText: raw })]);
  assert.equal(decision.accepted, true);
  assert.equal(decision.fieldCode, "MATURITY_DATE");
  assert.deepEqual(decision.rawHeadings, [raw]);
  assert.deepEqual(decision.matchedHeadings, ["Maturity/Expiration Date"]);
});

test("a Maturity cell stacked over a Date cell maps to MATURITY_DATE", () => {
  const decision = acceptDateCell(value(30), [heading("Date", 12), heading("Maturity", 11)]);
  assert.equal(decision.accepted, true);
  assert.equal(decision.fieldCode, "MATURITY_DATE");
  assert.deepEqual(decision.rawHeadings, ["Maturity", "Date"]);
  assert.deepEqual(decision.matchedHeadings, ["Maturity", "Date"]);
});

test("a generic Date heading is rejected", () => {
  const decision = acceptDateCell(value(), [heading("Date", 10)]);
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, "generic Date");
  assert.equal(decision.fieldCode, null);
});

test("a missing heading is rejected", () => {
  assert.equal(acceptDateCell(value(), []).accepted, false);
  assert.equal(normalizeDateHeading([heading("Purchase Date", 10, { rawText: "" })]).reason, "missing heading");
});

test("a heading from another artifact is rejected", () => {
  const decision = acceptDateCell(value(), [heading("Purchase Date", 10, { artifactId: OTHER })]);
  assert.equal(decision.accepted, false);
  assert.equal(decision.reason, "heading from another artifact");
});

test("a heading taken from the value row or a later row is rejected", () => {
  assert.equal(acceptDateCell(value(40), [heading("Purchase Date", 40)]).reason, "sibling-row inference");
  assert.equal(acceptDateCell(value(40), [heading("Purchase Date", 41)]).reason, "sibling-row inference");
});

test("month/year stays month precision and does not invent a day", () => {
  const month = normalizeDisclosedDate("04/2099");
  assert.equal(month.accepted, true);
  assert.equal(month.precision, "MONTH");
  assert.equal(month.year, 2099);
  assert.equal(month.month, 4);
  assert.equal(month.day, null);
  assert.equal(month.normalizedDate, null);
  assert.notEqual(month.normalizedDate, "2099-04-01");
  assert.notEqual(month.normalizedDate, "2099-04-30");
});

test("a disclosed day stays a day and a month text is not given one", () => {
  const day = normalizeDisclosedDate("12/19/2099");
  assert.equal(day.precision, "DAY");
  assert.equal(day.day, 19);
  assert.equal(day.normalizedDate, "2099-12-19");
  const month = normalizeDisclosedDate("12/2099");
  assert.equal(month.precision, "MONTH");
  assert.equal(month.normalizedDate, null);
});

test("two observations keep their own month values", () => {
  const current = bindObservationDate("TEST-CURRENT-2099", "12/2098");
  const comparative = bindObservationDate("TEST-COMPARATIVE-2099", "12/2095");
  assert.equal(current.precision, "MONTH");
  assert.equal(comparative.precision, "MONTH");
  assert.equal(current.year, 2098);
  assert.equal(comparative.year, 2095);
  assert.notEqual(current.observationId, comparative.observationId);
  assert.notEqual(current.raw, comparative.raw);
  assert.equal(current.normalizedDate, null);
  assert.equal(comparative.normalizedDate, null);
});

test("the canonical field is rule output and the heading text is unchanged", () => {
  const source = heading("Purchase Date", 10);
  const before = source.rawText;
  const decision = normalizeDateHeading([source]);
  assert.equal(source.rawText, before);
  assert.equal(Object.hasOwn(source, "fieldCode"), false);
  assert.equal(decision.fieldCode, "ACQUISITION_DATE");
  assert.equal(decision.rawHeadings[0], "Purchase Date");
});
