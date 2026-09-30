import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBorrowerName } from "../normalize/borrower-name.mjs";

test("raw text is not rewritten by normalizeBorrowerName", () => {
  const raw = "TEST BORROWER A | TEST LOAN 1";
  const once = normalizeBorrowerName(raw);
  assert.equal(raw, "TEST BORROWER A | TEST LOAN 1");
  assert.equal(once.extractionState, "EXTRACTED");
  assert.equal(once.normalizedText, raw);
});

test("normalization is deterministic", () => {
  const raw = "  TEST BORROWER A  ";
  const a = normalizeBorrowerName(raw);
  const b = normalizeBorrowerName(raw);
  assert.deepEqual(a, b);
  assert.equal(a.normalizedText, "TEST BORROWER A");
  assert.equal(a.extractionState, "EXTRACTED");
});

test("NFC composing characters normalize the same way twice", () => {
  const composed = "TEST CAF\u00c9";
  const decomposed = "TEST CAF\u0045\u0301";
  assert.notEqual(composed, decomposed);
  assert.equal(normalizeBorrowerName(composed).normalizedText, normalizeBorrowerName(decomposed).normalizedText);
});

test("different disclosed names stay different after v1 normalize", () => {
  const a = normalizeBorrowerName("TEST BORROWER A");
  const b = normalizeBorrowerName("TEST BORROWER B");
  const corp = normalizeBorrowerName("TEST BORROWER A INC");
  const incorporated = normalizeBorrowerName("TEST BORROWER A INCORPORATED");
  assert.notEqual(a.normalizedText, b.normalizedText);
  assert.notEqual(corp.normalizedText, incorporated.normalizedText);
  assert.equal(corp.normalizedText, "TEST BORROWER A INC");
  assert.equal(incorporated.normalizedText, "TEST BORROWER A INCORPORATED");
});

test("whitespace-only raw becomes UNRESOLVED with no normalized text", () => {
  const got = normalizeBorrowerName("   ");
  assert.equal(got.extractionState, "UNRESOLVED");
  assert.equal(got.normalizedText, null);
});

test("rejects non-string raw", () => {
  assert.throws(() => normalizeBorrowerName(null), /must be a string/);
});
