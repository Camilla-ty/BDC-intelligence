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
import { applyP7Min, goldenInstrumentReport, snapshotP7Min } from "../load/p7-min.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion } from "../load/run.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { continuityGaps } from "../normalize/instrument-identity.mjs";
import { FAKE, p7Sources, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_p7_${process.pid}`;

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p7-"));
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

function idsForIdent(ident) {
  return rows(`SELECT p.id FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    WHERE s.identifier_raw = '${ident}'
    ORDER BY p.id`).map(Number);
}

test("P7-min MATCHED typed instruments, keeps unknown type UNRESOLVED, and separates BDC series", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir, p7Sources());
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const identA = idsForIdent(FAKE.ident);
  const ident2 = idsForIdent(FAKE.ident2);
  assert.ok(identA.length >= 3);
  assert.equal(ident2.length, 1);

  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P7_GOLDEN', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  applyP4Min({
    database: dbName, positionObservationIds: identA, runId, rules,
    identifierSha256: createHash("sha256").update(FAKE.ident, "utf8").digest("hex"),
  });
  applyP4Min({
    database: dbName, positionObservationIds: ident2, runId, rules,
    identifierSha256: createHash("sha256").update(FAKE.ident2, "utf8").digest("hex"),
  });
  applyP6Min({
    database: dbName, positionObservationIds: identA, runId, rules,
    identifierSha256: createHash("sha256").update(FAKE.ident, "utf8").digest("hex"),
  });

  const allIds = [...identA, ...ident2];
  const before = snapshotP7Min(dbName, allIds);
  const inserted = applyP7Min({ database: dbName, positionObservationIds: allIds, runId, rules });
  const after = snapshotP7Min(dbName, allIds);
  assert.equal(after.soi_row_observation_count, before.soi_row_observation_count);
  assert.equal(after.max_position_field_value_id, before.max_position_field_value_id);
  assert.equal(after.economic_group_count, 0);
  assert.equal(after.derived_value_input_count, 0);

  const typedA = rows(`SELECT p.id::text FROM obs.position_observation p
    JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
    JOIN obs.current_position_field_value fv ON fv.position_observation_id = p.id
    WHERE s.identifier_raw = '${FAKE.ident}' AND fv.field_code = 'INSTRUMENT_TYPE'
      AND fv.value_state = 'REPORTED' AND fv.raw_value = '${FAKE.typeFirst}'
    ORDER BY p.id`);
  const untypedA = identA.filter((id) => !typedA.includes(String(id)));
  assert.ok(typedA.length >= 3, `typed A rows: ${typedA.length}`);
  assert.ok(untypedA.length >= 1);

  assert.equal(scalar(`SELECT count(*) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${untypedA.join(",")})
      AND d.state = 'UNRESOLVED' AND d.instrument_id IS NULL
      AND d.method = 'UNKNOWN_INSTRUMENT_ATTRIBUTES'`), String(untypedA.length));
  assert.equal(scalar(`SELECT count(DISTINCT d.instrument_id) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${typedA.join(",")})
      AND d.state = 'MATCHED' AND d.method = 'EXACT_IDENTIFIER_AND_TYPE'`), "1");
  assert.equal(scalar(`SELECT count(*) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id = ${ident2[0]} AND d.state = 'MATCHED'`), "1");
  assert.equal(scalar(`SELECT count(DISTINCT d.instrument_id) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${[...typedA, ident2[0]].join(",")}) AND d.state = 'MATCHED'`), "2");

  assert.equal(scalar(`SELECT count(DISTINCT d.position_id) FROM resolution.current_position_continuity d
    JOIN obs.position_observation p ON p.id = d.position_observation_id
    JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id
    WHERE d.position_observation_id IN (${typedA.join(",")}) AND d.state = 'MATCHED'`), "2");

  const cik1Dates = rows(`SELECT DISTINCT p.reported_date
    FROM obs.position_observation p
    JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id
    JOIN registry.registrant r ON r.id = fr.registrant_id
    WHERE p.id IN (${typedA.join(",")}) AND r.cik = ${FAKE.cik1}
    ORDER BY 1`);
  const gaps = continuityGaps(cik1Dates);
  assert.deepEqual(gaps.missing, ["2099-06-30"]);
  assert.equal(scalar(`SELECT count(*) FROM obs.position_field_value fv
    JOIN obs.position_observation p ON p.id = fv.position_observation_id
    WHERE p.reported_date = '2099-06-30' AND fv.field_code IN ('PRINCIPAL_AMOUNT','COST','FAIR_VALUE')
      AND fv.raw_value IN ('0','0.0')`), "0");

  const gate = goldenInstrumentReport(dbName, allIds);
  assert.equal(gate.instrument_decision_problems, 0);
  assert.equal(gate.continuity_decision_problems, 0);
  assert.equal(gate.fuzzy_matched, 0);
  assert.equal(gate.identity_cik_columns, 0);
  assert.equal(gate.cross_bdc_series_merge, 0);
  assert.equal(gate.q14_derived_inputs, 0);
  assert.equal(gate.instrument_head_forks, 0);
  assert.equal(inserted.distinct_matched_instruments, 2);
  assert.equal(inserted.distinct_continuity_series, 3);

  const again = applyP7Min({ database: dbName, positionObservationIds: allIds, runId, rules });
  assert.equal(again.instrument_matched_inserted, 0);
  assert.equal(again.instrument_unresolved_inserted, 0);
  assert.equal(again.continuity_matched_inserted, 0);
  assert.equal(again.continuity_unresolved_inserted, 0);
}));
