#!/usr/bin/env node
// soi:load - projects soi.tsv from ZIP artifacts already loaded by registry:load.
// Offline. Never uses the network. Each ZIP is processed once per soi-load rule version.
//
//   npm run soi:load [-- --data-dir DIR] [-- --db NAME]
//
// Requires npm run registry:load first. The accession prefix is never a registrant CIK.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { queryRows } from "../lib/db.mjs";
import { LOG_FILE, readFetchLog } from "../lib/fetch-log.mjs";
import { createStore } from "../lib/store.mjs";
import { alreadyProcessed, addCounts, parseCounts, pipelineCodeVersion } from "./run.mjs";
import { registerRules } from "./rules.mjs";
import { datasetSoiUnit, registryZipStatus } from "./units/dataset-soi.mjs";

export async function runSoiLoad({ dataDir, database, log: logFn = console.log }) {
  const { entries } = readFetchLog(dataDir);
  if (entries.length === 0) throw new Error(`no fetch-log entries in ${dataDir}`);
  const store = createStore(dataDir);
  const logBytes = readFileSync(path.join(dataDir, LOG_FILE));
  const inputSha = createHash("sha256").update(logBytes).digest("hex");
  const codeVersion = pipelineCodeVersion();

  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('SOI_LOAD', '${codeVersion}', '${inputSha}', '{"data_dir":"${dataDir.replace(/\\/g, "/")}"}'::jsonb, now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const loaderRuleId = rules["pipeline.soi_load"];
  const registryRuleId = rules["pipeline.registry_load"];

  const totals = { units: 0, skipped: 0, skipped_registry_not_loaded: 0 };
  for (const entry of entries) {
    if (entry.source_type !== "SEC_BDC_DATASET_ZIP" || entry.http_status !== 200 || !entry.storage_key) continue;
    if (alreadyProcessed(database, entry, loaderRuleId)) {
      totals.skipped += 1;
      continue;
    }
    const status = registryZipStatus(database, entry, registryRuleId);
    if (!status.artifactId) {
      throw new Error(`soi:load: ZIP ${entry.url} is not in the database; run npm run registry:load first`);
    }
    if (status.outcome !== "LOADED") {
      totals.skipped_registry_not_loaded += 1;
      continue;
    }

    const unit = await datasetSoiUnit({
      database, entry, zipPath: store.pathFor(entry.storage_key), runId, rules,
    });
    if (unit.sql) {
      const lines = queryRows(database, unit.sql);
      addCounts(totals, parseCounts(lines));
      totals.units += 1;
    }
    if (unit.stop) throw new Error(unit.stop);
  }

  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(totals).replace(/'/g, "''")}'::jsonb);`);
  logFn(`soi:load: run ${runId} ${JSON.stringify(totals)}`);
  return { runId, totals, rules, codeVersion };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const dataDir = opt("--data-dir") ?? DEFAULT_DATA_DIR;
  if (!existsSync(path.join(dataDir, LOG_FILE))) {
    console.error(`soi:load: no fetch log at ${path.join(dataDir, LOG_FILE)}; run npm run registry:fetch and npm run registry:load first`);
    process.exit(1);
  }
  try {
    await runSoiLoad({ dataDir, database: opt("--db") ?? DEFAULT_DATABASE });
  } catch (error) {
    console.error(`soi:load stopped: ${error.message}`);
    process.exit(1);
  }
}
