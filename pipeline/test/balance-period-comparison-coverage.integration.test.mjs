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
  evaluateBalancePeriodComparisonCoverage,
  loadBalancePeriodComparisonCoverage,
  reportBalancePeriodComparisonCoverage,
} from "../balance-period-comparison-coverage.mjs";
import { applyP4Min } from "../load/p4-min.mjs";
import { ensureAndLinkRuleForRun } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { SOI_FACT_GROUP_RULE } from "../normalize/soi-observation-group.mjs";
import { loadBalanceFactGroupCandidates } from "../p4-balance-candidates.mjs";
import { applyP7BalanceCandidateWrite } from "../p7-balance-candidates.mjs";
import { FAKE, p7Sources, p7UntypedSoiRows, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_bal_cmp_${process.pid}`;

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-bal-cmp-"));
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
           AND tv.value_state = 'REPORTED'
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
          'v1:test-bal-cmp-${balance.id}-${spread.id}')
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
  const nameRun = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P4_BALANCE_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const nameRule = ensureAndLinkRuleForRun(dbName, nameRun, { code: "norm.borrower_name", version: "1" });
  applyP4Min({
    database: dbName,
    positionObservationIds: writeIds,
    runId: nameRun,
    rules: { "norm.borrower_name": nameRule.id },
    identifierSha256: createHash("sha256").update(FAKE.ident, "utf8").digest("hex"),
  });

  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P7_BALANCE_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  applyP7BalanceCandidateWrite({
    database: dbName,
    positionObservationIds: writeIds,
    runId,
    dataDir,
  });
  return { balanceQ1, balanceQ3, spreadQ3, writeIds };
}

const disposablePins = (overrides = {}) => ({
  eligibleSeries: 1,
  seriesWithComparison: 1,
  seriesMissingComparison: 0,
  balanceComparisonRows: 1,
  legacyComparisons: 0,
  totalComparisons: 1,
  ...overrides,
});

/** Supersede PRINCIPAL_AMOUNT heads with coded currency so the view can be COMPARABLE. */
function setPrincipalCurrency(observationIds, currencyCode = "USD") {
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST_PRINCIPAL_CURRENCY', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  for (const observationId of observationIds) {
    const prior = rows(`
SELECT id::text, evidence_id::text, normalization_rule_version_id::text,
       coalesce(source_column_label, ''), coalesce(source_column_position::text, ''),
       coalesce(column_mapping_id::text, ''),
       coalesce(raw_value, ''), coalesce(normalized_numeric::text, ''),
       scale_state::text
FROM obs.current_position_field_value
WHERE position_observation_id = ${observationId} AND field_code = 'PRINCIPAL_AMOUNT'`);
    assert.equal(prior.length, 1, `principal head for ${observationId}`);
    const [id, evidenceId, ruleId, label, position, mappingId, raw, numeric, scale] = prior[0];
    const labelSql = label === "" ? "NULL" : `'${label.replaceAll("'", "''")}'`;
    const positionSql = position === "" ? "NULL" : position;
    const mappingSql = mappingId === "" ? "NULL" : mappingId;
    queryRows(dbName, `
INSERT INTO obs.position_field_value (
  position_observation_id, field_code, column_mapping_id, source_column_label, source_column_position,
  raw_value, normalized_numeric, currency_code, currency_state, scale_state, value_state,
  normalization_rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason
) VALUES (
  ${observationId}, 'PRINCIPAL_AMOUNT', ${mappingSql}, ${labelSql}, ${positionSql},
  '${raw.replaceAll("'", "''")}', ${numeric}, '${currencyCode}', 'FROM_FILING', '${scale}'::ref.scale_state, 'REPORTED',
  ${ruleId}, ${evidenceId}, ${runId}, ${id},
  'TEST ONLY establish principal currency for coverage gate'
);`);
  }
}

