import test from "node:test";
import assert from "node:assert/strict";
import {
  canMatchInstrument, instrumentKey, continuityGaps, addMonthsMonthEnd, observationCount,
  INSTRUMENT_MATCH_METHOD, INSTRUMENT_UNRESOLVED_METHOD, CONTINUITY_MATCH_METHOD,
} from "../normalize/instrument-identity.mjs";

test("MATCHED instrument requires exact identifier and a disclosed type", () => {
  assert.equal(canMatchInstrument({
    identifierNorm: "TEST BORROWER A | TEST LOAN 1",
    typeState: "REPORTED",
    typeText: "TEST FIRST LIEN",
  }), true);
  assert.equal(canMatchInstrument({
    identifierNorm: "TEST BORROWER A | TEST LOAN 1",
    typeState: "UNKNOWN",
    typeText: null,
  }), false);
  assert.equal(canMatchInstrument({
    identifierNorm: "TEST BORROWER A | TEST LOAN 1",
    typeState: "REPORTED",
    typeText: "",
  }), false);
  assert.equal(canMatchInstrument({
    identifierNorm: "",
    typeState: "REPORTED",
    typeText: "TEST FIRST LIEN",
  }), false);
});

test("same borrower with a different identifier is a different instrument key", () => {
  const a = instrumentKey("TEST BORROWER A | TEST LOAN 1", "TEST FIRST LIEN");
  const b = instrumentKey("TEST BORROWER A | TEST LOAN 2", "TEST SECOND LIEN");
  const sameLoanOtherType = instrumentKey("TEST BORROWER A | TEST LOAN 1", "TEST SECOND LIEN");
  assert.notEqual(a, b);
  assert.notEqual(a, sameLoanOtherType);
  assert.equal(instrumentKey("TEST BORROWER A | TEST LOAN 1", "TEST FIRST LIEN"), a);
});

test("missing interior quarter is a gap, not a zero observation count", () => {
  const gaps = continuityGaps(["2099-03-31", "2099-09-30"]);
  assert.deepEqual(gaps.missing, ["2099-06-30"]);
  assert.equal(observationCount(0), 0);
  assert.equal(gaps.missing.includes("2099-06-30"), true);
});

test("quarter step uses month-end dates", () => {
  assert.equal(addMonthsMonthEnd("2099-03-31", 3), "2099-06-30");
  assert.equal(addMonthsMonthEnd("2099-12-31", 3), "2100-03-31");
});

test("method names used for MATCHED stay distinct from unresolved and have no fuzzy/LLM", () => {
  assert.equal(INSTRUMENT_MATCH_METHOD, "EXACT_IDENTIFIER_AND_TYPE");
  assert.equal(CONTINUITY_MATCH_METHOD, "SAME_REGISTRANT_AND_INSTRUMENT");
  assert.equal(INSTRUMENT_UNRESOLVED_METHOD, "UNKNOWN_INSTRUMENT_ATTRIBUTES");
  assert.equal(/fuzzy|llm/i.test(INSTRUMENT_MATCH_METHOD), false);
  assert.equal(/fuzzy|llm/i.test(CONTINUITY_MATCH_METHOD), false);
});
