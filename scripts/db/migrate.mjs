#!/usr/bin/env node
// Forward-only, checksummed migration runner (plain SQL, applied with psql). Node built-ins only.
//
//   node scripts/db/migrate.mjs [--db NAME]   apply pending migrations to NAME (default bdc_local)
//
// Each migration runs in one transaction together with its ledger row in ops.schema_migration.
// An already-applied file whose SHA-256 changed, or that disappeared, stops the run: applied
// migrations are never edited; changes go in a new migration.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, databaseExists, psql, query, dockerAvailable, containerRunning, CONTAINER } from "./pg.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = path.join(repoRoot, "db", "migrations");
const NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

const BOOTSTRAP = `
CREATE SCHEMA IF NOT EXISTS ops;
CREATE TABLE IF NOT EXISTS ops.schema_migration (
  filename    text PRIMARY KEY CHECK (filename ~ '^[0-9]{4}_[a-z0-9_]+\\.sql$'),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at  timestamptz NOT NULL DEFAULT now()
);
`;

export function listMigrations(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const errors = [];
  const migrations = files.map((filename, index) => {
    const match = filename.match(NAME_PATTERN);
    if (!match) errors.push(`${filename}: name must match NNNN_lower_snake.sql`);
    else if (Number(match[1]) !== index + 1) errors.push(`${filename}: expected number ${String(index + 1).padStart(4, "0")} (no gaps)`);
    const sql = readFileSync(path.join(dir, filename), "utf8");
    for (const [pattern, label] of [
      [/^\s*(BEGIN\s*;|BEGIN\s+(TRANSACTION|WORK)\b|COMMIT\s*;|ROLLBACK\s*;|START\s+TRANSACTION\b)/im, "transaction control"],
      [/^\s*\\/m, "psql meta-commands"],
    ]) {
      if (pattern.test(sql)) errors.push(`${filename}: must not contain ${label}; the runner wraps each file in a transaction`);
    }
    return { filename, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  });
  return { migrations, errors };
}

export function migrate(database, dir = MIGRATIONS_DIR) {
  const { migrations, errors } = listMigrations(dir);
  if (errors.length) throw new Error(`invalid migrations:\n  - ${errors.join("\n  - ")}`);

  const boot = psql(database, BOOTSTRAP);
  if (boot.status !== 0) throw new Error(boot.stderr.trim());

  const applied = new Map(
    query(database, "SELECT filename, sha256 FROM ops.schema_migration ORDER BY filename").map((line) => {
      const [filename, sha256] = line.split("\t");
      return [filename, sha256];
    }),
  );

  const byName = new Map(migrations.map((m) => [m.filename, m]));
  for (const [filename, sha256] of applied) {
    const local = byName.get(filename);
    if (!local) throw new Error(`checksum drift: applied migration ${filename} is missing locally`);
    if (local.sha256 !== sha256) throw new Error(`checksum drift: ${filename} changed after it was applied`);
  }

  const pending = migrations.filter((m) => !applied.has(m.filename));
  for (const m of pending) {
    const script = `BEGIN;\n${m.sql}\nINSERT INTO ops.schema_migration (filename, sha256) VALUES ('${m.filename}', '${m.sha256}');\nCOMMIT;\n`;
    const r = psql(database, script);
    if (r.status !== 0) throw new Error(`${m.filename} failed:\n${r.stderr.trim()}`);
  }
  return { applied: pending.map((m) => m.filename), alreadyApplied: applied.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbFlag = process.argv.indexOf("--db");
  const database = dbFlag > -1 ? process.argv[dbFlag + 1] : "bdc_local";
  try {
    if (!dockerAvailable()) throw new Error("Docker is not available. Start Docker, then run npm run db:up.");
    if (!containerRunning()) throw new Error(`Container ${CONTAINER} is not running. Run npm run db:up first.`);
    if (!databaseExists(database)) createDatabase(database);
    const result = migrate(database);
    console.log(`db:migrate: ${database}: applied ${result.applied.length} migration(s), ${result.alreadyApplied} already applied`);
    for (const f of result.applied) console.log(`  + ${f}`);
  } catch (error) {
    console.error(`db:migrate failed: ${error.message}`);
    process.exit(1);
  }
}
