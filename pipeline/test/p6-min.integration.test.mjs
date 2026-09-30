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
import { applyP6Min, goldenEntityReport, snapshotP6Min } from "../load/p6-min.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { FAKE, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p6_${process.pid}`;
const NEAR = "TEST BORROWER A HOLDCO LLC | TEST LOAN 1";

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p6-"));
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

test("P6-min MATCHED exact Golden names and keeps a Holdco near-name UNRESOLVED", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir);
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const identIds = rows(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = '${FAKE.ident}'
    ORDER BY p.id`).map(Number);
  assert.ok(identIds.length >= 1);
  const nearPo = Number(scalar(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = 'TEST BORROWER B | TEST LOAN 2'
    ORDER BY p.id LIMIT 1`));
  const sha = createHash("sha256").update(FAKE.ident, "utf8").digest("hex");
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P6_GOLDEN', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  applyP4Min({
    database: dbName, positionObservationIds: identIds, runId, rules, identifierSha256: sha,
  });

  queryRows(dbName, `INSERT INTO obs.borrower_name_observation (
      position_observation_id, source_column_label, source_column_position,
      raw_text, normalized_text, extraction_state, rule_version_id, evidence_id, run_id)
    SELECT ${nearPo}, 'Investment, Identifier Axis',
           array_position(tl.header, 'Investment, Identifier Axis'),
           '${NEAR}', '${NEAR}', 'EXTRACTED', ${rules["norm.borrower_name"]}, s.evidence_id, ${runId}
    FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    JOIN raw.tabular_row r ON r.id = s.tabular_row_id
    JOIN raw.table_load tl ON tl.id = r.table_load_id
    WHERE p.id = ${nearPo};`);

  const before = snapshotP6Min(dbName, identIds);
  const inserted = applyP6Min({
    database: dbName,
    positionObservationIds: identIds,
    runId,
    rules,
    identifierSha256: sha,
    nearNamePositionObservationIds: [nearPo],
  });
  assert.equal(inserted.matched_inserted, identIds.length);
  assert.equal(inserted.near_name_unresolved_inserted, 1);
  assert.equal(inserted.near_name_candidates_inserted, 1);
  assert.equal(inserted.economic_group_rows, 0);
  assert.equal(inserted.group_membership_rows, 0);

  const after = snapshotP6Min(dbName, identIds);
  assert.equal(after.soi_row_observation_count, before.soi_row_observation_count);
  assert.equal(after.max_position_field_value_id, before.max_position_field_value_id);
  assert.equal(after.economic_group_count, 0);
  assert.equal(after.instrument_resolution_count, 0);
  assert.equal(Number(after.golden_matched), identIds.length);

  assert.equal(scalar(`SELECT count(*) FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id IN (${identIds.join(",")})
      AND d.state = 'MATCHED' AND d.method = 'EXACT_NORMALIZED_NAME'
      AND d.legal_entity_id = '${inserted.legal_entity_id}'::uuid
      AND d.actor_kind = 'SYSTEM_RULE'`), String(identIds.length));
  assert.equal(scalar(`SELECT count(*) FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id = ${nearPo}
      AND d.state = 'UNRESOLVED' AND d.legal_entity_id IS NULL
      AND d.method = 'NEAR_NAME_CANDIDATE' AND d.match_candidate_id IS NOT NULL`), "1");
  assert.equal(scalar(`SELECT count(*) FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id = ${nearPo} AND d.state = 'MATCHED'`), "0");
  assert.equal(scalar(`SELECT count(*) FROM resolution.current_entity_resolution d
    WHERE d.state = 'MATCHED' AND (d.method ILIKE '%fuzzy%' OR d.method ILIKE '%llm%')`), "0");
  assert.equal(scalar(`SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'identity' AND column_name ILIKE '%cik%'`), "0");
  assert.equal(scalar(`SELECT count(*) FROM identity.economic_group`), "0");
  assert.equal(scalar(`SELECT count(*) FROM resolution.instrument_resolution_decision`), "0");

  const gate = goldenEntityReport(dbName, identIds, inserted.legal_entity_id);
  assert.equal(gate.golden_decision_problems, 0);
  assert.equal(gate.golden_matched_to_entity, identIds.length);
  assert.equal(gate.golden_matched_other_entity, 0);
  assert.equal(gate.fuzzy_matched, 0);
  assert.equal(gate.identity_cik_columns, 0);
  assert.equal(gate.near_name_unresolved, 1);
  assert.equal(gate.economic_groups, 0);
  assert.equal(gate.head_forks, 0);

  const again = applyP6Min({
    database: dbName,
    positionObservationIds: identIds,
    runId,
    rules,
    identifierSha256: sha,
    nearNamePositionObservationIds: [nearPo],
  });
  assert.equal(again.matched_inserted, 0);
  assert.equal(again.near_name_unresolved_inserted, 0);
  assert.equal(again.legal_entity_id, inserted.legal_entity_id);
}));
