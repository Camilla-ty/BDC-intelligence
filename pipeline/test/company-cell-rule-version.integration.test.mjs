import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { lit } from "../lib/db.mjs";
import {
  COMPANY_CELL_RULE_CODE, COMPANY_CELL_RULE_VERSION,
} from "../normalize/company-cell-entity.mjs";
import { RULES, registerRules, ruleDefinitionSha } from "../load/rules.mjs";

const dbName = `bdc_ccrv_${process.pid}`;

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
  const found = RULES.filter((rule) => rule.code === COMPANY_CELL_RULE_CODE && rule.version === COMPANY_CELL_RULE_VERSION);
  assert.equal(found.length, 1);
  return found[0];
}

// Historical v1 definition as registered before supersession / stored-HTML modules were listed.
function priorV1DefinitionSha() {
  return ruleDefinitionSha({
    code: COMPANY_CELL_RULE_CODE,
    version: "1",
    files: [
      "pipeline/normalize/borrower-name.mjs",
      "pipeline/normalize/company-cell-entity.mjs",
      "pipeline/load/p6-company-cell.mjs",
    ],
  });
}

test("registerRules inserts company-cell v2 beside an already-registered v1 without rewriting v1", withDb(async () => {
  assert.equal(COMPANY_CELL_RULE_VERSION, "2");
  const priorSha = priorV1DefinitionSha();
  const current = catalogRule();
  const currentSha = ruleDefinitionSha(current);
  assert.notEqual(priorSha, currentSha);

  query(dbName, `
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (${lit(COMPANY_CELL_RULE_CODE)}, 'RESOLUTION', '1', ${lit(priorSha)},
        'pipeline/test (historical v1)', 'TEST ONLY prior company-cell rule', 'historical test row')`);
  const v1Before = scalar(`
SELECT id::text || '|' || definition_sha256 || '|' || created_by
FROM ops.rule_version
WHERE rule_code = ${lit(COMPANY_CELL_RULE_CODE)} AND version = '1'`);

  const runId = startRun("RULE_REGISTER");
  const rules = registerRules(dbName, runId);
  assert.ok(rules[COMPANY_CELL_RULE_CODE]);

  assert.equal(scalar(`
SELECT id::text || '|' || definition_sha256 || '|' || created_by
FROM ops.rule_version
WHERE rule_code = ${lit(COMPANY_CELL_RULE_CODE)} AND version = '1'`), v1Before);
  assert.equal(scalar(`
SELECT count(*)::text FROM ops.rule_version
WHERE rule_code = ${lit(COMPANY_CELL_RULE_CODE)}`), "2");
  assert.equal(scalar(`
SELECT version || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(COMPANY_CELL_RULE_CODE)} AND version = ${lit(COMPANY_CELL_RULE_VERSION)}`),
  `2|${currentSha}`);
  assert.equal(Number(scalar(`
SELECT id::text FROM ops.rule_version
WHERE rule_code = ${lit(COMPANY_CELL_RULE_CODE)} AND version = ${lit(COMPANY_CELL_RULE_VERSION)}`)),
  rules[COMPANY_CELL_RULE_CODE]);
  assert.notEqual(rules[COMPANY_CELL_RULE_CODE], Number(v1Before.split("|")[0]));
}));

test("registerRules refuses a stored company-cell current version with a drifted definition sha", withDb(async () => {
  const current = catalogRule();
  query(dbName, `
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (${lit(COMPANY_CELL_RULE_CODE)}, 'RESOLUTION', ${lit(current.version)}, ${lit("ab".repeat(32))},
        'pipeline/test (drifted)', 'TEST ONLY drifted company-cell rule', 'historical test row')`);
  const before = scalar(`
SELECT id::text || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(COMPANY_CELL_RULE_CODE)} AND version = ${lit(current.version)}`);
  const runId = startRun("RULE_REGISTER_DRIFT");
  assert.throws(
    () => registerRules(dbName, runId),
    new RegExp(`${COMPANY_CELL_RULE_CODE.replace(/\./g, "\\.")} v${current.version} changed without a version bump`),
  );
  assert.equal(scalar(`
SELECT id::text || '|' || definition_sha256
FROM ops.rule_version
WHERE rule_code = ${lit(COMPANY_CELL_RULE_CODE)} AND version = ${lit(current.version)}`), before);
  assert.equal(scalar(`SELECT count(*)::text FROM ops.run_rule_version WHERE run_id = ${runId}`), "0");
}));
