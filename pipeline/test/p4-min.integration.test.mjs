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
import { applyP4Min, snapshotP4Min } from "../load/p4-min.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { FAKE, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p4_${process.pid}`;

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p4-"));
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

test("P4-min writes borrower names only for selected synthetic observations", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir);
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const identIds = rows(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = '${FAKE.ident}'
    ORDER BY p.id`).map(Number);
  assert.ok(identIds.length >= 1);
  const otherBefore = scalar(`SELECT count(*) FROM obs.borrower_name_observation b
    JOIN obs.position_observation p ON p.id = b.position_observation_id
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw IS DISTINCT FROM '${FAKE.ident}'`);
  const before = snapshotP4Min(dbName, identIds);
  const sha = createHash("sha256").update(FAKE.ident, "utf8").digest("hex");
  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P4_GOLDEN', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  const inserted = applyP4Min({
    database: dbName,
    positionObservationIds: identIds,
    runId,
    rules,
    identifierSha256: sha,
  });
  assert.equal(inserted.identifier_name_inserted, identIds.length);
  assert.equal(inserted.issuer_name_inserted, 0);

  const after = snapshotP4Min(dbName, identIds);
  assert.equal(after.soi_row_observation_count, before.soi_row_observation_count);
  assert.equal(after.position_observation_count, before.position_observation_count);
  assert.equal(after.position_field_value_count, before.position_field_value_count);
  assert.equal(after.max_soi_row_observation_id, before.max_soi_row_observation_id);
  assert.equal(after.max_position_observation_id, before.max_position_observation_id);
  assert.equal(after.max_position_field_value_id, before.max_position_field_value_id);
  assert.equal(after.golden_borrower_name_count, identIds.length);
  assert.equal(scalar(`SELECT count(*) FROM obs.borrower_name_observation b
    JOIN obs.position_observation p ON p.id = b.position_observation_id
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw IS DISTINCT FROM '${FAKE.ident}'`), otherBefore);

  assert.equal(scalar(`SELECT count(*) FROM obs.borrower_name_observation
    WHERE position_observation_id IN (${identIds.join(",")})
      AND source_column_label = 'Investment, Identifier Axis'
      AND raw_text = '${FAKE.ident}'
      AND normalized_text = '${FAKE.ident}'
      AND extraction_state = 'EXTRACTED'
      AND rule_version_id = ${rules["norm.borrower_name"]}`), String(identIds.length));
  assert.equal(scalar("SELECT count(*) FROM resolution.entity_resolution_decision"), "0");
  assert.equal(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"), "0");

  const again = applyP4Min({
    database: dbName,
    positionObservationIds: identIds,
    runId,
    rules,
    identifierSha256: sha,
  });
  assert.equal(again.identifier_name_inserted, 0);
  assert.equal(snapshotP4Min(dbName, identIds).golden_borrower_name_count, identIds.length);
}));
