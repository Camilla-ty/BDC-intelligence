import test from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import { formatCopyRow } from "../lib/db.mjs";
import { parseIdentifierMemberFromSegments } from "../normalize/num-segments.mjs";
import { EMPTY_BUFFER_SHA256, collectNumTsv, numHeaderMatches, parseNumTsv } from "../parse/num.mjs";
import { FAKE, numFactRow, numLine, numSegmentsPlain, numSegmentsTyped, numTsv } from "./synthetic.mjs";

async function parseChunked(buffer, size) {
  const chunks = [];
  for (let i = 0; i < buffer.length; i += size) chunks.push(buffer.subarray(i, i + size));
  return collectNumTsv(chunks);
}

test("NUM header matches the documented eleven-column layout only", () => {
  assert.equal(numHeaderMatches([...VERIFIED_NUM_HEADER]), true);
  assert.equal(numHeaderMatches([...VERIFIED_NUM_HEADER, "extra"]), false);
  assert.equal(numHeaderMatches(VERIFIED_NUM_HEADER.slice(0, 8)), false);
});

test("parseNumTsv keeps lines and rejects schema drift headers", () => {
  const ok = parseNumTsv(Buffer.from(numTsv([
    numFactRow({ tag: "InvestmentOwnedBalancePrincipalAmount", value: "100" }),
  ]), "utf8"));
  assert.equal(ok.emptyFile, false);
  assert.equal(ok.headerMatches, true);
  assert.equal(ok.rows.length, 1);
  assert.equal(ok.rows[0].lineNumber, 2);

  const empty = parseNumTsv(Buffer.alloc(0));
  assert.equal(empty.emptyFile, true);
  assert.equal(empty.headerSha256, EMPTY_BUFFER_SHA256);

  const drift = parseNumTsv(Buffer.from("adsh\ttag\n0000000000-00-000001\tX\n", "utf8"));
  assert.equal(drift.headerMatches, false);
});

test("parseNumTsv keeps empty values, original line numbers, and CR inside LF lines", () => {
  const header = VERIFIED_NUM_HEADER.join("\t");
  const emptyValue = numLine(numFactRow({ tag: "InvestmentOwnedAtCost", value: "", identifier: FAKE.ident }));
  const crLine = `${numLine(numFactRow({ tag: "InvestmentOwnedAtFairValue", value: "80" }))}\r`;
  const mismatch = "0000000000-00-000001\tshort";
  const text = `${header}\n${emptyValue}\n${crLine}\n${mismatch}\n`;
  const parsed = parseNumTsv(Buffer.from(text, "utf8"));
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].lineNumber, 2);
  assert.equal(parsed.rows[1].lineNumber, 3);
  assert.equal(parsed.rows[2].lineNumber, 4);
  assert.equal(parsed.rows[0].raw.endsWith("\t0"), true);
  assert.equal(parsed.rows[0].raw.split("\t")[VERIFIED_NUM_HEADER.indexOf("value")], "");
  assert.equal(parsed.rows[1].raw.endsWith("\r"), true);
  assert.equal(parsed.carriageReturns, 1);
  assert.equal(parsed.rows[2].raw, mismatch);
});

test("chunked NUM stream matches the buffered parser, including UTF-8 and missing final LF", async () => {
  const euro = numLine(numFactRow({ tag: "InvestmentOwnedBalancePrincipalAmount", value: "100", identifier: "TEST BORROWER € | TEST LOAN 1" }));
  const noNl = Buffer.from(`${VERIFIED_NUM_HEADER.join("\t")}\n${euro}`, "utf8");
  const withNl = Buffer.from(`${noNl.toString("utf8")}\n`, "utf8");
  for (const buffer of [noNl, withNl]) {
    const buffered = parseNumTsv(buffer);
    for (const size of [1, 2, 3, 7, buffer.length]) {
      assert.deepEqual(await parseChunked(buffer, size), buffered);
    }
  }
});

test("COPY escaping of streamed rows matches the buffered copy payload", () => {
  const raw = `${numLine(numFactRow({ tag: "InvestmentOwnedAtCost", value: "90" }))}\\tab\r`;
  const buffered = parseNumTsv(Buffer.from(`${VERIFIED_NUM_HEADER.join("\t")}\n${raw}\n`, "utf8"));
  assert.equal(
    formatCopyRow([buffered.rows[0].lineNumber, buffered.rows[0].raw]),
    `${buffered.rows[0].lineNumber}\t${buffered.rows[0].raw.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "\\r")}`,
  );
});

test("invalid UTF-8 is rejected by both the buffered and chunked parsers", async () => {
  const invalid = Buffer.from([0x61, 0x64, 0x73, 0x68, 0x0a, 0xff, 0xfe]);
  assert.throws(() => parseNumTsv(invalid), /not valid UTF-8/);
  await assert.rejects(collectNumTsv([invalid.subarray(0, 5), invalid.subarray(5)]), /not valid UTF-8/);
  const incomplete = Buffer.from([0xe2, 0x82]);
  assert.throws(() => parseNumTsv(incomplete), /not valid UTF-8/);
  await assert.rejects(collectNumTsv([incomplete]), /not valid UTF-8/);
});

test("identifier member parses typed and plain segments forms", () => {
  assert.equal(
    parseIdentifierMemberFromSegments(numSegmentsTyped(FAKE.ident)),
    FAKE.ident,
  );
  assert.equal(
    parseIdentifierMemberFromSegments(numSegmentsPlain(FAKE.ident)),
    FAKE.ident,
  );
  assert.equal(parseIdentifierMemberFromSegments("InvestmentTypeAxis=First Lien;"), null);
  assert.equal(parseIdentifierMemberFromSegments(""), null);
  assert.equal(parseIdentifierMemberFromSegments(null), null);
});
