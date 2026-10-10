import test from "node:test";
import assert from "node:assert/strict";
import {
  planUniqueDateBatches,
  selectBoundedEligibleObservations,
  selectUniqueDateEligibleObservations,
} from "../load/eligible-instrument-scope.mjs";

function row(overrides) {
  return {
    id: 1,
    identifierRaw: "TEST ISSUER A",
    instrumentType: "TEST FIRST LIEN",
    reportedDate: "2099-03-31",
    registrantId: 10,
    registrantLinkStatus: "LINKED",
    typeLocator: "TSV_CELL",
    ...overrides,
  };
}

test("the bounded subset keeps the earliest multi-period series and every HTML type row", () => {
  const selected = selectBoundedEligibleObservations([
    row({ id: 30, reportedDate: "2099-06-30" }),
    row({ id: 10, reportedDate: "2099-03-31" }),
    row({ id: 40, identifierRaw: "TEST ISSUER B", reportedDate: "2099-03-31" }),
    row({ id: 50, identifierRaw: "TEST ISSUER B", reportedDate: "2099-06-30" }),
    row({
      id: 5,
      identifierRaw: "TEST HTML ISSUER",
      instrumentType: "TEST SECOND LIEN",
      reportedDate: "2099-09-30",
      registrantId: 99,
      typeLocator: "HTML_TABLE_CELL",
    }),
    row({ id: 70, identifierRaw: "TEST SINGLE", reportedDate: "2099-12-31" }),
  ]);
  assert.deepEqual(selected.map((item) => item.id), [5, 10, 30]);
});

test("a date with two observations is not the continuity series", () => {
  const selected = selectBoundedEligibleObservations([
    row({ id: 1, reportedDate: "2099-03-31" }),
    row({ id: 2, reportedDate: "2099-03-31" }),
    row({ id: 3, reportedDate: "2099-06-30" }),
    row({ id: 8, identifierRaw: "TEST ISSUER B", reportedDate: "2099-03-31" }),
    row({ id: 9, identifierRaw: "TEST ISSUER B", reportedDate: "2099-06-30" }),
  ]);
  assert.deepEqual(selected.map((item) => item.id), [8, 9]);
});

test("an unlinked registrant is not used as the continuity series", () => {
  const selected = selectBoundedEligibleObservations([
    row({ id: 1, registrantLinkStatus: "UNKNOWN", reportedDate: "2099-03-31" }),
    row({ id: 2, registrantLinkStatus: "UNKNOWN", reportedDate: "2099-06-30" }),
    row({ id: 4, identifierRaw: "TEST HTML ISSUER", typeLocator: "HTML_TABLE_CELL" }),
  ]);
  assert.deepEqual(selected.map((item) => item.id), [4]);
});

test("a unique-date series is eligible and a repeated reporting date is not", () => {
  const selected = selectUniqueDateEligibleObservations([
    row({ id: 3, reportedDate: "2099-06-30" }),
    row({ id: 1, reportedDate: "2099-03-31" }),
    row({ id: 4, identifierRaw: "TEST ISSUER B", reportedDate: "2099-03-31" }),
    row({ id: 5, identifierRaw: "TEST ISSUER B", reportedDate: "2099-03-31" }),
    row({ id: 6, identifierRaw: "TEST ISSUER B", instrumentType: "TEST SECOND LIEN", reportedDate: "2099-03-31" }),
    row({ id: 7, registrantId: 11, reportedDate: "2099-03-31" }),
    row({ id: 8, registrantLinkStatus: "UNKNOWN", reportedDate: "2099-09-30" }),
  ]);
  assert.deepEqual(selected.map((item) => item.id), [1, 3, 6, 7]);
});

test("unique-date batches follow exact identifier text and keep a decided sibling", () => {
  const rows = [
    row({ id: 20, identifierRaw: "TEST ISSUER B", reportedDate: "2099-06-30" }),
    row({ id: 4, reportedDate: "2099-06-30" }),
    row({ id: 2, reportedDate: "2099-03-31" }),
    row({ id: 30, identifierRaw: "TEST ISSUER A HOLDINGS", reportedDate: "2099-03-31" }),
    row({ id: 9, identifierRaw: "TEST ISSUER B", instrumentType: "TEST SECOND LIEN", reportedDate: "2099-03-31" }),
  ];
  const planned = planUniqueDateBatches(rows, { alreadyDecidedIds: [2], limit: 1 });
  assert.equal(planned.length, 1);
  assert.deepEqual(planned[0].map((item) => item.id), [2, 4]);
  assert.deepEqual(planned[0].map((item) => item.instrumentType), ["TEST FIRST LIEN", "TEST FIRST LIEN"]);
  const rest = planUniqueDateBatches(rows, { alreadyDecidedIds: [2, 4] });
  assert.deepEqual(rest.map((group) => group.map((item) => item.id)), [[9, 20], [30]]);
});

test("a repeated date does not become a continuity batch", () => {
  const planned = planUniqueDateBatches([
    row({ id: 1, reportedDate: "2099-03-31" }),
    row({ id: 2, reportedDate: "2099-03-31" }),
  ]);
  assert.deepEqual(planned, []);
});

test("same-date rows stay unresolved when only the row order differs", () => {
  const planned = planUniqueDateBatches([
    row({ id: 2, reportedDate: "2099-03-31" }),
    row({ id: 1, reportedDate: "2099-03-31" }),
    row({ id: 3, identifierRaw: "TEST ISSUER B", instrumentType: "TEST SECOND LIEN", reportedDate: "2099-03-31" }),
    row({ id: 4, identifierRaw: "TEST ISSUER B", instrumentType: "TEST SECOND LIEN", reportedDate: "2099-06-30" }),
  ]);
  assert.deepEqual(planned.map((group) => group.map((item) => item.id)), [[3, 4]]);
  assert.deepEqual([...new Set(planned.flat().map((item) => item.instrumentType))], ["TEST SECOND LIEN"]);
});

test("a duplicate-date Investments identifier is not selected", () => {
  const planned = planUniqueDateBatches([
    row({ id: 1, identifierRaw: "Investments", reportedDate: "2099-03-31" }),
    row({ id: 2, identifierRaw: "Investments", reportedDate: "2099-03-31" }),
  ]);
  assert.deepEqual(planned, []);
});

test("a decided one-row-per-date series is not planned again", () => {
  const rows = [
    row({ id: 10, reportedDate: "2099-03-31" }),
    row({ id: 11, reportedDate: "2099-06-30" }),
  ];
  assert.deepEqual(planUniqueDateBatches(rows, { alreadyDecidedIds: [10, 11] }), []);
  assert.deepEqual(selectUniqueDateEligibleObservations(rows).map((item) => item.id), [10, 11]);
});

test("an HTML row that is also in the series is kept once", () => {
  const selected = selectBoundedEligibleObservations([
    row({ id: 2, reportedDate: "2099-06-30", typeLocator: "HTML_TABLE_CELL" }),
    row({ id: 1, reportedDate: "2099-03-31", typeLocator: "HTML_TABLE_CELL" }),
  ]);
  assert.deepEqual(selected.map((item) => item.id), [1, 2]);
});
