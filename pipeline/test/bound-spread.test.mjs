import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BOUND_SPREAD_CODE,
  BOUND_SPREAD_VERSION,
  persistBoundSpread,
} from "../load/bound-spread.mjs";
import { RULES, ruleDefinitionSha } from "../load/rules.mjs";
import { spreadFactFromBind } from "../normalize/maturity-context-bind.mjs";

test("bound spread refuses a hosted database without reading positions", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = "postgresql://pipeline_writer:s3cret@db.example:5432/postgres";
  try {
    assert.throws(
      () => persistBoundSpread({ database: "bdc_local", positionId: 1 }),
      /refuses a hosted database/,
    );
  } finally {
    if (previous === undefined) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
});

test("bound spread refuses a database other than the local database", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  delete process.env.PIPELINE_DATABASE_URL;
  try {
    assert.throws(
      () => persistBoundSpread({ database: "bdc_other", positionId: 1 }),
      /refuses a database other than the local database/,
    );
  } finally {
    if (previous === undefined) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
});

test("spreadFactFromBind returns null without a unique scaled spread fact", () => {
  assert.equal(spreadFactFromBind(null), null);
  assert.equal(spreadFactFromBind({ outcome: "UNKNOWN", contextId: null, facts: [] }), null);
  assert.equal(spreadFactFromBind({
    outcome: "FILING_DISPLAYED",
    contextId: "c1",
    facts: [
      { id: "a", name: "us-gaap:InvestmentBasisSpreadVariableRate", scale: "-2", text: "5.25" },
      { id: "b", name: "us-gaap:InvestmentBasisSpreadVariableRate", scale: "-2", text: "5.25" },
    ],
  }), null);
  assert.equal(spreadFactFromBind({
    outcome: "FILING_DISPLAYED",
    contextId: "c1",
    facts: [{ id: "a", name: "us-gaap:InvestmentOwnedAtCost", scale: "0", text: "1" }],
  }), null);
});

test("obs.spread.bound_ixbrl_fact is catalogued at version 1", () => {
  const rule = RULES.find((item) => item.code === BOUND_SPREAD_CODE && item.version === BOUND_SPREAD_VERSION);
  assert.ok(rule);
  assert.deepEqual(rule.files, [
    "pipeline/normalize/maturity-context-bind.mjs",
    "pipeline/load/bound-spread.mjs",
  ]);
  assert.equal(typeof ruleDefinitionSha(rule), "string");
  assert.equal(ruleDefinitionSha(rule).length, 64);
});

test("bound-spread module does not update an existing SPREAD head", () => {
  const src = readFileSync(new URL("../load/bound-spread.mjs", import.meta.url), "utf8");
  assert.match(src, /a current SPREAD head already exists; it was not overwritten/);
  assert.doesNotMatch(src, /UPDATE\s+obs\.position_field_value/i);
  assert.match(src, /bound spread persistence refuses a hosted database/);
});
