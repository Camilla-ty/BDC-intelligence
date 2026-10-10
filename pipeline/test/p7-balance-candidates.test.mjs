import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULES } from "../load/rules.mjs";
import {
  applyP7BalanceCandidateWrite,
  applyP7ToBalanceCandidates,
  P7_BALANCE_RULES,
} from "../p7-balance-candidates.mjs";

test("balance-candidate P7 links footnote v1 and instrument/continuity v2 from the catalog", () => {
  assert.deepEqual(
    P7_BALANCE_RULES.map((rule) => rule.code).sort(),
    [
      "norm.instrument_type_footnote_ref",
      "resolution.instrument_exact_identifier_and_type",
      "resolution.instrument_unknown_attributes",
      "resolution.position_same_registrant_and_instrument",
      "resolution.position_unresolved_without_instrument",
    ].sort(),
  );
  assert.equal(
    P7_BALANCE_RULES.find((rule) => rule.code === "norm.instrument_type_footnote_ref").version,
    "1",
  );
  for (const rule of P7_BALANCE_RULES) {
    if (rule.code.startsWith("resolution.")) assert.equal(rule.version, "2");
    assert.ok(
      RULES.some((item) => item.code === rule.code && item.version === rule.version),
      `${rule.code} v${rule.version} is in the RULES catalog`,
    );
  }
});

test("balance-candidate P7 rule list covers every key applyP7Min requires", () => {
  const src = readFileSync(new URL("../load/p7-min.mjs", import.meta.url), "utf8");
  const apply = src.slice(src.indexOf("export function applyP7Min"), src.indexOf("const {", src.indexOf("export function applyP7Min")));
  const needed = [...apply.matchAll(/rules\["([^"]+)"\]/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(needed)].sort(), P7_BALANCE_RULES.map((rule) => rule.code).sort());
});

test("balance-candidate P7 refuses a hosted database", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = "postgres://example.invalid/bdc";
  try {
    assert.throws(
      () => applyP7ToBalanceCandidates({ database: "bdc_local", dryRun: true, log() {} }),
      /refuses a hosted database/,
    );
  } finally {
    if (previous == null) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
});

test("balance-candidate P7 refuses a database other than the local database", () => {
  assert.throws(
    () => applyP7ToBalanceCandidates({ database: "other_db", dryRun: true, log() {} }),
    /refuses a database other than the local database/,
  );
});

test("balance-candidate P7 write refuses an empty observation list", () => {
  assert.throws(
    () => applyP7BalanceCandidateWrite({
      database: "bdc_local",
      positionObservationIds: [],
      runId: 1,
    }),
    /requires at least one observation/,
  );
});
