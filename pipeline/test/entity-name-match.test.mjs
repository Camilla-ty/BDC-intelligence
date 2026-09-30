import test from "node:test";
import assert from "node:assert/strict";
import {
  isExactNormalizedName, isNearNameCandidate, coreTokens, EXACT_METHOD, NEAR_NAME_METHOD,
} from "../normalize/entity-name-match.mjs";

test("exact MATCHED requires identical normalized text", () => {
  assert.equal(isExactNormalizedName("TEST BORROWER A | TEST LOAN 1", "TEST BORROWER A | TEST LOAN 1"), true);
  assert.equal(isExactNormalizedName("TEST BORROWER A | TEST LOAN 1", "TEST BORROWER A | TEST LOAN 1 "), false);
  assert.equal(isExactNormalizedName("TEST BORROWER A", "TEST BORROWER A INC"), false);
  assert.equal(isExactNormalizedName("", ""), false);
});

test("Holdings vs Holdco is a near-name candidate and is not exact", () => {
  const a = "TEST ABC HOLDINGS INC";
  const b = "TEST ABC HOLDCO LLC";
  assert.equal(isExactNormalizedName(a, b), false);
  assert.equal(isNearNameCandidate(a, b), true);
  assert.deepEqual(coreTokens(a), ["TEST", "ABC"]);
  assert.deepEqual(coreTokens(b), ["TEST", "ABC"]);
});

test("unrelated names are not near-name candidates", () => {
  assert.equal(isNearNameCandidate("TEST BORROWER A | TEST LOAN 1", "TEST BORROWER B | TEST LOAN 2"), false);
  assert.equal(isNearNameCandidate("TEST BORROWER A", "TEST BORROWER A"), false);
});

test("suffix-only difference against the same core is a candidate", () => {
  const golden = "TEST BORROWER A | TEST LOAN 1";
  const holdco = "TEST BORROWER A HOLDCO LLC | TEST LOAN 1";
  assert.equal(isExactNormalizedName(golden, holdco), false);
  assert.equal(isNearNameCandidate(golden, holdco), true);
});

test("method names used for MATCHED vs candidate stay distinct", () => {
  assert.equal(EXACT_METHOD, "EXACT_NORMALIZED_NAME");
  assert.equal(NEAR_NAME_METHOD, "NEAR_NAME_CANDIDATE");
  assert.equal(/fuzzy|llm/i.test(EXACT_METHOD), false);
  assert.equal(/fuzzy|llm/i.test(NEAR_NAME_METHOD), false);
});
