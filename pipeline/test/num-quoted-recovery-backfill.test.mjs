import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import { MATURITY_WORKER_LOCK_KEY } from "../load/maturity-worker-lock.mjs";
import { NUM_CURRENCY_BIND_LOCK_KEY } from "../load/num-currency-bind.mjs";
import {
  ALREADY_LOADED_MARKER, AUG_2026_NUM_BACKFILL_PIN, BACKFILL_RULE, BACKFILL_RUN_KIND, BackfillHardStop,
  NUM_QUOTED_BACKFILL_LOCK_KEY, PARSER_RULE, PROJECTION_RULE, backfillUnitSql, recoverLockedRows, validatePin,
} from "../load/num-quoted-recovery-backfill.mjs";
import { RULES } from "../load/rules.mjs";
import { FAKE, numFactRow } from "./synthetic.mjs";

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function quotedLine({ footnote = "", footlen = "0" } = {}) {
  const row = numFactRow({ tag: "InvestmentOwnedAtCost", value: "100", footnote, footlen });
  return [row.adsh, row.tag, row.version, row.ddate, row.qtrs, row.uom,
    `"${row.segments}\t"`, row.dimn, row.value, row.footnote, row.footlen].join("\t");
}

function fakePin(lines, passLines) {
  return {
    label: "TEST ONLY",
    artifactSha256: "0".repeat(64),
    sourceTypeCode: "SEC_BDC_DATASET_ZIP",
    sourceRowCount: 9,
    sourceMismatchCount: lines.length,
    locks: lines.map(([line, raw]) => ({ line, sha: sha(raw) })),
    d6PassLines: passLines,
    d6FailLines: lines.map(([line]) => line).filter((line) => !passLines.includes(line)),
  };
}

const stored = (line, raw, parseStatus = "FIELD_COUNT_MISMATCH") => ({ line, raw, sha: sha(raw), parseStatus });

test("catalog names and pins match ADR 0021", () => {
  assert.equal(BACKFILL_RUN_KIND, "NUM_QUOTED_RECOVERY_BACKFILL");
  assert.match(BACKFILL_RUN_KIND, /^[A-Z][A-Z0-9_]*$/);
  assert.match(BACKFILL_RULE.code, /^[a-z][a-z0-9_.]*$/);
  const rule = RULES.filter((item) => item.code === BACKFILL_RULE.code);
  assert.equal(rule.length, 1);
  assert.equal(rule[0].kind, "EXTRACTION");
  assert.equal(rule[0].version, BACKFILL_RULE.version);
  assert.equal(rule[0].ensureOnly, true);
  assert.equal(RULES.filter((item) => item.ensureOnly).length, 1);
  for (const pinned of [PARSER_RULE, PROJECTION_RULE]) {
    assert.ok(RULES.some((item) => item.code === pinned.code && item.version === pinned.version && !item.ensureOnly));
  }
  for (const file of rule[0].files) {
    assert.ok(!["pipeline/load/units/dataset-num.mjs", "pipeline/load/num-run.mjs", "pipeline/load/run.mjs"].includes(file), file);
  }
  validatePin(AUG_2026_NUM_BACKFILL_PIN);
  assert.equal(AUG_2026_NUM_BACKFILL_PIN.locks.length, 23);
  assert.equal(AUG_2026_NUM_BACKFILL_PIN.d6PassLines.length, 13);
  assert.equal(AUG_2026_NUM_BACKFILL_PIN.d6FailLines.length, 10);
  assert.equal(AUG_2026_NUM_BACKFILL_PIN.sourceRowCount, 950069);
  assert.equal(AUG_2026_NUM_BACKFILL_PIN.sourceMismatchCount, 23);
});

test("the advisory lock key is distinct and the unit is one transaction", () => {
  assert.notEqual(NUM_QUOTED_BACKFILL_LOCK_KEY, NUM_CURRENCY_BIND_LOCK_KEY);
  assert.notEqual(NUM_QUOTED_BACKFILL_LOCK_KEY, MATURITY_WORKER_LOCK_KEY);
  const pass = quotedLine();
  const fail = quotedLine({ footlen: "4" });
  const pin = fakePin([[2, pass], [3, fail]], [2]);
  const recovered = recoverLockedRows(pin, [stored(2, pass), stored(3, fail)]);
  const sql = backfillUnitSql({
    pin, sourceTableLoadId: 7, recovered, runId: 11, ruleIds: { backfill: 21, parser: 22, projection: 23 },
  });
  assert.equal(sql.match(/\bBEGIN;/g).length, 1);
  assert.equal(sql.match(/\bCOMMIT;/g).length, 1);
  const lockAt = sql.indexOf(`pg_advisory_xact_lock(${NUM_QUOTED_BACKFILL_LOCK_KEY})`);
  const markerAt = sql.indexOf(ALREADY_LOADED_MARKER);
  const firstInsert = sql.indexOf("INSERT INTO raw.table_load");
  assert.ok(lockAt > sql.indexOf("BEGIN;") && lockAt < markerAt && markerAt < firstInsert);
  assert.ok(!/\bUPDATE\b|\bDELETE\b|ON CONFLICT/.test(sql));
  assert.ok(!sql.includes("INSERT INTO raw.artifact "));
  assert.match(sql, /INSERT INTO ops\.artifact_processing[\s\S]*21, 'LOADED'/);
});

test("recovery stops on missing, non-FCM, changed, or unparseable locked rows", () => {
  const pass = quotedLine();
  const pin = fakePin([[2, pass]], [2]);
  assert.equal(recoverLockedRows(pin, [stored(2, pass)])[0].cells.length, VERIFIED_NUM_HEADER.length);
  assert.throws(() => recoverLockedRows(pin, []), BackfillHardStop);
  assert.throws(() => recoverLockedRows(pin, [stored(2, pass, "OK")]), /not FIELD_COUNT_MISMATCH/);
  assert.throws(() => recoverLockedRows(pin, [{ ...stored(2, pass), raw: `${pass} ` }]), /SHA-256 differs/);
  const unclosed = `${FAKE.acc}\t"TEST ONLY unclosed`;
  assert.throws(() => recoverLockedRows(fakePin([[2, unclosed]], []), [stored(2, unclosed)]), /not a valid 11-field/);
  assert.throws(() => recoverLockedRows(fakePin([[2, pass]], []), [stored(2, pass)]), /D6 result differs/);
});

test("pin validation refuses inconsistent locks", () => {
  const pass = quotedLine();
  assert.throws(() => validatePin({ ...fakePin([[2, pass]], [2]), sourceMismatchCount: 2 }), /lock count/);
  assert.throws(() => validatePin(fakePin([[2, pass], [2, pass]], [2])), /listed twice|partition/);
  assert.throws(() => validatePin({ ...fakePin([[2, pass]], [2]), d6FailLines: [2] }), /partition/);
});
