// Session advisory lock on the local Docker database. No production URL and no SEC fetch.

import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  MaturityWorkerBusy, acquireMaturityWorkerLock,
} from "../load/maturity-worker-lock.mjs";
import { runMaturityInspect } from "../maturity-inspect.mjs";

const dbName = `bdc_lock_${process.pid}`;
const ACCESSION = "0000000000-00-000001";

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
    const savedDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn();
    } finally {
      try { dropDatabase(dbName); } catch { /* the container is still stopped below */ }
      if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
      if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDatabaseUrl;
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

test("one maturity worker holds the session lock and a second does no work", withDb(async () => {
  const first = await acquireMaturityWorkerLock(dbName);
  try {
    const identity = await first.identity();
    assert.equal(identity.role, "bdc_pipeline_writer");
    assert.match(identity.statementTimeout, /^(60min|1h)$/);

    await assert.rejects(() => acquireMaturityWorkerLock(dbName), MaturityWorkerBusy);
    assert.equal(scalar(`SELECT count(*) FROM pg_locks
      WHERE locktype = 'advisory' AND objsubid = 1
        AND ((classid::bigint << 32) | objid::bigint) = 8120261003
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`), "1");

    const seen = [];
    await assert.rejects(() => runMaturityInspect({
      database: dbName,
      accessions: [ACCESSION],
      client: { get: async (url) => { seen.push(url); return { status: 200, body: Buffer.from("") }; } },
      sessionId: "TEST-ONLY-LOCK",
      log: () => {},
    }), MaturityWorkerBusy);
    assert.deepEqual(seen, []);
    assert.equal(scalar("SELECT count(*) FROM ops.run"), "0");
    assert.equal(scalar("SELECT count(*) FROM raw.artifact"), "0");
  } finally {
    await first.release();
  }

  assert.equal(scalar(`SELECT count(*) FROM pg_locks
    WHERE locktype = 'advisory' AND objsubid = 1
      AND ((classid::bigint << 32) | objid::bigint) = 8120261003
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`), "0");
  const second = await acquireMaturityWorkerLock(dbName);
  await second.dropSession();
  assert.equal(scalar(`SELECT count(*) FROM pg_locks
    WHERE locktype = 'advisory' AND objsubid = 1
      AND ((classid::bigint << 32) | objid::bigint) = 8120261003
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`), "0");
  const third = await acquireMaturityWorkerLock(dbName);
  await third.release();
  assert.equal(scalar("SELECT count(*) FROM ops.run"), "0");
}));
