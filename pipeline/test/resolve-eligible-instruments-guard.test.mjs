import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RULES } from "../load/rules.mjs";
import {
  RESOLUTION_RULES,
  assertResolutionDatabase,
  resolveBoundedEligibleInstruments,
} from "../resolve-eligible-instruments.mjs";

const HOSTED = "postgres://example.invalid/bdc";

function withHostedUrl(fn) {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = HOSTED;
  try {
    fn();
  } finally {
    if (previous == null) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
}

function withLocalTarget(fn) {
  const previous = process.env.PIPELINE_DATABASE_URL;
  delete process.env.PIPELINE_DATABASE_URL;
  try {
    fn();
  } finally {
    if (previous != null) process.env.PIPELINE_DATABASE_URL = previous;
  }
}

test("eligible resolution refuses a hosted database by default", () => {
  withHostedUrl(() => {
    assert.throws(
      () => resolveBoundedEligibleInstruments({ database: "bdc_local", log() {} }),
      /refuses a hosted database/,
    );
    assert.throws(
      () => resolveBoundedEligibleInstruments({ database: "bdc_local", dryRun: true, log() {} }),
      /refuses a hosted database/,
    );
    assert.throws(() => assertResolutionDatabase("bdc_local"), /refuses a hosted database/);
  });
});

test("eligible resolution accepts a hosted database only with allowHosted", () => {
  withHostedUrl(() => {
    assert.doesNotThrow(() => assertResolutionDatabase("bdc_local", { allowHosted: true }));
  });
});

test("eligible resolution keeps the local database-name check in local mode", () => {
  withLocalTarget(() => {
    assert.throws(
      () => resolveBoundedEligibleInstruments({ database: "other_db", dryRun: true, log() {} }),
      /refuses a database other than the local database/,
    );
    assert.throws(
      () => assertResolutionDatabase("other_db", { allowHosted: true }),
      /refuses a database other than the local database/,
    );
    assert.doesNotThrow(() => assertResolutionDatabase("bdc_local"));
  });
});

test("eligible resolution links exactly the rules P4, P6, and P7 read", () => {
  const used = new Set();
  for (const file of ["p4-min.mjs", "p6-min.mjs", "p7-min.mjs"]) {
    const src = readFileSync(new URL(`../load/${file}`, import.meta.url), "utf8");
    for (const match of src.matchAll(/rules\["([^"]+)"\]/g)) used.add(match[1]);
  }
  assert.deepEqual(RESOLUTION_RULES.map((rule) => rule.code).sort(), [...used].sort());
  assert.equal(RESOLUTION_RULES.length, 7);
  for (const rule of RESOLUTION_RULES) {
    assert.ok(
      RULES.some((item) => item.code === rule.code && item.version === rule.version),
      `${rule.code} v${rule.version} is in the RULES catalog`,
    );
  }
});

test("eligible resolution links rules one by one and does not register the whole catalog", () => {
  const src = readFileSync(new URL("../resolve-eligible-instruments.mjs", import.meta.url), "utf8");
  assert.equal(src.includes("registerRules"), false);
  assert.ok(src.includes("ensureAndLinkRuleForRun(database, runId, rule)"));
});

test("eligible resolution dry run returns before any write", () => {
  const src = readFileSync(new URL("../resolve-eligible-instruments.mjs", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function resolveBoundedEligibleInstruments"));
  const dryRun = body.indexOf("if (dryRun)");
  const dryRunEnd = body.indexOf("return summary;", dryRun);
  assert.ok(dryRun > 0 && dryRunEnd > dryRun);
  for (const write of ["INSERT INTO", "snapshotP4Min", "linkResolutionRules", "applyP4Min", "applyP6Min", "applyP7Min"]) {
    const at = body.indexOf(write);
    assert.ok(at > dryRunEnd, `${write} comes after the dry-run return`);
  }
  assert.equal(body.slice(dryRun, dryRunEnd).includes("queryRows"), false);
});