test("CLI coverage path refuses a disposable database name", withDb(async () => {
  assert.throws(
    () => reportBalancePeriodComparisonCoverage({ database: dbName, dryRun: true, log() {} }),
    /refuses a database other than the local database/,
  );
}));

test("coverage reports a present COMPARABLE pair with provenance after P7", withDb(async (_t, dataDir) => {
  const { balanceQ1, balanceQ3 } = await seedMatchedBalancePair(dataDir);
  // Synthetic SOI principals load with UNKNOWN currency; 0059 requires coded currency for COMPARABLE.
  setPrincipalCurrency([balanceQ1.id, balanceQ3.id], "USD");

  const coverage = loadBalancePeriodComparisonCoverage(dbName);
  assert.equal(coverage.eligibleSeries, 1);
  assert.equal(coverage.seriesWithComparison, 1);
  assert.equal(coverage.seriesMissingComparison, 0);
  assert.equal(coverage.balanceComparisonRows, 1);
  assert.equal(coverage.missingProvenanceRows, 0);
  assert.equal(coverage.seriesWithDuplicateComparisons, 0);
  assert.equal(coverage.conflictingPairRows, 0);
  assert.equal(coverage.principalComparable, 1);
  assert.equal(coverage.principalInsufficientData, 0);
  assert.deepEqual(evaluateBalancePeriodComparisonCoverage(coverage, disposablePins({
    totalComparisons: coverage.totalComparisons,
    legacyComparisons: coverage.legacyComparisons,
  })), []);

  const pair = rows(`
SELECT earlier_accession_number, later_accession_number,
       earlier_observation_evidence_id::text, later_observation_evidence_id::text,
       principal_comparison_state, principal_delta::text
FROM registry.position_period_comparison c
WHERE c.position_id IN (
  SELECT d.position_id
  FROM resolution.current_position_continuity d
  JOIN obs.position_observation_group_member m ON m.position_observation_id = d.position_observation_id
  JOIN obs.position_observation_group g ON g.id = m.group_id
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
  WHERE rv.rule_code = '${SOI_FACT_GROUP_RULE.code}' AND rv.version = '${SOI_FACT_GROUP_RULE.version}'
    AND m.member_role = 'BALANCE' AND d.state = 'MATCHED'
)`);
  assert.equal(pair.length, 1);
  assert.ok(pair[0][0] && pair[0][1], "accessions present");
  assert.ok(pair[0][2] && pair[0][3], "evidence ids present");
  assert.equal(pair[0][4], "COMPARABLE");
  assert.equal(pair[0][5], "0");
}));

test("coverage reports INSUFFICIENT_DATA when principal currency is UNKNOWN", withDb(async (_t, dataDir) => {
  // Natural synthetic load: REPORTED principal with UNKNOWN currency → INSUFFICIENT_DATA (0059).
  await seedMatchedBalancePair(dataDir);

  const coverage = loadBalancePeriodComparisonCoverage(dbName);
  assert.equal(coverage.eligibleSeries, 1);
  assert.equal(coverage.seriesWithComparison, 1);
  assert.equal(coverage.principalComparable, 0);
  assert.equal(coverage.principalInsufficientData, 1);
  assert.equal(coverage.missingProvenanceRows, 0);
  assert.deepEqual(evaluateBalancePeriodComparisonCoverage(coverage, disposablePins({
    totalComparisons: coverage.totalComparisons,
    legacyComparisons: coverage.legacyComparisons,
  })), []);
}));

