#!/usr/bin/env node
// Schema tests against an ephemeral PostgreSQL database. Node built-ins only.
//
// 1. Static checks on migrations and test files (always run, even without Docker).
// 2. Fresh database: all migrations apply; re-applying is a no-op.
// 3. Normalized schema dump equals db/schema.snapshot.sql.
// 4. Checksum drift (edited or missing applied migration) is rejected.
// 5. Each db/tests/NN_*.sql runs as BEGIN; _setup.sql; file; ROLLBACK; and must pass.
// 6. After the tests, every table has exactly the rows the migrations seeded (nothing persisted).
//
// Without Docker the database steps are skipped locally and fail in CI (CI is set).

import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listMigrations, migrate, MIGRATIONS_DIR } from "./migrate.mjs";
import {
  CONTAINER, DEFAULT_CONTAINER, containerRunning, createDatabase, dockerAvailable, dropDatabase,
  pgDumpSchema, psql, query, startContainer, stopContainer,
} from "./pg.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TESTS_DIR = path.join(repoRoot, "db", "tests");
const SETUP_FILE = path.join(TESTS_DIR, "_setup.sql");
const SNAPSHOT_PATH = path.join(repoRoot, "db", "schema.snapshot.sql");
const LAYER_SCHEMAS = ["ops", "raw", "registry", "evidence", "obs", "identity", "resolution", "validation", "derived", "ref"];

const results = [];
const pass = (name, detail = "") => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

function staticChecks() {
  const { errors } = listMigrations();
  if (errors.length) fail("migration files are well-formed", errors.join("; "));
  else pass("migration files are well-formed");

  if (!existsSync(SNAPSHOT_PATH)) fail("schema snapshot exists", "db/schema.snapshot.sql is missing; run npm run db:snapshot");
  else pass("schema snapshot exists");

  const testFiles = readdirSync(TESTS_DIR).filter((f) => /^\d{2}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const problems = [];
  for (const f of [path.basename(SETUP_FILE), ...testFiles]) {
    const sql = readFileSync(path.join(TESTS_DIR, f), "utf8");
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql)) problems.push(`${f} must not contain transaction control`);
  }
  if (problems.length) fail("test files leave transaction control to the runner", problems.join("; "));
  else pass("test files leave transaction control to the runner");
  return testFiles;
}

function tableRowCounts(database) {
  const tables = query(database, `
    SELECT format('%I.%I', n.nspname, c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN (${LAYER_SCHEMAS.map((s) => `'${s}'`).join(",")})
    ORDER BY 1`);
  const sql = tables.map((t) => `SELECT '${t}', count(*) FROM ${t}`).join("\nUNION ALL\n");
  return new Map(query(database, `${sql};`).map((l) => l.split("\t")));
}

function checksumDrift(database) {
  const tmp = mkdtempSync(path.join(tmpdir(), "bdc-migrations-"));
  try {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(tmp, f));
    const last = path.join(tmp, files[files.length - 1]);

    writeFileSync(last, readFileSync(last, "utf8") + "\n-- edited after being applied\n");
    try {
      migrate(database, tmp);
      fail("edited applied migration is rejected", "migrate succeeded");
    } catch (error) {
      if (/checksum drift/.test(error.message)) pass("edited applied migration is rejected");
      else fail("edited applied migration is rejected", error.message);
    }

    rmSync(last);
    try {
      migrate(database, tmp);
      fail("missing applied migration is rejected", "migrate succeeded");
    } catch (error) {
      if (/checksum drift/.test(error.message)) pass("missing applied migration is rejected");
      else fail("missing applied migration is rejected", error.message);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function runSqlTests(database, testFiles) {
  const setup = readFileSync(SETUP_FILE, "utf8");
  let assertions = 0;
  for (const f of testFiles) {
    const body = readFileSync(path.join(TESTS_DIR, f), "utf8");
    const r = psql(database, `BEGIN;\n${setup}\n${body}\nROLLBACK;\n`);
    const passes = (r.stderr.match(/NOTICE:\s+PASS:/g) ?? []).length;
    if (r.status !== 0) {
      const failure = r.stderr.split("\n").find((l) => /ERROR:/.test(l)) ?? r.stderr.trim();
      fail(`sql ${f}`, failure);
    } else if (passes === 0) {
      fail(`sql ${f}`, "no assertions ran");
    } else {
      assertions += passes;
      pass(`sql ${f}`, `${passes} assertion(s)`);
    }
  }
  return assertions;
}

function report() {
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.detail ? ` - ${r.detail}` : ""}`);
  return failed.length;
}

const testFiles = staticChecks();

if (!dockerAvailable()) {
  if (process.env.CI) {
    fail("docker available", "Docker is required in CI for database tests");
    process.exit(report() ? 1 : 0);
  }
  const failures = report();
  console.log("db:test: Docker is not available; database tests skipped (static checks only).");
  process.exit(failures ? 1 : 0);
}

let startedHere = false;
const database = `bdc_test_${process.pid}`;
let assertions = 0;
try {
  if (!containerRunning()) {
    if (CONTAINER !== DEFAULT_CONTAINER) throw new Error(`container ${CONTAINER} is not running`);
    startedHere = startContainer();
  }
  createDatabase(database);

  const first = migrate(database);
  const total = listMigrations().migrations.length;
  if (first.applied.length === total) pass("all migrations apply to an empty database", `${total} applied`);
  else fail("all migrations apply to an empty database", `${first.applied.length} of ${total}`);

  const second = migrate(database);
  if (second.applied.length === 0) pass("re-applying migrations is a no-op");
  else fail("re-applying migrations is a no-op", `${second.applied.length} re-applied`);

  if (existsSync(SNAPSHOT_PATH)) {
    const actual = pgDumpSchema(database);
    const expected = readFileSync(SNAPSHOT_PATH, "utf8");
    if (actual === expected) pass("schema matches db/schema.snapshot.sql");
    else {
      const a = actual.split("\n");
      const e = expected.split("\n");
      const i = a.findIndex((line, idx) => line !== e[idx]);
      fail("schema matches db/schema.snapshot.sql", `first difference at line ${i + 1}; run npm run db:snapshot and review the diff`);
    }
  }

  checksumDrift(database);

  const before = tableRowCounts(database);
  assertions = runSqlTests(database, testFiles);
  const after = tableRowCounts(database);
  const changed = [...after].filter(([t, n]) => before.get(t) !== n).map(([t]) => t);
  if (changed.length === 0) pass("no test rows persisted (every test rolled back)");
  else fail("no test rows persisted (every test rolled back)", changed.join(", "));
} catch (error) {
  fail("database test run", error.message);
} finally {
  try { dropDatabase(database); } catch { /* container may be gone */ }
  if (startedHere) stopContainer();
}

const failures = report();
console.log(`db:test: ${results.length - failures}/${results.length} checks passed, ${assertions} SQL assertions`);
process.exit(failures ? 1 : 0);
