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

export async function migrateHosted(connectionString, dir = MIGRATIONS_DIR) {
  assertHostedUrl(connectionString);
  const { migrations, errors } = listMigrations(dir);
  if (errors.length) throw new Error(`invalid migrations:\n  - ${errors.join("\n  - ")}`);

  const client = new pg.Client({
    connectionString: connectionString.trim(),
    ssl: hostedSsl(connectionString),
    connectionTimeoutMillis: 30_000,
  });
  try {
    await client.connect();
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
    await client.end().catch(() => undefined);
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
