import test from "node:test";
import assert from "node:assert/strict";
import { decodeHtmlEntities, needleInFiling, stripTags } from "../normalize/filing-text.mjs";

test("exact raw string is found without rewriting the needle", () => {
  const buf = Buffer.from("prefix TEST BORROWER A | TEST LOAN 1 suffix", "utf8");
  assert.equal(needleInFiling(buf, "TEST BORROWER A | TEST LOAN 1"), true);
  assert.equal(needleInFiling(buf, "TEST BORROWER A"), true);
  assert.equal(needleInFiling(buf, "TEST BORROWER B | TEST LOAN 1"), false);
});

test("does not split on pipe or collapse needle whitespace", () => {
  const buf = Buffer.from("TEST BORROWER A TEST LOAN 1", "utf8");
  assert.equal(needleInFiling(buf, "TEST BORROWER A | TEST LOAN 1"), false);
  const spaced = Buffer.from("TEST  100", "utf8");
  assert.equal(needleInFiling(spaced, "TEST 100"), false);
});

test("HTML entity-decoded text can match the disclosed needle", () => {
  assert.equal(decodeHtmlEntities("A&amp;B"), "A&B");
  const buf = Buffer.from("name A&amp;B end", "utf8");
  assert.equal(needleInFiling(buf, "A&B"), true);
});

test("tag-stripped text can match a value wrapped in tags", () => {
  assert.equal(stripTags("<ix:nonFraction>100</ix:nonFraction>").includes("100"), true);
  const buf = Buffer.from("<td><ix:nonFraction name=\"us-gaap:Test\">100</ix:nonFraction></td>", "utf8");
  assert.equal(needleInFiling(buf, "100"), true);
});

test("empty needle is not a match", () => {
  assert.equal(needleInFiling(Buffer.from("anything", "utf8"), ""), false);
});
