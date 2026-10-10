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
import { applyP6Min } from "../load/p6-min.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { EXACT_METHOD } from "../normalize/entity-name-match.mjs";
import {
  EXPECTED_COMPARISONS,
  EXPECTED_EXCLUDED_UNRESOLVED,
  EXPECTED_FACT_GROUPS,
  EXPECTED_NEW_BATCHES,
  EXPECTED_NEW_TARGET_OBSERVATIONS,
  EXPECTED_POSITION_OBSERVATIONS,
  EXPECTED_REUSE_BATCHES,
  EXPECTED_REUSE_MATCHED_OBSERVATIONS,
  EXPECTED_REUSE_TARGET_OBSERVATIONS,
  EXPECTED_TARGETS,
  applyP6ToBalanceEndpoints,
  assertIsolationSnapshot,
  assertLocal,
  assertPhaseA,
  assertResolvedOnce,
  planExactNameBatches,
} from "../p6-balance-endpoints.mjs";
import { FAKE, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p6bal_${process.pid}`;
const HOSTED = "postgres://example.invalid/bdc";

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
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline database tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p6bal-"));
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

function targetRow(id, rawText, overrides = {}) {
  return {
    id,
    rawText,
    normalizedText: rawText,
    nameRows: 1,
    decisionHeads: 0,
    decisionState: null,
    decisionMethod: null,
    legalEntityId: null,
    ...overrides,
  };
}

function reuseRow(id, rawText, legalEntityId) {
  return {
    id,
    rawText,
    normalizedText: rawText,
    legalEntityId,
    state: "MATCHED",
    method: EXACT_METHOD,
  };
}

function distribute(total, buckets) {
  const base = Math.floor(total / buckets);
  const extra = total % buckets;
  return Array.from({ length: buckets }, (_, index) => base + (index < extra ? 1 : 0));
}

// Synthetic Phase A population that matches the audited fixed-count gates without a local DB.
function phaseAPopulation() {
  const targets = [];
  const reuse = [];
  let nextId = 1;
  const newSizes = distribute(EXPECTED_NEW_TARGET_OBSERVATIONS, EXPECTED_NEW_BATCHES);
  for (let i = 0; i < EXPECTED_NEW_BATCHES; i += 1) {
    const name = `TEST NEW ISSUER ${i}`;
    for (let j = 0; j < newSizes[i]; j += 1) targets.push(targetRow(nextId++, name));
  }
  const reuseTargetSizes = distribute(EXPECTED_REUSE_TARGET_OBSERVATIONS, EXPECTED_REUSE_BATCHES);
  const reuseMatchedSizes = distribute(EXPECTED_REUSE_MATCHED_OBSERVATIONS, EXPECTED_REUSE_BATCHES);
  for (let i = 0; i < EXPECTED_REUSE_BATCHES; i += 1) {
    const name = `TEST REUSE ISSUER ${i}`;
    const entityId = `entity-${i}`;
    for (let j = 0; j < reuseTargetSizes[i]; j += 1) targets.push(targetRow(nextId++, name));
    for (let j = 0; j < reuseMatchedSizes[i]; j += 1) reuse.push(reuseRow(nextId++, name, entityId));
  }
  assert.equal(targets.length, EXPECTED_TARGETS);
  assert.equal(reuse.length, EXPECTED_REUSE_MATCHED_OBSERVATIONS);
  return {
    targets,
    reuse,
    unresolved_same_raw_outside: EXPECTED_EXCLUDED_UNRESOLVED,
  };
}

test("balance-endpoint P6 refuses a hosted database", () => {
  withHostedUrl(() => {
    assert.throws(() => assertLocal("bdc_local"), /refuses a hosted database/);
    assert.throws(
      () => applyP6ToBalanceEndpoints({ database: "bdc_local", dryRun: true, log() {} }),
      /refuses a hosted database/,
    );
  });
});

test("balance-endpoint P6 refuses a database other than the local database", () => {
  withLocalTarget(() => {
    assert.throws(() => assertLocal("other_db"), /refuses a database other than the local database/);
    assert.throws(
      () => applyP6ToBalanceEndpoints({ database: "other_db", dryRun: true, log() {} }),
      /refuses a database other than the local database/,
    );
  });
});

test("CLI balance-endpoint P6 refuses a disposable database name", withDb(async () => {
  withLocalTarget(() => {
    assert.throws(
      () => applyP6ToBalanceEndpoints({ database: dbName, dryRun: true, log() {} }),
      /refuses a database other than the local database/,
    );
  });
}));

test("Phase A refuses a count mismatch before any write", () => {
  const loaded = phaseAPopulation();
  loaded.targets.pop();
  assert.throws(() => assertPhaseA(loaded), /Phase A failed.*targets=/);
});

test("Phase A refuses when a target already has an entity decision", () => {
  const loaded = phaseAPopulation();
  loaded.targets[0].decisionHeads = 1;
  assert.throws(() => assertPhaseA(loaded), /already has an entity decision/);
});

test("Phase A accepts the audited fixed-count population shape", () => {
  const loaded = phaseAPopulation();
  const { batches, assessment } = assertPhaseA(loaded);
  assert.equal(batches.length, EXPECTED_NEW_BATCHES + EXPECTED_REUSE_BATCHES);
  assert.equal(assessment.entitiesToCreate, EXPECTED_NEW_BATCHES);
  assert.equal(assessment.entitiesToReuse, EXPECTED_REUSE_BATCHES);
  assert.equal(assessment.decisionsToInsert, EXPECTED_TARGETS);
  assert.equal(batches.filter((batch) => batch.mode === "reuse").length, EXPECTED_REUSE_BATCHES);
});

test("isolation snapshot refuses unexpected stored totals before writes", () => {
  assert.throws(
    () => assertIsolationSnapshot({
      economic_groups: 0,
      group_memberships: 0,
      comparisons: 0,
      fact_groups: 0,
      position_observations: 0,
    }),
    /refused unexpected stored totals/,
  );
  assert.throws(
    () => assertIsolationSnapshot({
      economic_groups: 1,
      group_memberships: 0,
      comparisons: EXPECTED_COMPARISONS,
      fact_groups: EXPECTED_FACT_GROUPS,
      position_observations: EXPECTED_POSITION_OBSERVATIONS,
    }),
    /economic group already exists/,
  );
  assert.doesNotThrow(() => assertIsolationSnapshot({
    economic_groups: 0,
    group_memberships: 0,
    comparisons: EXPECTED_COMPARISONS,
    fact_groups: EXPECTED_FACT_GROUPS,
    position_observations: EXPECTED_POSITION_OBSERVATIONS,
  }));
});

test("idempotent resolved-once check refuses a reuse name that moved entities", () => {
  const loaded = phaseAPopulation();
  const { batches } = assertPhaseA(loaded);
  const reuseBatch = batches.find((batch) => batch.mode === "reuse");
  assert.ok(reuseBatch);
  for (const row of loaded.targets) {
    row.decisionHeads = 1;
    row.decisionState = "MATCHED";
    row.decisionMethod = EXACT_METHOD;
    row.legalEntityId = row.rawText === reuseBatch.rawText ? "moved-entity" : `entity-for-${row.rawText}`;
  }
  assert.throws(() => assertResolvedOnce(loaded, batches), /moved off/);
});

test("applyP6Min keeps reuse targets on the planned legalEntityId", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir);
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const identIds = rows(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = '${FAKE.ident}'
    ORDER BY p.id`).map(Number);
  assert.ok(identIds.length >= 2);
  const seedIds = identIds.slice(0, 2);
  const targetId = seedIds[0];
  const reuseId = seedIds[1];
  const sha = createHash("sha256").update(FAKE.ident, "utf8").digest("hex");
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P6_BALANCE_ENDPOINT_TEST', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  applyP4Min({
    database: dbName, positionObservationIds: seedIds, runId, rules, identifierSha256: sha,
  });

  const seeded = applyP6Min({
    database: dbName,
    positionObservationIds: [reuseId],
    runId,
    rules,
    identifierSha256: sha,
    nearNamePositionObservationIds: [],
  });
  assert.equal(seeded.matched_inserted, 1);
  assert.ok(typeof seeded.legal_entity_id === "string" && seeded.legal_entity_id.length > 0);
  const plannedEntity = seeded.legal_entity_id;

  const nameRows = rows(`SELECT p.id::text, b.raw_text, b.normalized_text
FROM obs.position_observation p
JOIN obs.borrower_name_observation b ON b.position_observation_id = p.id
WHERE p.id IN (${seedIds.join(",")})
  AND b.source_column_label = 'Investment, Identifier Axis'
ORDER BY p.id`);
  assert.equal(nameRows.length, 2);
  const byId = new Map(nameRows.map((line) => {
    const [id, rawText, normalizedText] = line.split("\t");
    return [Number(id), { rawText, normalizedText }];
  }));
  assert.equal(byId.get(targetId).rawText, byId.get(targetId).normalizedText);
  assert.equal(byId.get(reuseId).rawText, byId.get(reuseId).normalizedText);
  assert.equal(byId.get(targetId).rawText, byId.get(reuseId).rawText);

  const batches = planExactNameBatches([
    { id: targetId, rawText: byId.get(targetId).rawText, normalizedText: byId.get(targetId).normalizedText },
  ], [
    {
      id: reuseId,
      rawText: byId.get(reuseId).rawText,
      normalizedText: byId.get(reuseId).normalizedText,
      legalEntityId: plannedEntity,
    },
  ]);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].mode, "reuse");
  assert.equal(batches[0].legalEntityId, plannedEntity);
  assert.deepEqual(batches[0].submittedIds, [targetId, reuseId].sort((left, right) => left - right));

  const applied = applyP6Min({
    database: dbName,
    positionObservationIds: batches[0].submittedIds,
    runId,
    rules,
    identifierSha256: batches[0].identifierSha256,
    nearNamePositionObservationIds: [],
  });
  assert.equal(applied.legal_entity_id, plannedEntity);
  assert.equal(applied.matched_inserted, 1);
  assert.equal(applied.near_name_unresolved_inserted, 0);
  assert.equal(applied.near_name_candidates_inserted, 0);
  assert.equal(
    scalar(`SELECT d.legal_entity_id::text FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
WHERE b.position_observation_id = ${targetId}`),
    plannedEntity,
  );
  assert.equal(
    scalar(`SELECT d.legal_entity_id::text FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
WHERE b.position_observation_id = ${reuseId}`),
    plannedEntity,
  );
  const afterWriteDecisions = Number(scalar("SELECT count(*) FROM resolution.entity_resolution_decision"));

  const again = applyP6Min({
    database: dbName,
    positionObservationIds: batches[0].submittedIds,
    runId,
    rules,
    identifierSha256: batches[0].identifierSha256,
    nearNamePositionObservationIds: [],
  });
  assert.equal(again.legal_entity_id, plannedEntity);
  assert.equal(again.matched_inserted, 0);
  assert.equal(again.near_name_unresolved_inserted, 0);
  assert.equal(again.near_name_candidates_inserted, 0);
  assert.equal(scalar("SELECT count(*) FROM resolution.entity_resolution_decision"), String(afterWriteDecisions));
  assert.equal(
    scalar(`SELECT count(*) FROM resolution.current_entity_resolution d
JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
WHERE b.position_observation_id IN (${targetId}, ${reuseId})
  AND d.state = 'MATCHED' AND d.legal_entity_id = '${plannedEntity}'`),
    "2",
  );
}));
