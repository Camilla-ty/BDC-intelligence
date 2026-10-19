import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { lit } from "../lib/db.mjs";
import { RULES, registerRules, ruleDefinitionSha } from "../load/rules.mjs";
import { assertIntegrationPipelineIsLocal } from "./local-pipeline-db.mjs";

const dbName = `bdc_crv_${process.pid}`;

// Hosted stored SHAs for the ten current-catalog pairs that mismatched at
// cb8e4ce. Historical rows stay stored; the catalog now exposes the next version.
const HOSTED_STORED = [
  { code: "obs.soi_fact_group", kind: "GROUPING", version: "1", sha: "5cf7443cdd7a90f819b753fae4cfdcc41e8002481976cd2a2a85040bee09ea00" },
  { code: "obs.spread.bound_ixbrl_fact", kind: "EXTRACTION", version: "1", sha: "4a20be93fb81a3276ccc18afac0328c65648263932bf903d43c4e3c16c570c5e" },
  { code: "parser.sec_soi_tsv", kind: "PARSER", version: "1", sha: "e2e7942b2dec8f832e6aa6c8b1faf86737207dacbd3108432f83852c2eccb1b4" },
  { code: "parser.sec_sub_tsv", kind: "PARSER", version: "1", sha: "c082b73c7434c5f852bfc3ee486440dad8f86e1c84f6329f69857519c5250bf6" },
  { code: "pipeline.registry_load", kind: "EXTRACTION", version: "4", sha: "65f7829f17b71632f785871aef31c353bbb92bb5797bdbe681f8326a8e0a6749" },
  { code: "pipeline.soi_load", kind: "EXTRACTION", version: "4", sha: "0fb26bb8fbf48e831d5230a03029fb75861fd8ca9835fafbe8e9e5aff8dbc766" },
  { code: "resolution.instrument_exact_identifier_and_type", kind: "RESOLUTION", version: "2", sha: "fdaee6bd2903b1a17eef4c480fcd8fe158f5eac8bda07a4cbdae11953d1f86c2" },
  { code: "resolution.instrument_unknown_attributes", kind: "RESOLUTION", version: "2", sha: "b0b4e4d9c171b56fd06243aba454542641b86efd78375033bc4ae3a32d17df22" },
  { code: "resolution.position_same_registrant_and_instrument", kind: "RESOLUTION", version: "2", sha: "5ff1532de06f84ffba2f900bb5ce731befdd3ae60b47dbb1fdc32f528768512d" },
  { code: "resolution.position_unresolved_without_instrument", kind: "RESOLUTION", version: "2", sha: "32bdc8b610b853a552796486a11a4e2cc40ab109a8eaaf98afd0cb72668f1f2a" },
];

function scalar(sql) {
  const found = query(dbName, sql);
  assert.equal(found.length, 1, sql);
  return found[0];
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline database tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const savedPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    try {
      assertIntegrationPipelineIsLocal();
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn();
    } finally {
      try { dropDatabase(dbName); } catch { /* assertion already ran */ }
      if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function startRun(kind) {
  return Number(query(dbName, `
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES (${lit(kind)}, 'test', '{}'::jsonb, now())
RETURNING id::text`)[0]);
}

function catalogRule(code) {
  const found = RULES.filter((rule) => rule.code === code);
  assert.equal(found.length, 1, code);
  return found[0];
}

function rowKey(code, version) {
  return scalar(`
SELECT id::text || '|' || definition_sha256 || '|' || created_by
FROM ops.rule_version
WHERE rule_code = ${lit(code)} AND version = ${lit(version)}`);
}

function insertStored(item) {
  query(dbName, `
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (${lit(item.code)}, ${lit(item.kind)}::ops.rule_kind, ${lit(item.version)}, ${lit(item.sha)},
        'docs/DATA_MODEL.md', 'HOSTED stored version whose definition_sha256 is not the current catalog SHA',
        'hosted stored version')`);
  return rowKey(item.code, item.version);
}

test("registerRules inserts the ten current versions beside stored Hosted SHAs without rewriting them", withDb(async () => {
  const before = HOSTED_STORED.map((item) => {
    const current = catalogRule(item.code);
    assert.notEqual(current.version, item.version, item.code);
    assert.notEqual(ruleDefinitionSha(current), item.sha, item.code);
    return { item, current, stored: insertStored(item) };
  });

  const runId = startRun("CATALOG_RULE_REGISTER");
  const rules = registerRules(dbName, runId);

  for (const { item, current, stored } of before) {
    assert.equal(rowKey(item.code, item.version), stored, item.code);
    assert.equal(scalar(`
SELECT version || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(item.code)} AND version = ${lit(current.version)}`),
      `${current.version}|${ruleDefinitionSha(current)}`, item.code);
    assert.equal(Number(scalar(`
SELECT id::text FROM ops.rule_version
WHERE rule_code = ${lit(item.code)} AND version = ${lit(current.version)}`)),
      rules[item.code], item.code);
    assert.notEqual(rules[item.code], Number(stored.split("|")[0]), item.code);
  }
}));

test("registerRules still refuses a drifted stored current version and does not overwrite it", withDb(async () => {
  const sample = HOSTED_STORED[0];
  const current = catalogRule(sample.code);
  const stored = insertStored(sample);
  query(dbName, `
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (${lit(current.code)}, ${lit(current.kind)}::ops.rule_kind, ${lit(current.version)}, ${lit("ab".repeat(32))},
        'pipeline/test (drifted)', 'TEST ONLY drifted current catalog version', 'historical test row')`);
  const currentBefore = rowKey(current.code, current.version);
  const runId = startRun("CATALOG_RULE_DRIFT");
  assert.throws(
    () => registerRules(dbName, runId),
    new RegExp(`${sample.code.replace(/\./g, "\\.")} v${current.version} changed without a version bump`),
  );
  assert.equal(rowKey(sample.code, sample.version), stored);
  assert.equal(rowKey(current.code, current.version), currentBefore);
  assert.equal(scalar(`SELECT count(*)::text FROM ops.run_rule_version WHERE run_id = ${runId}`), "0");
}));
