import test from "node:test";
import assert from "node:assert/strict";
import { mapInstrumentType } from "../normalize/instrument-type.mjs";

test("missing or empty disclosed member is UNKNOWN", () => {
  for (const raw of [null, ""]) {
    const got = mapInstrumentType(raw);
    assert.equal(got.valueState, "UNKNOWN");
    assert.equal(got.mappedText, null);
    assert.equal(got.reason, "no disclosed Investment Type Axis member");
  }
});

test("a disclosed member is kept as-is and is not rewritten to an invented bucket", () => {
  const raw = "us-gaap:DebtSecuritiesMember";
  const got = mapInstrumentType(raw);
  assert.equal(got.valueState, "REPORTED");
  assert.equal(got.mappedText, raw);
  assert.equal(got.reason, null);
  assert.notEqual(got.mappedText, "DEBT");
  assert.notEqual(got.mappedText, "LOAN");
});

test("unsupported mapping is not guessed from similar words", () => {
  const raw = "TEST ONLY unknown member";
  const got = mapInstrumentType(raw);
  assert.equal(got.valueState, "REPORTED");
  assert.equal(got.mappedText, raw);
});
