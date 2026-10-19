import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { lit } from "../lib/db.mjs";
import {
  BOUND_CONTEXT_RESEARCH_CODE, BOUND_CONTEXT_RESEARCH_VERSION,
} from "../extract/bound-context-research-cell.mjs";
import { RULES, registerRules, ruleDefinitionSha } from "../load/rules.mjs";
import { assertIntegrationPipelineIsLocal } from "./local-pipeline-db.mjs";

const dbName = `bdc_bcrv_${process.pid}`;

// Hosted stored v3 SHA (2026-10-11). Not reproducible from any git commit of the covered files.
const HOSTED_V3_DEFINITION_SHA256 = "a12af0bf482bf0b369118c092752cadceff895696b15e538ab1f7a91266d7504";

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

function catalogRule() {
  const found = RULES.filter((rule) => rule.code === BOUND_CONTEXT_RESEARCH_CODE && rule.version === BOUND_CONTEXT_RESEARCH_VERSION);
  assert.equal(found.length, 1);
  return found[0];
}

function insertHostedV3() {
  query(dbName, `
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (${lit(BOUND_CONTEXT_RESEARCH_CODE)}, 'EXTRACTION', '3', ${lit(HOSTED_V3_DEFINITION_SHA256)},
        'docs/DATA_MODEL.md', 'HOSTED stored v3 whose definition_sha256 is not reproducible from git',
        'hosted stored v3')`);
  return scalar(`
SELECT id::text || '|' || definition_sha256 || '|' || created_by
FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '3'`);
}

test("registerRules inserts bound-context v4 beside a stored Hosted v3 SHA without rewriting v3", withDb(async () => {
  assert.equal(BOUND_CONTEXT_RESEARCH_VERSION, "4");
  const current = catalogRule();
  const currentSha = ruleDefinitionSha(current);
  assert.notEqual(currentSha, HOSTED_V3_DEFINITION_SHA256);

  const v3Before = insertHostedV3();
  const runId = startRun("BOUND_CONTEXT_RULE_REGISTER");
  const rules = registerRules(dbName, runId);

  assert.equal(scalar(`
SELECT id::text || '|' || definition_sha256 || '|' || created_by
FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '3'`), v3Before);
  assert.equal(scalar(`
SELECT count(*)::text FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)}`), "2");
  assert.equal(scalar(`
SELECT version || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '4'`),
  `4|${currentSha}`);
  assert.equal(Number(scalar(`
SELECT id::text FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '4'`)),
  rules[BOUND_CONTEXT_RESEARCH_CODE]);
  assert.notEqual(rules[BOUND_CONTEXT_RESEARCH_CODE], Number(v3Before.split("|")[0]));
}));

test("registerRules still refuses a drifted stored v4 and does not overwrite it", withDb(async () => {
  insertHostedV3();
  const current = catalogRule();
  query(dbName, `
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (${lit(BOUND_CONTEXT_RESEARCH_CODE)}, 'EXTRACTION', ${lit(current.version)}, ${lit("ab".repeat(32))},
        'pipeline/test (drifted)', 'TEST ONLY drifted bound-context v4', 'historical test row')`);
  const v3Before = scalar(`
SELECT id::text || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '3'`);
  const v4Before = scalar(`
SELECT id::text || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '4'`);
  const runId = startRun("BOUND_CONTEXT_RULE_DRIFT");
  assert.throws(
    () => registerRules(dbName, runId),
    new RegExp(`${BOUND_CONTEXT_RESEARCH_CODE.replace(/\./g, "\\.")} v4 changed without a version bump`),
  );
  assert.equal(scalar(`
SELECT id::text || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '3'`), v3Before);
  assert.equal(scalar(`
SELECT id::text || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(BOUND_CONTEXT_RESEARCH_CODE)} AND version = '4'`), v4Before);
  assert.equal(scalar(`SELECT count(*)::text FROM ops.run_rule_version WHERE run_id = ${runId}`), "0");
}));
