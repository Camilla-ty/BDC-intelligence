// Shared helpers for the local/CI PostgreSQL used by schema tests. Node built-ins only.
// PostgreSQL runs in Docker (the official postgres:17 image): a container this script starts
// locally, or the CI service container named by BDC_DB_CONTAINER. psql and pg_dump run inside
// the container, so no PostgreSQL client or npm database package is needed on the host.
// This is test infrastructure only; it is not the production database.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

export const IMAGE = "postgres:17";
export const DEFAULT_CONTAINER = "bdc-intelligence-pg";
export const CONTAINER = process.env.BDC_DB_CONTAINER ?? DEFAULT_CONTAINER;
export const DB_USER = "postgres";

function run(cmd, args, input) {
  const result = spawnSync(cmd, args, {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

export function dockerAvailable() {
  const r = run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return r.status === 0 && !r.error;
}

export function containerRunning(name = CONTAINER) {
  const r = run("docker", ["inspect", "-f", "{{.State.Running}}", name]);
  return r.status === 0 && r.stdout.trim() === "true";
}

export function waitForReady(name = CONTAINER, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // pg_isready alone can pass during the image's init restart; also require a query.
    const ready = run("docker", ["exec", name, "pg_isready", "-U", DB_USER, "-q"]);
    if (ready.status === 0) {
      const q = run("docker", ["exec", name, "psql", "-X", "-U", DB_USER, "-d", "postgres", "-Atc", "SELECT 1"]);
      if (q.status === 0 && q.stdout.trim() === "1") return true;
    }
    spawnSync("sleep", ["1"]);
  }
  return false;
}

// Starts a disposable container: no published ports, no volume, removed on stop. The
// superuser password is random per start, never printed or stored; access is via docker exec.
export function startContainer(name = DEFAULT_CONTAINER) {
  if (containerRunning(name)) return false;
  const password = randomBytes(24).toString("hex");
  const r = run("docker", [
    "run", "-d", "--rm",
    "--name", name,
    "--label", "bdc-intelligence=local-schema-tests",
    "-e", `POSTGRES_PASSWORD=${password}`,
    IMAGE,
  ]);
  if (r.status !== 0) throw new Error(`docker run failed: ${r.stderr.trim()}`);
  if (!waitForReady(name)) throw new Error("PostgreSQL container did not become ready in time");
  return true;
}

export function stopContainer(name = DEFAULT_CONTAINER) {
  if (!containerRunning(name)) return false;
  const r = run("docker", ["stop", name]);
  if (r.status !== 0) throw new Error(`docker stop failed: ${r.stderr.trim()}`);
  return true;
}

// Runs SQL through psql inside the container. ON_ERROR_STOP makes any error fatal.
export function psql(database, sql, extraArgs = []) {
  return run(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", DB_USER, "-d", database, ...extraArgs],
    sql,
  );
}

export function psqlOrThrow(database, sql, extraArgs = []) {
  const r = psql(database, sql, extraArgs);
  if (r.status !== 0) throw new Error(r.stderr.trim() || `psql exited with ${r.status}`);
  return r;
}

export function query(database, sql) {
  return psqlOrThrow(database, sql, ["-At", "-F", "\t"]).stdout.split("\n").filter((l) => l !== "");
}

export function createDatabase(name) {
  assertDbName(name);
  psqlOrThrow("postgres", `CREATE DATABASE "${name}";`);
}

export function dropDatabase(name) {
  assertDbName(name);
  psqlOrThrow("postgres", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);
}

export function databaseExists(name) {
  assertDbName(name);
  return query("postgres", `SELECT 1 FROM pg_database WHERE datname = '${name}'`).length > 0;
}

export function pgDumpSchema(database) {
  const r = run("docker", [
    "exec", CONTAINER, "pg_dump", "-U", DB_USER, "-d", database,
    "--schema-only", "--no-owner", "--exclude-schema=public",
  ]);
  if (r.status !== 0) throw new Error(`pg_dump failed: ${r.stderr.trim()}`);
  return normalizeDump(r.stdout);
}

// Removes volatile lines (version banners, session SETs, and the random \restrict key that
// newer pg_dump releases emit) so the snapshot compares structure only.
export function normalizeDump(text) {
  const lines = text
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .filter((l) => !/^\\(un)?restrict\b/.test(l))
    .filter((l) => !/^SET /.test(l))
    .filter((l) => !/^SELECT pg_catalog\.set_config/.test(l));
  const out = [];
  for (const l of lines) {
    if (l.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n") + "\n";
}

function assertDbName(name) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error(`invalid database name: ${name}`);
}
