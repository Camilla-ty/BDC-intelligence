import test from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import {
  footlenMatchesUnquotedFootnote, recoverQuotedNumCells, splitQuotedTsvFields,
} from "../parse/num-quoted-tsv.mjs";
import { FAKE, numFactRow, numLine, numSegmentsTyped } from "./synthetic.mjs";

const WIDTH = VERIFIED_NUM_HEADER.length;

function quotedSegments(identifier, extraTabs) {
  return `"${numSegmentsTyped(identifier)}${"\t".repeat(extraTabs)}"`;
}

function quotedNumLine({ extraTabs, footnote = "", footlen = "0" }) {
  const row = numFactRow({
    tag: "InvestmentOwnedAtCost",
    value: "100",
    footnote,
    footlen,
  });
  return [
    row.adsh, row.tag, row.version, row.ddate, row.qtrs, row.uom,
    quotedSegments(FAKE.ident, extraTabs),
    row.dimn, row.value, row.footnote, row.footlen,
  ].join("\t");
}

test("quoted TSV keeps ordinary eleven-column NUM lines unchanged", () => {
  const raw = numLine(numFactRow({ tag: "InvestmentOwnedAtCost", value: "100" }));
  const parsed = splitQuotedTsvFields(raw);
  assert.equal(raw.split("\t").length, WIDTH);
  assert.equal(parsed.cells.length, WIDTH);
  assert.deepEqual(parsed.cells, raw.split("\t"));
  assert.equal(parsed.quoteMeta.every((meta) => meta.quoted === false && meta.tabsInside === 0), true);
});

test("a quoted segments tab is one field, not a delimiter", () => {
  const raw = quotedNumLine({ extraTabs: 1 });
  assert.equal(raw.split("\t").length, 12);
  const parsed = splitQuotedTsvFields(raw);
  assert.equal(parsed.cells.length, WIDTH);
  assert.equal(parsed.quoteMeta[6].quoted, true);
  assert.equal(parsed.quoteMeta[6].tabsInside, 1);
  assert.match(parsed.cells[6], /\t/);
  assert.equal(parsed.cells[0], FAKE.acc);
  assert.equal(parsed.cells[7], "1");
  assert.equal(parsed.cells[8], "100");
});

test("seventeen quoted segments tabs yield naive 28 fields and quoted 11", () => {
  const raw = quotedNumLine({ extraTabs: 17 });
  assert.equal(raw.split("\t").length, 28);
  const parsed = splitQuotedTsvFields(raw);
  assert.equal(parsed.cells.length, WIDTH);
  assert.equal(parsed.quoteMeta[6].quoted, true);
  assert.equal(parsed.quoteMeta[6].tabsInside, 17);
});

test("tabs outside quotes remain field delimiters", () => {
  const raw = `${FAKE.acc}\tInvestmentOwnedAtCost\tus-gaap/2099\t20991231\t0\tUSD\t${numSegmentsTyped(FAKE.ident)}\t1\t100\t\t0`;
  const parsed = splitQuotedTsvFields(raw);
  assert.equal(parsed.cells.length, WIDTH);
  assert.equal(parsed.cells[1], "InvestmentOwnedAtCost");
  assert.equal(parsed.quoteMeta[1].quoted, false);
});

test("doubled quotes become one literal quote inside a quoted field", () => {
  const raw = [
    FAKE.acc, "InvestmentOwnedAtCost", "us-gaap/2099", "20991231", "0", "USD",
    `"${numSegmentsTyped("TEST BORROWER A \"\"NOTE\"\" | TEST LOAN 1")}"`,
    "1", "100", '"footnote ""text"""', "16",
  ].join("\t");
  const parsed = splitQuotedTsvFields(raw);
  assert.equal(parsed.cells.length, WIDTH);
  assert.equal(parsed.quoteMeta[6].doubledQuotes, 2);
  assert.equal(parsed.quoteMeta[9].quoted, true);
  assert.equal(parsed.quoteMeta[9].doubledQuotes, 2);
  assert.equal(parsed.quoteMeta[9].tabsInside, 0);
  assert.equal(parsed.cells[9], "footnote \"text\"");
  assert.match(parsed.cells[6], /TEST BORROWER A "NOTE" \| TEST LOAN 1/);
});

test("unclosed quotes are rejected", () => {
  const raw = `${FAKE.acc}\t"TEST ONLY unclosed`;
  assert.throws(() => splitQuotedTsvFields(raw), /not closed/);
});

test("a quote that does not start a field is rejected", () => {
  const raw = `${FAKE.acc}\tInvestment"Owned\t100`;
  assert.throws(() => splitQuotedTsvFields(raw), /must start a field/);
});

test("text after a closing quote is rejected", () => {
  const raw = `${FAKE.acc}\t"TEST ONLY"x\t100`;
  assert.throws(() => splitQuotedTsvFields(raw), /followed by a tab/);
});

test("recoverQuotedNumCells returns eleven cells for valid quoted extra tabs", () => {
  const raw = quotedNumLine({ extraTabs: 1 });
  const recovered = recoverQuotedNumCells(raw, WIDTH);
  assert.equal(raw.split("\t").length, 12);
  assert.equal(recovered.cells.length, WIDTH);
  assert.equal(recovered.cells[8], "100");
  assert.match(recovered.cells[6], /\t/);
});

test("recoverQuotedNumCells returns null for invalid quoting", () => {
  assert.equal(recoverQuotedNumCells(`${FAKE.acc}\t"TEST ONLY unclosed`, WIDTH), null);
  assert.equal(recoverQuotedNumCells(`${FAKE.acc}\tInvestment"Owned\t100`, WIDTH), null);
  assert.equal(recoverQuotedNumCells(`${FAKE.acc}\t"TEST ONLY"x\t100`, WIDTH), null);
});

test("unquoted extra tabs are not recovered as eleven NUM cells", () => {
  const raw = `${numLine(numFactRow({ tag: "InvestmentOwnedAtCost", value: "100" }))}\textra`;
  assert.equal(raw.split("\t").length, WIDTH + 1);
  assert.equal(recoverQuotedNumCells(raw, WIDTH), null);
});

test("D6 requires footlen to equal the UTF-8 byte length of the unquoted footnote", () => {
  assert.equal(footlenMatchesUnquotedFootnote("", "0"), true);
  assert.equal(footlenMatchesUnquotedFootnote("hello", "5"), true);
  assert.equal(footlenMatchesUnquotedFootnote("", "4"), false);
  assert.equal(footlenMatchesUnquotedFootnote("hello", "0"), false);
  assert.equal(footlenMatchesUnquotedFootnote("é", "2"), true);
  assert.equal(footlenMatchesUnquotedFootnote("é", "1"), false);
});
