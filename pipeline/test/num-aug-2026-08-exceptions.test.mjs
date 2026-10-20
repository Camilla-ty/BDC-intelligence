import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { NUM_MEMBER_PATH, VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import { streamNumTsv } from "../parse/num.mjs";
import { footlenMatchesUnquotedFootnote, splitQuotedTsvFields } from "../parse/num-quoted-tsv.mjs";
import { streamMemberChunks } from "../parse/zip.mjs";

const WIDTH = VERIFIED_NUM_HEADER.length;
const DATA_DIR = ".data/sec-aug-2026-08-only";
const ZIP = `${DATA_DIR}/raw/sha256/05/0529ab8920f4d5c02d4f9b1ddc933d914065d4a3acf8bed39a49f44b040f657d`;
const SEGMENTS = 6;
const FOOTNOTE = VERIFIED_NUM_HEADER.indexOf("footnote");
const FOOTLEN = VERIFIED_NUM_HEADER.indexOf("footlen");
const D6_PASS_LINES = Object.freeze([
  1790, 18371, 273144, 273311, 433063, 639900, 640021, 640154, 647250, 825968, 828926, 841844, 949170,
]);
const D6_FAIL_LINES = Object.freeze([
  634367, 638720, 639901, 640022, 643855, 652709, 793877, 802489, 806821, 816624,
]);

// Structure-only locks from the Run 72 audit. No raw lines, tags, values, or names.
const RECORDED = Object.freeze([
  { line: 1790, sha: "d50a435159ac66fbd1b99c6dd7ed6e94986b73149c62cc1c69c88e3c87dbad9f", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 18371, sha: "8bbfca0c8b78f54570afa2ac4e8a4af961c1709bb1e546aa7d0b3cee31113a2f", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 273144, sha: "a03cdf1fd6fb058bdd75993f130ef1d60382653c9a4a969bab11d074779bf45b", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 273311, sha: "9378a61feba91847b2c98898d530e4d37eed0e8e2483f986649c950efdd4448c", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 433063, sha: "65c364f597a8406899be6f3432be687180e8c2bcb4e90427ac1e0eab3a8a3236", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 634367, sha: "b4e68d22c66e6b38f74a3f4aa7616dfe81f64625a8b56c7f32e35311574b2e25", naive: 12, quotedTabs: 1, extraQuoted: 1 },
  { line: 638720, sha: "27b1ca6e3ed13178ce877782bce04c65975655b56091862d5dc12cbb9836fcb4", naive: 12, quotedTabs: 1, extraQuoted: 1 },
  { line: 639900, sha: "7d3e9bf84caea73a41a9add890da77f359b3a875bbc04c4193285c1aeb4d998e", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 639901, sha: "4cd89e519246373b36e296a3b2a994b11adf913ca68886228391b2141853b3f9", naive: 12, quotedTabs: 1, extraQuoted: 1 },
  { line: 640021, sha: "7af804dbc42b865ec2f8bc33777512cc0d4fe1086aeb6f8a4d8d12e4279c9854", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 640022, sha: "21e7d26aa4efc17de49058b43b0a2eb33ecf79fc77dabba1dd5f8f8de991fa3b", naive: 12, quotedTabs: 1, extraQuoted: 1 },
  { line: 640154, sha: "e9e537ac0eb75a8edc40024686e91c7a4c5f3835fb19952b910fb8fa9a75d519", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 643855, sha: "0093b2b44db34213e8124dac77a19b4b759105915511753ebfe0232d8da53187", naive: 12, quotedTabs: 1, extraQuoted: 1 },
  { line: 647250, sha: "f053b0b920b66a4b429e42ad1d8997d45b4d73d6bee1207b243acdbeddad1602", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 652709, sha: "f5c1897310f4377404440e7972a79650ea6d3a58247acc31898e7965d5c36950", naive: 12, quotedTabs: 1, extraQuoted: 1 },
  { line: 793877, sha: "300e10a52e05e32c4658e7d4f18a25d6b9ff55cd33cabbd86215d7ff369ba57b", naive: 28, quotedTabs: 17, extraQuoted: 0 },
  { line: 802489, sha: "d801c302ae06d7420e0d9e1ab20a10d786e271708832e7dd9f4cb40d90dca615", naive: 28, quotedTabs: 17, extraQuoted: 0 },
  { line: 806821, sha: "28d6f594af259fe11265043ff5f0efa9f4711fea6386616f88ef0f877ec3c812", naive: 28, quotedTabs: 17, extraQuoted: 0 },
  { line: 816624, sha: "fc1ab92c3768f2302b701b66d966a712885bc02b41d99122f6fb10302d147565", naive: 28, quotedTabs: 17, extraQuoted: 0 },
  { line: 825968, sha: "74e5314e6d53ac968fb0934d2c077c2fa2bf9018a141537676b8bf0204ae8507", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 828926, sha: "46e710eaef2dee218ea918d67957eafbca44b1285364c15cf0baa187425a2105", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 841844, sha: "4487bb8603a191503640b19ad7acfcda01b95b94859d37deedc4e77f30dcba4a", naive: 12, quotedTabs: 1, extraQuoted: 0 },
  { line: 949170, sha: "a3da67bff9895ad04f51f7873662fbf1aae6e570f5713164dcbf5fa7bfeec7ce", naive: 12, quotedTabs: 1, extraQuoted: 0 },
]);

function sha256Utf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("August 2026 NUM exception lines keep recorded hashes and quoted structure", async (t) => {
  if (!existsSync(DATA_DIR) || !existsSync(ZIP)) {
    t.skip(`${DATA_DIR} is not present`);
    return;
  }

  const byLine = new Map(RECORDED.map((row) => [row.line, row]));
  const found = new Map();
  const last = RECORDED[RECORDED.length - 1].line;

  for await (const event of streamNumTsv(streamMemberChunks(ZIP, NUM_MEMBER_PATH))) {
    if (event.kind !== "row") continue;
    const spec = byLine.get(event.lineNumber);
    if (!spec) continue;
    const naive = event.raw.split("\t").length;
    const sha = sha256Utf8(event.raw);
    const parsed = splitQuotedTsvFields(event.raw);
    const extraQuoted = parsed.quoteMeta.filter((meta, i) => i !== SEGMENTS && meta.quoted).length;
    found.set(event.lineNumber, {
      sha,
      naive,
      quoted: parsed.cells.length,
      segmentsQuoted: parsed.quoteMeta[SEGMENTS]?.quoted === true,
      quotedTabs: parsed.quoteMeta[SEGMENTS]?.tabsInside ?? 0,
      extraQuoted,
      d6: footlenMatchesUnquotedFootnote(parsed.cells[FOOTNOTE] ?? "", parsed.cells[FOOTLEN] ?? ""),
    });
    if (found.size === RECORDED.length || event.lineNumber >= last) break;
  }

  assert.equal(found.size, RECORDED.length);
  for (const spec of RECORDED) {
    const got = found.get(spec.line);
    assert.ok(got, `missing line ${spec.line}`);
    assert.equal(got.sha, spec.sha, `sha line ${spec.line}`);
    assert.equal(got.naive, spec.naive, `naive count line ${spec.line}`);
    assert.equal(got.quoted, WIDTH, `quoted count line ${spec.line}`);
    assert.equal(got.segmentsQuoted, true, `segments quoting line ${spec.line}`);
    assert.equal(got.quotedTabs, spec.quotedTabs, `quoted tabs line ${spec.line}`);
    assert.equal(got.extraQuoted, spec.extraQuoted, `extra quoted fields line ${spec.line}`);
    assert.notEqual(got.naive, WIDTH);
    assert.equal(got.d6, D6_PASS_LINES.includes(spec.line), `D6 line ${spec.line}`);
  }
  assert.deepEqual([...found.entries()].filter(([, row]) => row.d6).map(([line]) => line), D6_PASS_LINES);
  assert.deepEqual([...found.entries()].filter(([, row]) => !row.d6).map(([line]) => line), D6_FAIL_LINES);
});
