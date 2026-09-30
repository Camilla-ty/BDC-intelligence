#!/usr/bin/env node
// registry:load - rebuilds the registry from the fetch log and content-addressed store, offline.
// Never uses the network. Each artifact is processed once per loader rule version.
//
//   npm run registry:load [-- --data-dir DIR] [-- --db NAME]
//
// Fetch-log order is the load order. The same log and store produce the same database.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, DEFAULT_DATA_DIR, REPO_ROOT } from "../lib/config.mjs";
import { queryRows } from "../lib/db.mjs";
import { LOG_FILE, readFetchLog } from "../lib/fetch-log.mjs";
import { createStore } from "../lib/store.mjs";
import { registerRules, ruleDefinitionSha, RULES } from "./rules.mjs";
import { bdcReportCsvUnit } from "./units/bdc-report-csv.mjs";
import { datasetZipUnit } from "./units/dataset-zip.mjs";
import { bdcReportPageUnit, datasetsPageUnit } from "./units/pages.mjs";
import { submissionsNotFoundUnit, submissionsUnit } from "./units/submissions.mjs";
import { insertCrossSourceValidations } from "./validate.mjs";

export function pipelineCodeVersion() {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".mjs")) hash.update(`${path.relative(REPO_ROOT, p)}\n`).update(readFileSync(p));
    }
  };
  walk(path.join(REPO_ROOT, "pipeline"));
  return hash.digest("hex");
}

export function alreadyProcessed(database, entry, loaderRuleId) {
  if (!entry.sha256) return false;
  const rows = queryRows(database, `SELECT 1 FROM raw.artifact a
JOIN ops.artifact_processing p ON p.artifact_id = a.id AND p.rule_version_id = ${loaderRuleId}
WHERE a.source_url = '${entry.url.replace(/'/g, "''")}' AND a.sha256 = '${entry.sha256}' LIMIT 1;`);
  return rows.length > 0;
}

export function parseCounts(rows) {
  const row = rows.find((l) => (Array.isArray(l) ? l[0] : String(l).split("\t")[0]) === "counts");
  if (!row) return {};
  const json = Array.isArray(row) ? row.slice(1).join("\t") : String(row).slice("counts\t".length);
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function addCounts(into, add) {
  for (const [k, v] of Object.entries(add ?? {})) into[k] = (into[k] ?? 0) + Number(v);
}

export async function runLoad({ dataDir, database, log: logFn = console.log }) {
  const { entries } = readFetchLog(dataDir);
  if (entries.length === 0) throw new Error(`no fetch-log entries in ${dataDir}`);
  const store = createStore(dataDir);
  const logBytes = readFileSync(path.join(dataDir, LOG_FILE));
  const inputSha = createHash("sha256").update(logBytes).digest("hex");
  const codeVersion = pipelineCodeVersion();

  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('REGISTRY_LOAD', '${codeVersion}', '${inputSha}', '{"data_dir":"${dataDir.replace(/\\/g, "/")}"}'::jsonb, now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const loaderRuleId = rules["pipeline.registry_load"];

  const totals = { units: 0, skipped: 0, not_found: 0 };
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (entry.http_status === 404 && entry.context?.kind === "submissions") {
      const cik = Number(entry.context.cik);
      const lines = queryRows(database, submissionsNotFoundUnit({ cik, runId, rules }));
      addCounts(totals, parseCounts(lines));
      totals.not_found += 1;
      i += 1;
      continue;
    }
    if (entry.http_status !== 200 || !entry.storage_key) {
      i += 1;
      continue;
    }
    if (alreadyProcessed(database, entry, loaderRuleId)) {
      totals.skipped += 1;
      i += 1;
      continue;
    }

    let unit;
    if (entry.source_type === "SEC_BDC_DATASETS_PAGE") {
      unit = datasetsPageUnit({ entry, body: store.read(entry.storage_key, entry.sha256), runId, rules });
    } else if (entry.source_type === "SEC_BDC_REPORT_PAGE") {
      unit = bdcReportPageUnit({ entry, body: store.read(entry.storage_key, entry.sha256), runId, rules });
    } else if (entry.source_type === "SEC_BDC_REPORT_CSV") {
      unit = bdcReportCsvUnit({ database, entry, body: store.read(entry.storage_key, entry.sha256), runId, rules });
    } else if (entry.source_type === "SEC_BDC_DATASET_ZIP") {
      unit = await datasetZipUnit({
        database, entry, zipPath: store.pathFor(entry.storage_key), runId, rules,
      });
    } else if (entry.source_type === "SEC_SUBMISSIONS_JSON") {
      const cik = Number(entry.context.cik);
      const pages = [];
      let j = i + 1;
      while (j < entries.length && entries[j].source_type === "SEC_SUBMISSIONS_PAGE_JSON"
        && Number(entries[j].context?.parent_seq) === entry.seq) {
        const p = entries[j];
        pages.push({
          name: p.context.name,
          entry: p,
          body: p.http_status === 200 ? store.read(p.storage_key, p.sha256) : null,
        });
        j += 1;
      }
      i = j - 1;
      unit = submissionsUnit({
        cik,
        main: { entry, body: store.read(entry.storage_key, entry.sha256) },
        pages,
        runId,
        rules,
      });
    } else {
      i += 1;
      continue;
    }

    if (unit.sql) {
      const lines = queryRows(database, unit.sql);
      addCounts(totals, parseCounts(lines));
      totals.units += 1;
    }
    if (unit.stop) throw new Error(unit.stop);
    i += 1;
  }

  const validation = insertCrossSourceValidations({ database, runId, ruleId: rules["validation.registry_cross_source"] });
  addCounts(totals, validation);

  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(totals).replace(/'/g, "''")}'::jsonb);`);
  logFn(`registry:load: run ${runId} ${JSON.stringify(totals)}`);
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
    console.error(`registry:load: no fetch log at ${path.join(dataDir, LOG_FILE)}; run npm run registry:fetch first`);
    process.exit(1);
  }
  try {
    await runLoad({ dataDir, database: opt("--db") ?? DEFAULT_DATABASE });
  } catch (error) {
    console.error(`registry:load stopped: ${error.message}`);
    process.exit(1);
  }
}
