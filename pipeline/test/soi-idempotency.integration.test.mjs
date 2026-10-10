import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { alreadyProcessed, runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { registryZipStatus } from "../load/units/dataset-soi.mjs";
import { writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_idem_${process.pid}`;
const HEX = (ch) => ch.repeat(64);

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  return found[0];
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline integration tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-idem-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function ruleId(code, version) {
  return Number(scalar(`SELECT id FROM ops.rule_version WHERE rule_code = '${code}' AND version = '${version}'`));
}

function insertRule(code, version, sha) {
  return Number(scalar(`INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES ('${code}', 'EXTRACTION', '${version}', '${sha}', 'TEST-ONLY', 'TEST ONLY older loader version', 'TEST ONLY')
RETURNING id`));
}

function insertArtifact(runId, url, sha) {
  return Number(scalar(`INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('${url}', '${url}', 'SEC_BDC_DATASET_ZIP', 200, 1, '${sha}', '2099-12-31T00:00:00Z', 'TEST-ONLY/${sha}', ${runId})
RETURNING id`));
}

function insertProcessing(artifactId, ruleVersionId, outcome, runId) {
  rows(`INSERT INTO ops.artifact_processing (artifact_id, rule_version_id, outcome, detail, counts, run_id)
VALUES (${artifactId}, ${ruleVersionId}, '${outcome}', 'TEST ONLY ${outcome}', '{}'::jsonb, ${runId})`);
}

test("cross-version LOADED counts, and non-LOADED older rows do not", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir);
  await runLoad({ dataDir, database: dbName, log: () => {} });
  const runId = Number(scalar("SELECT min(id) FROM ops.run"));
  const currentSoi = ruleId("pipeline.soi_load", "4");
  const currentRegistry = ruleId("pipeline.registry_load", "4");
  const olderSoi = insertRule("pipeline.soi_load", "1", HEX("a"));
  const laterSoi = insertRule("pipeline.soi_load", "9", HEX("b"));
  const otherRule = ruleId("coverage.soi", "3");
  const newerRegistry = insertRule("pipeline.registry_load", "9", HEX("c"));

  assert.equal(scalar("SELECT version FROM ops.rule_version WHERE rule_code = 'parser.sec_soi_tsv'"), "1");
  assert.equal(scalar("SELECT version FROM ops.rule_version WHERE rule_code = 'coverage.soi'"), "3");
  assert.equal(scalar("SELECT version FROM ops.rule_version WHERE rule_code = 'obs.projection.soi'"), "3");
  assert.equal(scalar("SELECT version FROM ops.rule_version WHERE rule_code = 'validation.soi_adsh_cik'"), "3");
  assert.equal(scalar("SELECT count(*) FROM ops.rule_version WHERE rule_code = 'pipeline.soi_load' AND version = '4'"), "1");
  assert.equal(scalar("SELECT count(*) FROM ops.rule_version WHERE rule_code = 'pipeline.registry_load' AND version = '4'"), "1");

  const url = "https://www.sec.gov/files/TEST-ONLY/idempotency-loaded.zip";
  const sha = HEX("d");
  const loaded = insertArtifact(runId, url, sha);
  insertProcessing(loaded, olderSoi, "LOADED", runId);
  assert.equal(alreadyProcessed(dbName, { url, sha256: sha }, currentSoi), true);

  const driftUrl = "https://www.sec.gov/files/TEST-ONLY/idempotency-drift.zip";
  const drift = insertArtifact(runId, driftUrl, HEX("e"));
  insertProcessing(drift, olderSoi, "SCHEMA_DRIFT", runId);
  assert.equal(alreadyProcessed(dbName, { url: driftUrl, sha256: HEX("e") }, currentSoi), false);

  const scopeUrl = "https://www.sec.gov/files/TEST-ONLY/idempotency-scope.zip";
  const scope = insertArtifact(runId, scopeUrl, HEX("f"));
  insertProcessing(scope, olderSoi, "NOT_IN_SCOPE", runId);
  assert.equal(alreadyProcessed(dbName, { url: scopeUrl, sha256: HEX("f") }, currentSoi), false);

  assert.equal(alreadyProcessed(dbName, { url, sha256: HEX("1") }, currentSoi), false);
  const otherUrl = "https://www.sec.gov/files/TEST-ONLY/idempotency-other-url.zip";
  insertArtifact(runId, otherUrl, sha);
  assert.equal(alreadyProcessed(dbName, { url: otherUrl, sha256: sha }, currentSoi), false);

  const otherCodeUrl = "https://www.sec.gov/files/TEST-ONLY/idempotency-other-rule.zip";
  const otherCode = insertArtifact(runId, otherCodeUrl, HEX("2"));
  insertProcessing(otherCode, otherRule, "LOADED", runId);
  assert.equal(alreadyProcessed(dbName, { url: otherCodeUrl, sha256: HEX("2") }, currentSoi), false);

  insertProcessing(loaded, laterSoi, "NOT_IN_SCOPE", runId);
  assert.equal(alreadyProcessed(dbName, { url, sha256: sha }, currentSoi), true);
  assert.equal(scalar(`SELECT count(*) FROM ops.artifact_processing WHERE artifact_id = ${loaded} AND rule_version_id = ${olderSoi} AND outcome = 'LOADED'`), "1");

  const zip = rows("SELECT source_url, sha256 FROM raw.artifact WHERE source_url LIKE '%2099_12_bdc.zip'")[0].split("\t");
  assert.equal(registryZipStatus(dbName, { url: zip[0], sha256: zip[1] }, newerRegistry).outcome, "LOADED");
  const report = rows("SELECT source_url, sha256 FROM raw.artifact WHERE source_url LIKE '%TEST-ONLY-2019.csv'")[0].split("\t");
  assert.equal(registryZipStatus(dbName, { url: report[0], sha256: report[1] }, newerRegistry).outcome, null);
  assert.equal(alreadyProcessed(dbName, { url: report[0], sha256: report[1] }, currentRegistry), true);
  assert.equal(alreadyProcessed(dbName, { url: report[0], sha256: report[1] }, newerRegistry), false);
  assert.equal(alreadyProcessed(dbName, { url, sha256: null }, currentSoi), false);

  const beforeLoads = scalar("SELECT count(*) FROM raw.table_load WHERE table_code = 'SOI'");
  const filledId = scalar("SELECT id FROM raw.artifact WHERE source_url LIKE '%2099_12_bdc.zip'");
  insertProcessing(Number(filledId), olderSoi, "LOADED", runId);
  const priorRows = scalar(`SELECT count(*) FROM ops.artifact_processing WHERE artifact_id = ${filledId}`);
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });
  assert.equal(scalar(`SELECT count(*) FROM raw.table_load tl JOIN raw.artifact a ON a.id = tl.artifact_id WHERE tl.table_code = 'SOI' AND a.source_url LIKE '%2099_12_bdc.zip'`), "0");
  assert.equal(scalar("SELECT count(*) FROM obs.soi_row_observation"), "0");
  assert.equal(scalar(`SELECT count(*) FROM ops.artifact_processing p JOIN ops.rule_version r ON r.id = p.rule_version_id WHERE p.artifact_id = ${filledId} AND r.rule_code = 'pipeline.soi_load' AND r.version = '4'`), "0");
  assert.equal(scalar(`SELECT count(*) FROM ops.artifact_processing WHERE artifact_id = ${filledId}`), priorRows);
  assert.ok(Number(scalar("SELECT count(*) FROM raw.table_load WHERE table_code = 'SOI'")) > Number(beforeLoads));
  assert.equal(scalar(`SELECT r.version FROM ops.artifact_processing p
JOIN ops.rule_version r ON r.id = p.rule_version_id
JOIN raw.artifact a ON a.id = p.artifact_id
WHERE r.rule_code = 'pipeline.soi_load' AND a.source_url LIKE '%2099_11_bdc.zip'`), "4");
  assert.equal(scalar(`SELECT r.version FROM ops.coverage_assertion c
JOIN ops.rule_version r ON r.id = c.rule_version_id
WHERE r.rule_code = 'coverage.soi' LIMIT 1`), "3");
  assert.equal(scalar(`SELECT r.version FROM raw.table_load tl
JOIN ops.rule_version r ON r.id = tl.parser_rule_version_id
WHERE tl.table_code = 'SOI' LIMIT 1`), "1");
}));
