import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BOOTSTRAP,
  LEDGER_QUERY,
  assertChecksums,
  listMigrations,
  migrationTransaction,
} from "./migrate.mjs";
import {
  HOSTED_MIGRATION_STATEMENT_TIMEOUT_READ_SQL,
  HOSTED_MIGRATION_STATEMENT_TIMEOUT_SQL,
  assertHostedStatementTimeout,
  assertHostedUrl,
  hostedApplyScripts,
  migrateHosted,
  statementTimeoutMilliseconds,
} from "./migrate-hosted.mjs";

test("hosted runner sends the same bootstrap, ledger query, and transaction as the local runner", () => {
  const { migrations, errors } = listMigrations();
  assert.deepEqual(errors, []);
  // 0020 was the last file when this test was added. Later migrations remain in the
  // comparison below; the original prefix stays at these positions.
  assert.ok(migrations.length >= 20, `expected the original 20 migrations plus any later files, found ${migrations.length}`);
  assert.equal(migrations[0].filename, "0001_foundation.sql");
  assert.equal(migrations[19].filename, "0020_market_coverage.sql");

  const hosted = hostedApplyScripts(migrations);
  assert.equal(hosted.bootstrap, BOOTSTRAP);
  assert.equal(hosted.ledgerQuery, LEDGER_QUERY);
  assert.equal(hosted.transactions.length, migrations.length);

  for (let i = 0; i < migrations.length; i += 1) {
    const migration = migrations[i];
    const local = migrationTransaction(migration);
    const sent = hosted.transactions[i];
    assert.equal(sent, local);
    assert.ok(sent.startsWith("BEGIN;\n"));
    assert.ok(sent.endsWith("\nCOMMIT;\n"));
    assert.ok(sent.includes(migration.sql));
    assert.ok(sent.includes(
      `INSERT INTO ops.schema_migration (filename, sha256) VALUES ('${migration.filename}', '${migration.sha256}')`,
    ));
  }
});

test("checksum validation rejects drift and a missing applied file", () => {
  const { migrations } = listMigrations();
  assert.doesNotThrow(() => assertChecksums(new Map(migrations.map((m) => [m.filename, m.sha256])), migrations));
  assert.throws(
    () => assertChecksums(new Map([["0001_foundation.sql", "ab"]]), migrations),
    /checksum drift: 0001_foundation.sql changed after it was applied/,
  );
  assert.throws(
    () => assertChecksums(new Map([["9999_missing.sql", "ab"]]), migrations),
    /checksum drift: applied migration 9999_missing.sql is missing locally/,
  );
});

test("hosted URL check refuses the transaction pooler without printing the URL", () => {
  const secret = "s3cret-token";
  const url = `postgresql://migrator:${secret}@db.example:6543/postgres`;
  assert.throws(() => assertHostedUrl(url), (error) => {
    assert.match(error.message, /port 6543/);
    assert.equal(error.message.includes(secret), false);
    assert.equal(error.message.includes("migrator"), false);
    assert.equal(error.message.includes("db.example"), false);
    assert.equal(error.message.includes("postgresql://"), false);
    return true;
  });
  assert.doesNotThrow(() => assertHostedUrl(`postgresql://migrator:${secret}@db.example:5432/postgres`));
  assert.throws(() => assertHostedUrl(""), /DATABASE_URL is not set/);
  assert.throws(() => assertHostedUrl("not a url"), /DATABASE_URL is not a valid URL/);
});

test("hosted statement timeout accepts only a duration of exactly 60000 ms", () => {
  assert.equal(statementTimeoutMilliseconds("1min"), 60_000);
  assert.equal(statementTimeoutMilliseconds("60s"), 60_000);
  assert.equal(statementTimeoutMilliseconds("60000ms"), 60_000);
  assert.doesNotThrow(() => assertHostedStatementTimeout("1min"));
  assert.throws(() => assertHostedStatementTimeout("2min"), /statement_timeout is 2min \(120000 ms\); hosted migrations require exactly 60000 ms/);
  assert.throws(() => assertHostedStatementTimeout("15s"), /statement_timeout is 15s \(15000 ms\)/);
  assert.throws(() => assertHostedStatementTimeout("0"), /not a recognized duration/);
  assert.throws(() => assertHostedStatementTimeout(""), /not a recognized duration/);
  assert.throws(() => assertHostedStatementTimeout("1 min"), /not a recognized duration/);
});

function hostedClient(queries, readValue, { failSet = false } = {}) {
  return {
    async query({ text }) {
      queries.push(text);
      if (failSet && text === HOSTED_MIGRATION_STATEMENT_TIMEOUT_SQL) throw new Error("set failed");
      if (text === HOSTED_MIGRATION_STATEMENT_TIMEOUT_READ_SQL) return { rows: [[readValue]] };
      return { rows: [] };
    },
  };
}

test("hosted migration verifies the statement timeout before bootstrap", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdc-migrate-timeout-"));
  const queries = [];
  const secret = "s3cret-token";
  try {
    const result = await migrateHosted(
      `postgresql://migrator:${secret}@db.example:5432/postgres`,
      dir,
      { client: hostedClient(queries, "1min") },
    );
    assert.deepEqual(result, { applied: [], alreadyApplied: 0 });
    assert.deepEqual(queries, [
      HOSTED_MIGRATION_STATEMENT_TIMEOUT_SQL,
      HOSTED_MIGRATION_STATEMENT_TIMEOUT_READ_SQL,
      BOOTSTRAP,
      LEDGER_QUERY,
    ]);
    assert.equal(queries.some((text) => text.startsWith("BEGIN;")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted migration stops before bootstrap when the statement timeout is not 60000 ms", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bdc-migrate-timeout-"));
  const queries = [];
  const secret = "s3cret-token";
  const url = `postgresql://migrator:${secret}@db.example:5432/postgres`;
  try {
    await assert.rejects(
      () => migrateHosted(url, dir, { client: hostedClient(queries, "2min") }),
      (error) => {
        assert.match(error.message, /statement_timeout is 2min \(120000 ms\); hosted migrations require exactly 60000 ms/);
        assert.equal(error.message.includes(secret), false);
        assert.equal(error.message.includes(url), false);
        assert.equal(error.message.includes("db.example"), false);
        return true;
      },
    );
    assert.deepEqual(queries, [
      HOSTED_MIGRATION_STATEMENT_TIMEOUT_SQL,
      HOSTED_MIGRATION_STATEMENT_TIMEOUT_READ_SQL,
    ]);

    const setQueries = [];
    await assert.rejects(
      () => migrateHosted(url, dir, { client: hostedClient(setQueries, "1min", { failSet: true }) }),
      /set failed/,
    );
    assert.deepEqual(setQueries, [HOSTED_MIGRATION_STATEMENT_TIMEOUT_SQL]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hosted migration timeout injection still refuses port 6543 before any query", async () => {
  const queries = [];
  const secret = "s3cret-token";
  await assert.rejects(
    () => migrateHosted(
      `postgresql://migrator:${secret}@db.example:6543/postgres`,
      undefined,
      { client: hostedClient(queries, "1min") },
    ),
    (error) => {
      assert.match(error.message, /port 6543/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.deepEqual(queries, []);
});
