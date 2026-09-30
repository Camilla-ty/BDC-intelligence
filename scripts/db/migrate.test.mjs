import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOTSTRAP,
  LEDGER_QUERY,
  assertChecksums,
  listMigrations,
  migrationTransaction,
} from "./migrate.mjs";
import { assertHostedUrl, hostedApplyScripts } from "./migrate-hosted.mjs";

test("hosted runner sends the same bootstrap, ledger query, and transaction as the local runner", () => {
  const { migrations, errors } = listMigrations();
  assert.deepEqual(errors, []);
  assert.equal(migrations.length, 20);
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
