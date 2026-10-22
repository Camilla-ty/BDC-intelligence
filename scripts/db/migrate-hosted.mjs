#!/usr/bin/env node
// Hosted migration runner. Sends the same SQL text as scripts/db/migrate.mjs through the
// existing pg client. DATABASE_URL is the session pooler or a direct connection.
// Port 6543 (transaction pooler) is refused. The connection string is never printed.

import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  BOOTSTRAP,
  LEDGER_QUERY,
  MIGRATIONS_DIR,
  assertChecksums,
  listMigrations,
  migrationTransaction,
} from "./migrate.mjs";

export function hostedApplyScripts(migrations) {
  return {
    bootstrap: BOOTSTRAP,
    ledgerQuery: LEDGER_QUERY,
    transactions: migrations.map((migration) => migrationTransaction(migration)),
  };
}

export const HOSTED_MIGRATION_STATEMENT_TIMEOUT_SQL = "SET statement_timeout = '60s'";
export const HOSTED_MIGRATION_STATEMENT_TIMEOUT_READ_SQL = "SELECT current_setting('statement_timeout')";

const STATEMENT_TIMEOUT_UNIT_MS = {
  ms: 1,
  s: 1000,
  min: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

// PostgreSQL prints 60000 ms as 1min. Accept only the compact unit form, and only when it
// is exactly 60000 ms. Any other display fails closed before bootstrap.
export function statementTimeoutMilliseconds(setting) {
  const text = String(setting ?? "").trim();
  const match = /^(\d+)(ms|s|min|h|d)$/.exec(text);
  if (!match) throw new Error(`statement_timeout ${JSON.stringify(text)} is not a recognized duration`);
  const milliseconds = Number(match[1]) * STATEMENT_TIMEOUT_UNIT_MS[match[2]];
  if (!Number.isSafeInteger(milliseconds)) {
    throw new Error(`statement_timeout ${JSON.stringify(text)} is not a recognized duration`);
  }
  return milliseconds;
}

export function assertHostedStatementTimeout(setting) {
  const milliseconds = statementTimeoutMilliseconds(setting);
  if (milliseconds !== 60_000) {
    throw new Error(
      `statement_timeout is ${String(setting).trim()} (${milliseconds} ms); hosted migrations require exactly 60000 ms`,
    );
  }
}

export function assertHostedUrl(connectionString) {
  if (!connectionString || !connectionString.trim()) {
    throw new Error("DATABASE_URL is not set");
  }
  let port = "";
  try {
    port = new URL(connectionString.trim()).port;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (port === "6543") {
    throw new Error(
      "DATABASE_URL port 6543 is the transaction pooler. Hosted migrations require the session pooler on port 5432 or a direct connection.",
    );
  }
}

function hostedSsl(connectionString) {
  const mode = /(?:\?|&)sslmode=([^&]+)/.exec(connectionString)?.[1];
  if (mode === "disable") return false;
  if (mode === "verify-ca" || mode === "verify-full") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function publicError(error, connectionString) {
  let message = error instanceof Error ? error.message : String(error);
  if (connectionString) message = message.split(connectionString).join("[redacted-url]");
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]");
  try {
    const url = new URL(connectionString);
    const password = decodeURIComponent(url.password);
    const user = decodeURIComponent(url.username);
    if (password) message = message.split(password).join("[redacted]");
    if (user) message = message.split(user).join("[redacted-user]");
    if (url.hostname) message = message.split(url.hostname).join("[redacted-host]");
  } catch {
    // assertHostedUrl already rejected a URL that cannot be parsed.
  }
  return message;
}

async function queryRows(client, text) {
  const result = await client.query({ text, queryMode: "simple", rowMode: "array" });
  const results = Array.isArray(result) ? result : [result];
  const lines = [];
  for (const item of results) {
    for (const row of item.rows) {
      lines.push(Array.isArray(row) ? row.join("\t") : String(row));
    }
  }
  return lines;
}

export async function enforceHostedStatementTimeout(client) {
  await client.query({ text: HOSTED_MIGRATION_STATEMENT_TIMEOUT_SQL, queryMode: "simple" });
  const lines = await queryRows(client, HOSTED_MIGRATION_STATEMENT_TIMEOUT_READ_SQL);
  if (lines.length !== 1) {
    throw new Error(`statement_timeout read returned ${lines.length} rows; hosted migrations require exactly 60000 ms`);
  }
  assertHostedStatementTimeout(lines[0]);
}

export async function migrateHosted(connectionString, dir = MIGRATIONS_DIR, options = {}) {
  assertHostedUrl(connectionString);
  const { migrations, errors } = listMigrations(dir);
  if (errors.length) throw new Error(`invalid migrations:\n  - ${errors.join("\n  - ")}`);

  // Tests may pass a connected client. The URL guard above and the timeout guard below still run.
  const ownsClient = options.client == null;
  const client = ownsClient
    ? new pg.Client({
      connectionString: connectionString.trim(),
      ssl: hostedSsl(connectionString),
      connectionTimeoutMillis: 30_000,
    })
    : options.client;
  try {
    if (ownsClient) await client.connect();
    await enforceHostedStatementTimeout(client);
    const { bootstrap, ledgerQuery } = hostedApplyScripts(migrations);
    await client.query({ text: bootstrap, queryMode: "simple" });
    const applied = new Map(
      (await queryRows(client, ledgerQuery)).map((line) => {
        const [filename, sha256] = line.split("\t");
        return [filename, sha256];
      }),
    );
    assertChecksums(applied, migrations);
    const pending = migrations.filter((m) => !applied.has(m.filename));
    for (const text of hostedApplyScripts(pending).transactions) {
      await client.query({ text, queryMode: "simple" });
    }
    return { applied: pending.map((m) => m.filename), alreadyApplied: applied.size };
  } catch (error) {
    throw new Error(publicError(error, connectionString));
  } finally {
    if (ownsClient) await client.end().catch(() => undefined);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await migrateHosted(process.env.DATABASE_URL);
    console.log(`db:migrate:hosted: applied ${result.applied.length} migration(s), ${result.alreadyApplied} already applied`);
    for (const filename of result.applied) console.log(`  + ${filename}`);
  } catch (error) {
    console.error(`db:migrate:hosted failed: ${error.message}`);
    process.exit(1);
  }
}
