import test from "node:test";
import assert from "node:assert/strict";
import { selectBoundedEligibleObservations } from "../load/eligible-instrument-scope.mjs";

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

test("an HTML row that is also in the series is kept once", () => {
  const selected = selectBoundedEligibleObservations([
    row({ id: 2, reportedDate: "2099-06-30", typeLocator: "HTML_TABLE_CELL" }),
    row({ id: 1, reportedDate: "2099-03-31", typeLocator: "HTML_TABLE_CELL" }),
  ]);
  assert.deepEqual(selected.map((item) => item.id), [1, 2]);
});
