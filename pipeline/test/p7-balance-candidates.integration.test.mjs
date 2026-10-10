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
import { applyP4Min } from "../load/p4-min.mjs";
import { ensureAndLinkRuleForRun } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { SOI_FACT_GROUP_RULE } from "../normalize/soi-observation-group.mjs";
import { loadBalanceFactGroupCandidates } from "../p4-balance-candidates.mjs";
import {
  applyP7BalanceCandidateWrite,
  applyP7ToBalanceCandidates,
  P7_BALANCE_RULES,
} from "../p7-balance-candidates.mjs";
import { FAKE, p7Sources, p7UntypedSoiRows, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p7_bal_${process.pid}`;

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p7-bal-"));
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
          'v1:test-p7-balance-${balance.id}-${spread.id}')
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
  return { runId, ruleId: rule.id };
}

test("CLI balance P7 path refuses a disposable database name", withDb(async () => {
  assert.throws(
    () => applyP7ToBalanceCandidates({ database: dbName, dryRun: true, log() {} }),
    /refuses a database other than the local database/,
  );
}));

test("balance-candidate P7 write links catalog v2/v1 rules, inserts once, and reruns idempotently", withDb(async (_t, dataDir) => {
  // Same-filing SPREAD companion on Q3 so both typed FAKE.ident periods are genuine candidates.
  writeSyntheticTree(dataDir, p7Sources({
    extraSoi: p7UntypedSoiRows(FAKE.ident2, { cik1Q3: 1 }),
  }));
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const balanceQ1 = observation(FAKE.ident, "2099-03-31", { typeText: FAKE.typeFirst });
  const balanceQ3 = observation(FAKE.ident, "2099-09-30", { typeText: FAKE.typeFirst });
  const spreadQ1 = observation(FAKE.ident2, "2099-03-31", { typeText: FAKE.typeSecond });
  const spreadQ3 = observation(FAKE.ident2, "2099-09-30");
  assert.equal(balanceQ1.filingId, spreadQ1.filingId);
  assert.equal(balanceQ3.filingId, spreadQ3.filingId);
  seedBalanceSpreadGroup(balanceQ1, spreadQ1);
  seedBalanceSpreadGroup(balanceQ3, spreadQ3);

  const candidates = loadBalanceFactGroupCandidates(dbName);
  const writeIds = candidates.map((row) => row.id).sort((left, right) => left - right);
  assert.deepEqual(writeIds, [balanceQ1.id, balanceQ3.id].sort((left, right) => left - right));
  assert.ok(candidates.every((row) => row.identifierRaw === FAKE.ident));

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

  const beforeInstruments = Number(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"));
  const beforeContinuity = Number(scalar("SELECT count(*) FROM resolution.position_continuity_decision"));
  const beforeInstrumentIds = Number(scalar("SELECT count(*) FROM identity.instrument"));
  const beforePositions = Number(scalar("SELECT count(*) FROM identity.position"));

  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P7_BALANCE_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true,"mode":"insert"}'::jsonb, now()) RETURNING id;`)[0][0]);
  const first = applyP7BalanceCandidateWrite({
    database: dbName,
    positionObservationIds: writeIds,
    runId,
    dataDir,
  });

  const linked = rows(`
SELECT rv.rule_code, rv.version, rv.id::text
FROM ops.run_rule_version rr
JOIN ops.rule_version rv ON rv.id = rr.rule_version_id
WHERE rr.run_id = ${runId}
ORDER BY rv.rule_code`);
  assert.deepEqual(
    linked.map(([code, version]) => ({ code, version })),
    [...P7_BALANCE_RULES].sort((a, b) => a.code.localeCompare(b.code)),
  );
  assert.equal(
    linked.find(([code]) => code === "norm.instrument_type_footnote_ref")?.[1],
    "1",
  );
  assert.ok(linked.every(([code, version]) => !code.startsWith("resolution.") || version === "2"));
  const ruleIdByCode = Object.fromEntries(linked.map(([code, , id]) => [code, Number(id)]));

  assert.equal(first.instrument_matched_inserted, 2);
  assert.equal(first.continuity_matched_inserted, 2);
  assert.equal(first.instrument_unresolved_inserted, 0);
  assert.equal(first.continuity_unresolved_inserted, 0);
  assert.equal(first.instruments_created, 1);
  assert.equal(first.positions_created, 1);

  assert.equal(Number(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision")), beforeInstruments + 2);
  assert.equal(Number(scalar("SELECT count(*) FROM resolution.position_continuity_decision")), beforeContinuity + 2);
  assert.equal(Number(scalar("SELECT count(*) FROM identity.instrument")), beforeInstrumentIds + 1);
  assert.equal(Number(scalar("SELECT count(*) FROM identity.position")), beforePositions + 1);
  assert.equal(scalar(`
SELECT count(DISTINCT d.instrument_id)::text
FROM resolution.current_instrument_resolution d
WHERE d.position_observation_id IN (${writeIds.join(",")})
  AND d.state = 'MATCHED'`), "1");
  assert.equal(scalar(`
SELECT count(DISTINCT d.position_id)::text
FROM resolution.current_position_continuity d
WHERE d.position_observation_id IN (${writeIds.join(",")})
  AND d.state = 'MATCHED'`), "1");
  assert.equal(scalar(`
SELECT count(*)::text
FROM resolution.current_instrument_resolution d
WHERE d.position_observation_id IN (${spreadQ1.id}, ${spreadQ3.id})`), "0");

  assert.equal(scalar(`
SELECT count(*)::text
FROM resolution.instrument_resolution_decision d
JOIN ops.rule_version rv ON rv.id = d.rule_version_id
JOIN obs.position_observation p ON p.id = d.position_observation_id
WHERE d.run_id = ${runId}
  AND d.position_observation_id IN (${writeIds.join(",")})
  AND d.state = 'MATCHED'
  AND d.rule_version_id = ${ruleIdByCode["resolution.instrument_exact_identifier_and_type"]}
  AND rv.rule_code = 'resolution.instrument_exact_identifier_and_type'
  AND rv.version = '2'
  AND d.evidence_id = p.evidence_id`), "2");
  assert.equal(scalar(`
SELECT count(*)::text
FROM resolution.position_continuity_decision d
JOIN ops.rule_version rv ON rv.id = d.rule_version_id
JOIN obs.position_observation p ON p.id = d.position_observation_id
WHERE d.run_id = ${runId}
  AND d.position_observation_id IN (${writeIds.join(",")})
  AND d.state = 'MATCHED'
  AND d.rule_version_id = ${ruleIdByCode["resolution.position_same_registrant_and_instrument"]}
  AND rv.rule_code = 'resolution.position_same_registrant_and_instrument'
  AND rv.version = '2'
  AND d.evidence_id = p.evidence_id`), "2");

  const againRun = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P7_BALANCE_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true,"mode":"idempotent"}'::jsonb, now()) RETURNING id;`)[0][0]);
  const second = applyP7BalanceCandidateWrite({
    database: dbName,
    positionObservationIds: writeIds,
    runId: againRun,
    dataDir,
  });
  assert.equal(second.instrument_matched_inserted, 0);
  assert.equal(second.continuity_matched_inserted, 0);
  assert.equal(second.instruments_created, 0);
  assert.equal(second.positions_created, 0);
  assert.equal(Number(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision")), beforeInstruments + 2);
  assert.equal(Number(scalar("SELECT count(*) FROM resolution.position_continuity_decision")), beforeContinuity + 2);
  assert.equal(Number(scalar("SELECT count(*) FROM identity.instrument")), beforeInstrumentIds + 1);
  assert.equal(Number(scalar("SELECT count(*) FROM identity.position")), beforePositions + 1);
  assert.equal(scalar(`
SELECT count(*)::text
FROM resolution.instrument_resolution_decision
WHERE run_id = ${againRun}`), "0");
  assert.equal(scalar(`
SELECT count(*)::text
FROM resolution.position_continuity_decision
WHERE run_id = ${againRun}`), "0");
}));

test("balance-candidate P7 write refuses an empty observation list", withDb(async () => {
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P7_BALANCE_FACT_GROUP', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  assert.throws(
    () => applyP7BalanceCandidateWrite({
      database: dbName,
      positionObservationIds: [],
      runId,
    }),
    /requires at least one observation/,
  );
}));
