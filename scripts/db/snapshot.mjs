#!/usr/bin/env node
// Regenerates db/schema.snapshot.sql: applies every migration to a fresh database and writes a
// normalized schema-only dump. Commit the snapshot together with the migration that changes it.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.mjs";
import { containerRunning, createDatabase, dockerAvailable, dropDatabase, pgDumpSchema, startContainer, stopContainer, CONTAINER, DEFAULT_CONTAINER } from "./pg.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SNAPSHOT_PATH = path.join(repoRoot, "db", "schema.snapshot.sql");

let startedHere = false;
const database = `bdc_snapshot_${process.pid}`;
try {
  if (!dockerAvailable()) throw new Error("Docker is not available.");
  if (!containerRunning()) {
    if (CONTAINER !== DEFAULT_CONTAINER) throw new Error(`container ${CONTAINER} is not running`);
    startedHere = startContainer();
  }
  createDatabase(database);
  migrate(database);
  writeFileSync(SNAPSHOT_PATH, pgDumpSchema(database));
  console.log(`db:snapshot: wrote ${path.relative(repoRoot, SNAPSHOT_PATH)}`);
} catch (error) {
  console.error(`db:snapshot failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { dropDatabase(database); } catch { /* container may be gone */ }
  if (startedHere) stopContainer();
}
