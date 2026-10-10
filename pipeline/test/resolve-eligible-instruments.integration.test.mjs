import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { FAKE, p7Sources, writeSyntheticTree } from "./synthetic.mjs";
import { resolveUniqueDateEligibleInstruments } from "../resolve-eligible-instruments.mjs";

const dbName = `bdc_unique_${process.pid}`;

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-unique-"));
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

test("unique-date resolution refuses a disposable database name by default", withDb(async () => {
  assert.throws(
    () => resolveUniqueDateEligibleInstruments({ database: dbName, dryRun: true, log() {} }),
    /refuses a database other than the local database/,
  );
}));

test("unique-date dry-run and write use P4/P6-company-cell/P7-min and rerun as already decided", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir, p7Sources());
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const dry = resolveUniqueDateEligibleInstruments({
    database: dbName,
    allowNonDefaultLocalDatabase: true,
    dryRun: true,
    limit: 1,
    dataDir,
    log() {},
  });
  assert.equal(dry.mode, "unique-date-dry-run");
  assert.ok(dry.n_eligible > 0);
  assert.ok(dry.n_unique_date > 0);
  assert.equal(dry.n_groups, 1);
  assert.ok(dry.n_selected >= 1);
  assert.equal(dry.selected_ids.length, dry.n_selected);
  assert.equal(scalar("SELECT count(*) FROM ops.run WHERE run_kind = 'ELIGIBLE_INSTRUMENT_RESOLUTION'"), "0");
  assert.equal(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"), "0");

  const beforeInstruments = Number(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"));
  const beforeContinuity = Number(scalar("SELECT count(*) FROM resolution.position_continuity_decision"));
  const beforeNames = Number(scalar("SELECT count(*) FROM obs.borrower_name_observation"));
  const beforeEntities = Number(scalar("SELECT count(*) FROM resolution.entity_resolution_decision"));

  const written = resolveUniqueDateEligibleInstruments({
    database: dbName,
    allowNonDefaultLocalDatabase: true,
    limit: 1,
    dataDir,
    log() {},
  });
  assert.equal(written.mode, "unique-date");
  assert.equal(written.n_groups, 1);
  assert.deepEqual(written.selected_ids, dry.selected_ids);
  assert.ok(Number.isSafeInteger(written.run_id));
  assert.equal(written.non_selected_names_unchanged, true);
  assert.equal(written.groups.length, 1);
  assert.equal(written.groups[0].n, written.n_selected);
  assert.ok(written.groups[0].names);
  assert.ok(written.groups[0].entity);
  assert.ok(written.groups[0].instrument);

  assert.equal(
    scalar(`SELECT count(*) FROM ops.run WHERE id = ${written.run_id} AND run_kind = 'ELIGIBLE_INSTRUMENT_RESOLUTION'`),
    "1",
  );
  assert.equal(
    scalar(`SELECT counts->>'mode' FROM ops.run_outcome WHERE run_id = ${written.run_id}`),
    "unique-date",
  );
  assert.ok(Number(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision")) > beforeInstruments);
  assert.ok(Number(scalar("SELECT count(*) FROM resolution.position_continuity_decision")) > beforeContinuity);
  assert.ok(Number(scalar("SELECT count(*) FROM obs.borrower_name_observation")) > beforeNames);
  assert.ok(Number(scalar("SELECT count(*) FROM resolution.entity_resolution_decision")) > beforeEntities);

  for (const id of written.selected_ids) {
    assert.equal(
      scalar(`SELECT count(*) FROM resolution.current_instrument_resolution WHERE position_observation_id = ${id}`),
      "1",
    );
  }

  const identifiers = rows(`SELECT DISTINCT s.identifier_raw
FROM obs.position_observation p
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
WHERE p.id IN (${written.selected_ids.join(",")})`);
  assert.equal(identifiers.length, 1);

  const dryAfter = resolveUniqueDateEligibleInstruments({
    database: dbName,
    allowNonDefaultLocalDatabase: true,
    dryRun: true,
    dataDir,
    log() {},
  });
  assert.equal(dryAfter.mode, "unique-date-dry-run");
  assert.ok(dryAfter.n_already_decided >= written.selected_ids.length);
  for (const id of written.selected_ids) {
    assert.equal(dryAfter.selected_ids.includes(id), false);
  }

  const afterWriteInstruments = Number(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"));
  const afterWriteContinuity = Number(scalar("SELECT count(*) FROM resolution.position_continuity_decision"));
  const afterWriteRuns = Number(scalar("SELECT count(*) FROM ops.run WHERE run_kind = 'ELIGIBLE_INSTRUMENT_RESOLUTION'"));

  // Finish every remaining unique-date batch, then a further call must plan nothing.
  const remainder = resolveUniqueDateEligibleInstruments({
    database: dbName,
    allowNonDefaultLocalDatabase: true,
    dataDir,
    log() {},
  });
  if (remainder.n_groups === 0) {
    assert.equal(remainder.run_id, undefined);
    assert.equal(
      scalar("SELECT count(*) FROM ops.run WHERE run_kind = 'ELIGIBLE_INSTRUMENT_RESOLUTION'"),
      String(afterWriteRuns),
    );
  } else {
    assert.ok(Number.isSafeInteger(remainder.run_id));
    for (const id of written.selected_ids) {
      assert.equal(remainder.selected_ids.includes(id), false);
    }
  }

  const settledInstruments = Number(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"));
  const settledContinuity = Number(scalar("SELECT count(*) FROM resolution.position_continuity_decision"));
  const settledRuns = Number(scalar("SELECT count(*) FROM ops.run WHERE run_kind = 'ELIGIBLE_INSTRUMENT_RESOLUTION'"));
  assert.ok(settledInstruments >= afterWriteInstruments);
  assert.ok(settledContinuity >= afterWriteContinuity);
  assert.equal(settledRuns, remainder.n_groups === 0 ? afterWriteRuns : afterWriteRuns + 1);

  const again = resolveUniqueDateEligibleInstruments({
    database: dbName,
    allowNonDefaultLocalDatabase: true,
    dataDir,
    log() {},
  });
  assert.equal(again.mode, "unique-date");
  assert.equal(again.n_groups, 0);
  assert.equal(again.n_selected, 0);
  assert.deepEqual(again.selected_ids, []);
  assert.equal(again.run_id, undefined);
  assert.equal(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"), String(settledInstruments));
  assert.equal(scalar("SELECT count(*) FROM resolution.position_continuity_decision"), String(settledContinuity));
  assert.equal(scalar("SELECT count(*) FROM ops.run WHERE run_kind = 'ELIGIBLE_INSTRUMENT_RESOLUTION'"), String(settledRuns));
  assert.ok(FAKE.ident.length > 0);
}));