test("coverage reports a series missing its comparison row when a same-date MATCHED blocks the endpoint", withDb(async (_t, dataDir) => {
  const { balanceQ3, spreadQ3 } = await seedMatchedBalancePair(dataDir);

  // Match the same-date SPREAD companion onto the balance position. The view then
  // sees two MATCHED observations on the later date and drops the pair, while the
  // balance-only series definition still counts the series as eligible.
  const positionId = scalar(`
SELECT position_id::text FROM resolution.current_position_continuity
WHERE position_observation_id = ${balanceQ3.id} AND state = 'MATCHED'`);
  const instrumentId = scalar(`
SELECT instrument_id::text FROM resolution.current_instrument_resolution
WHERE position_observation_id = ${balanceQ3.id} AND state = 'MATCHED'`);
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST_BLOCK_ENDPOINT', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const instrumentRule = ensureAndLinkRuleForRun(dbName, runId, {
    code: "resolution.instrument_exact_identifier_and_type", version: "2",
  });
  const continuityRule = ensureAndLinkRuleForRun(dbName, runId, {
    code: "resolution.position_same_registrant_and_instrument", version: "2",
  });
  queryRows(dbName, `
INSERT INTO resolution.instrument_resolution_decision (
  position_observation_id, instrument_id, state, method, rationale, actor_kind,
  decided_by, decided_at, rule_version_id, evidence_id, run_id
) VALUES (
  ${spreadQ3.id}, '${instrumentId}'::uuid, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE',
  'TEST ONLY blocker instrument', 'SYSTEM_RULE', 'test', now(),
  ${instrumentRule.id}, ${spreadQ3.evidenceId}, ${runId}
);
INSERT INTO resolution.position_continuity_decision (
  position_observation_id, position_id, state, method, rationale, actor_kind,
  decided_by, decided_at, rule_version_id, evidence_id, run_id
) VALUES (
  ${spreadQ3.id}, '${positionId}'::uuid, 'MATCHED', 'SAME_REGISTRANT_AND_INSTRUMENT',
  'TEST ONLY blocker continuity', 'SYSTEM_RULE', 'test', now(),
  ${continuityRule.id}, ${spreadQ3.evidenceId}, ${runId}
);`);

  assert.equal(scalar(`
SELECT count(*)::text FROM registry.position_period_comparison
WHERE position_id = '${positionId}'::uuid`), "0");

  const coverage = loadBalancePeriodComparisonCoverage(dbName);
  assert.equal(coverage.eligibleSeries, 1);
  assert.equal(coverage.seriesWithComparison, 0);
  assert.equal(coverage.seriesMissingComparison, 1);
  assert.equal(coverage.balanceComparisonRows, 0);
  const failures = evaluateBalancePeriodComparisonCoverage(coverage, disposablePins({
    totalComparisons: coverage.totalComparisons,
    legacyComparisons: coverage.legacyComparisons,
  }));
  assert.ok(failures.some((line) => line.includes("seriesMissingComparison=1")));
  assert.ok(failures.some((line) => line.includes("seriesWithComparison=0")));
}));

test("dry-run reports unexpected totals without throwing; strict mode throws", withDb(async (_t, dataDir) => {
  await seedMatchedBalancePair(dataDir);
  const wrongPins = disposablePins({
    eligibleSeries: 99,
    totalComparisons: undefined,
    legacyComparisons: undefined,
  });
  // Keep legacy/total unpinned for disposable scale; only force an unexpected eligible count.
  delete wrongPins.totalComparisons;
  delete wrongPins.legacyComparisons;

  const dry = reportBalancePeriodComparisonCoverage({
    database: dbName,
    dryRun: true,
    assertDatabase: false,
    pins: {
      eligibleSeries: 99,
      seriesWithComparison: 1,
      seriesMissingComparison: 0,
      balanceComparisonRows: 1,
    },
    log() {},
  });
  assert.equal(dry.ok, false);
  assert.ok(dry.failures.some((line) => line.includes("eligibleSeries=1 expected=99")));

  assert.throws(
    () => reportBalancePeriodComparisonCoverage({
      database: dbName,
      dryRun: false,
      assertDatabase: false,
      pins: {
        eligibleSeries: 99,
        seriesWithComparison: 1,
        seriesMissingComparison: 0,
        balanceComparisonRows: 1,
      },
      log() {},
    }),
    /balance period-comparison coverage failed/,
  );
}));
