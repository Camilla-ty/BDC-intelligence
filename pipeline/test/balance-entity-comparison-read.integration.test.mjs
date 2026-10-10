import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  evaluateBalanceEntityComparisonRead,
  loadBalanceEntityComparisonRead,
  reportBalanceEntityComparisonRead,
} from "../balance-entity-comparison-read.mjs";
import { applyP4Min } from "../load/p4-min.mjs";
import { applyP6Min } from "../load/p6-min.mjs";
import { ensureAndLinkRuleForRun, registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { SOI_FACT_GROUP_RULE } from "../normalize/soi-observation-group.mjs";
import { loadBalanceFactGroupCandidates } from "../p4-balance-candidates.mjs";
import { applyP7BalanceCandidateWrite } from "../p7-balance-candidates.mjs";
import { FAKE, p7Sources, p7UntypedSoiRows, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_ent_cmp_${process.pid}`;

function rows(sql) {
  return query(dbName, sql).map((line) => String(line).split("\t"));
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  assert.equal(found[0].length, 1, `expected one column from: ${sql}`);
  return found[0][0];
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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-ent-cmp-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(t, dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function observation(identifier, reportedDate, { typeText = null } = {}) {
  const typeFilter = typeText == null
    ? ""
    : `AND EXISTS (
         SELECT 1 FROM obs.current_position_field_value tv
         WHERE tv.position_observation_id = p.id
           AND tv.field_code = 'INSTRUMENT_TYPE'
           AND tv.raw_value = '${typeText}'
       )`;
  const found = rows(`
SELECT p.id::text, p.filing_id::text, fv.evidence_id::text, s.identifier_raw
FROM obs.position_observation p
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
JOIN obs.current_position_field_value fv
  ON fv.position_observation_id = p.id AND fv.field_code = 'PRINCIPAL_AMOUNT'
WHERE s.identifier_raw = '${identifier}' AND p.reported_date = DATE '${reportedDate}'
  ${typeFilter}
ORDER BY p.id`);
  assert.ok(found.length >= 1, `missing observation ${identifier} ${reportedDate}`);
  return {
    id: Number(found[0][0]),
    filingId: Number(found[0][1]),
    evidenceId: Number(found[0][2]),
    identifierRaw: found[0][3],
  };
}

function seedBalanceSpreadGroup(balance, spread) {
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('SOI_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rule = ensureAndLinkRuleForRun(dbName, runId, SOI_FACT_GROUP_RULE);
  queryRows(dbName, `
BEGIN;
WITH g AS (
  INSERT INTO obs.position_observation_group
    (filing_id, state, rationale, rule_version_id, run_id, grouping_key)
  VALUES (${balance.filingId}, 'UNRESOLVED', 'TEST ONLY balance-spread group', ${rule.id}, ${runId},
          'v1:test-ent-cmp-${balance.id}-${spread.id}')
  RETURNING id
)
INSERT INTO obs.position_observation_group_member
  (group_id, position_observation_id, member_role, evidence_id, run_id)
SELECT g.id, m.position_observation_id, m.member_role::obs.soi_fact_member_role, m.evidence_id, ${runId}
FROM g
JOIN (VALUES
  (${balance.id}, 'BALANCE', ${balance.evidenceId}),
  (${spread.id}, 'SPREAD', ${spread.evidenceId})
) AS m (position_observation_id, member_role, evidence_id) ON true;
COMMIT;`);
}

async function seedMatchedBalancePair(dataDir) {
  writeSyntheticTree(dataDir, p7Sources({
    extraSoi: p7UntypedSoiRows(FAKE.ident2, { cik1Q3: 1 }),
  }));
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const balanceQ1 = observation(FAKE.ident, "2099-03-31", { typeText: FAKE.typeFirst });
  const balanceQ3 = observation(FAKE.ident, "2099-09-30", { typeText: FAKE.typeFirst });
  const spreadQ1 = observation(FAKE.ident2, "2099-03-31", { typeText: FAKE.typeSecond });
  const spreadQ3 = observation(FAKE.ident2, "2099-09-30");
  seedBalanceSpreadGroup(balanceQ1, spreadQ1);
  seedBalanceSpreadGroup(balanceQ3, spreadQ3);

  const writeIds = loadBalanceFactGroupCandidates(dbName).map((row) => row.id);
  const sha = createHash("sha256").update(FAKE.ident, "utf8").digest("hex");
  const nameRun = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P4_BALANCE_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const nameRule = ensureAndLinkRuleForRun(dbName, nameRun, { code: "norm.borrower_name", version: "1" });
  applyP4Min({
    database: dbName,
    positionObservationIds: writeIds,
    runId: nameRun,
    rules: { "norm.borrower_name": nameRule.id },
    identifierSha256: sha,
  });

  const p7Run = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P7_BALANCE_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  applyP7BalanceCandidateWrite({
    database: dbName,
    positionObservationIds: writeIds,
    runId: p7Run,
    dataDir,
  });
  return { balanceQ1, balanceQ3, writeIds, sha };
}

function matchEntity(observationIds, sha) {
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P6_ENTITY_CMP_TEST', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  return applyP6Min({
    database: dbName,
    positionObservationIds: observationIds,
    runId,
    rules,
    identifierSha256: sha,
    nearNamePositionObservationIds: [],
  });
}

const disposablePins = (overrides = {}) => ({
  balanceComparisonRows: 1,
  retrievableSeries: 1,
  seriesMissingFromReader: 0,
  seriesMissingEntityMapping: 0,
  seriesCrossEntityMismatch: 0,
  seriesAmbiguousEntityMapping: 0,
  distinctEntities: 1,
  provenanceMismatches: 0,
  outcomeMismatches: 0,
  duplicateReaderRows: 0,
  crossEntityLeaks: 0,
  ...overrides,
});

test("CLI entity-comparison read refuses a disposable database name", withDb(async () => {
  assert.throws(
    () => reportBalanceEntityComparisonRead({ database: dbName, dryRun: true, log() {} }),
    /refuses a database other than the local database/,
  );
}));

test("entity reader retrieves the balance pair for the MATCHED legal entity with provenance", withDb(async (_t, dataDir) => {
  const { balanceQ1, balanceQ3, writeIds, sha } = await seedMatchedBalancePair(dataDir);
  const matched = matchEntity(writeIds, sha);
  assert.ok(matched.legal_entity_id);
  assert.equal(matched.matched_inserted, 2);

  const coverage = loadBalanceEntityComparisonRead(dbName);
  assert.equal(coverage.balanceComparisonRows, 1);
  assert.equal(coverage.seriesSameEntityMapped, 1);
  assert.equal(coverage.seriesMissingEntityMapping, 0);
  assert.equal(coverage.seriesCrossEntityMismatch, 0);
  assert.equal(coverage.retrievableSeries, 1);
  assert.equal(coverage.seriesMissingFromReader, 0);
  assert.equal(coverage.provenanceMismatches, 0);
  assert.equal(coverage.outcomeMismatches, 0);
  assert.equal(coverage.distinctEntities, 1);
  assert.deepEqual(evaluateBalanceEntityComparisonRead(coverage, disposablePins()), []);

  const viaFn = rows(`
SELECT earlier_accession_number, later_accession_number,
       earlier_observation_evidence_id, later_observation_evidence_id,
       earlier_position_observation_id, later_position_observation_id,
       legal_entity_id, principal_comparison_state
FROM registry.borrower_position_comparisons('${matched.legal_entity_id}'::uuid)`);
  assert.equal(viaFn.length, 1);
  assert.ok(viaFn[0][0] && viaFn[0][1], "accessions preserved");
  assert.ok(viaFn[0][2] && viaFn[0][3], "evidence ids preserved");
  assert.deepEqual(
    [Number(viaFn[0][4]), Number(viaFn[0][5])].sort((a, b) => a - b),
    [balanceQ1.id, balanceQ3.id].sort((a, b) => a - b),
  );
  assert.equal(viaFn[0][6], matched.legal_entity_id);
  assert.ok(["COMPARABLE", "INSUFFICIENT_DATA"].includes(viaFn[0][7]));
}));

test("missing entity mapping is reported and fails the pin check", withDb(async (_t, dataDir) => {
  await seedMatchedBalancePair(dataDir);
  // P4 names exist but no P6 MATCHED entity → not retrievable through the entity reader.
  const coverage = loadBalanceEntityComparisonRead(dbName);
  assert.equal(coverage.balanceComparisonRows, 1);
  assert.equal(coverage.seriesMissingEntityMapping, 1);
  assert.equal(coverage.seriesSameEntityMapped, 0);
  assert.equal(coverage.retrievableSeries, 0);
  const failures = evaluateBalanceEntityComparisonRead(coverage, disposablePins({
    seriesMissingEntityMapping: 0,
    seriesSameEntityMapped: undefined,
    retrievableSeries: 1,
    distinctEntities: 1,
  }));
  assert.ok(failures.some((line) => line.includes("seriesMissingEntityMapping=1")));
  assert.ok(failures.some((line) => line.includes("retrievableSeries=0")));
}));

test("cross-entity mismatch keeps the pair out of the entity reader", withDb(async (_t, dataDir) => {
  const { balanceQ3, writeIds, sha } = await seedMatchedBalancePair(dataDir);
  const matched = matchEntity(writeIds, sha);
  const entityA = matched.legal_entity_id;

  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P6_CROSS_ENTITY_TEST', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const entityRule = ensureAndLinkRuleForRun(dbName, runId, {
    code: "resolution.entity_exact_normalized_name", version: "1",
  });
  const nameId = scalar(`
SELECT b.id::text FROM obs.current_borrower_name_observation b
WHERE b.position_observation_id = ${balanceQ3.id}
  AND b.source_column_label = 'Investment, Identifier Axis'`);
  const prior = scalar(`
SELECT d.id::text FROM resolution.current_entity_resolution d
WHERE d.borrower_name_observation_id = ${nameId}`);
  const newEntity = scalar(`
INSERT INTO identity.legal_entity (id, creation_reason, run_id)
VALUES (gen_random_uuid(), 'TEST ONLY cross-entity', ${runId})
RETURNING id::text`);
  const evidenceId = scalar(`
SELECT evidence_id::text FROM obs.borrower_name_observation WHERE id = ${nameId}`);
  queryRows(dbName, `
INSERT INTO resolution.entity_resolution_decision (
  borrower_name_observation_id, legal_entity_id, state, method, rationale, actor_kind,
  decided_by, decided_at, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason
) VALUES (
  ${nameId}, '${newEntity}'::uuid, 'MATCHED', 'EXACT_NORMALIZED_NAME',
  'TEST ONLY cross-entity later endpoint', 'SYSTEM_RULE', 'test', now(),
  ${entityRule.id}, ${evidenceId}, ${runId}, ${prior},
  'TEST ONLY move later endpoint to another legal entity'
);`);
  assert.notEqual(entityA, newEntity);

  const coverage = loadBalanceEntityComparisonRead(dbName);
  assert.equal(coverage.balanceComparisonRows, 1);
  assert.equal(coverage.seriesCrossEntityMismatch, 1);
  assert.equal(coverage.seriesSameEntityMapped, 0);
  assert.equal(coverage.retrievableSeries, 0);
  assert.equal(scalar(`
SELECT count(*)::text FROM registry.borrower_position_comparisons('${entityA}'::uuid)`), "0");
  assert.equal(scalar(`
SELECT count(*)::text FROM registry.borrower_position_comparisons('${newEntity}'::uuid)`), "0");
  const failures = evaluateBalanceEntityComparisonRead(coverage, disposablePins());
  assert.ok(failures.some((line) => line.includes("seriesCrossEntityMismatch=1")));
}));

test("dry-run reports unexpected totals without throwing; strict mode throws", withDb(async (_t, dataDir) => {
  const { writeIds, sha } = await seedMatchedBalancePair(dataDir);
  matchEntity(writeIds, sha);

  const dry = reportBalanceEntityComparisonRead({
    database: dbName,
    dryRun: true,
    assertDatabase: false,
    pins: disposablePins({ distinctEntities: 99 }),
    log() {},
  });
  assert.equal(dry.ok, false);
  assert.ok(dry.failures.some((line) => line.includes("distinctEntities=1 expected=99")));

  assert.throws(
    () => reportBalanceEntityComparisonRead({
      database: dbName,
      dryRun: false,
      assertDatabase: false,
      pins: disposablePins({ distinctEntities: 99 }),
      log() {},
    }),
    /balance entity-comparison read failed/,
  );
}));
