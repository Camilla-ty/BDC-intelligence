#!/usr/bin/env node
// Local operator reconciliation for SOI loads. Compares soi.tsv line counts in the
// git-ignored fetch store with raw.tabular_row / observation counts. Never prints
// disclosed values. CI must not run this against real SEC bytes.
//
//   npm run soi:reconcile [-- --data-dir DIR] [-- --db NAME]

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, DEFAULT_DATA_DIR, SOI_MEMBER_PATH } from "./lib/config.mjs";
import { queryRows } from "./lib/db.mjs";
import { LOG_FILE, readFetchLog } from "./lib/fetch-log.mjs";
import { createStore } from "./lib/store.mjs";
import { parseSoiTsv } from "./parse/soi.mjs";
import { listMembers, readMember } from "./parse/zip.mjs";

export function reconcileSoi({ dataDir, database, log: logFn = console.log }) {
  const { entries } = readFetchLog(dataDir);
  const store = createStore(dataDir);
  const loads = queryRows(database, `SELECT d.release_label, a.source_url, a.sha256, r.row_count::text, r.ok_row_count::text,
    r.soi_row_observation_count::text, r.orphan_adsh_count::text, r.quarantined_mismatch_count::text, r.parse_status
FROM obs.soi_load_reconciliation r
JOIN raw.artifact a ON a.id = r.artifact_id
JOIN registry.dataset_release_artifact x ON x.artifact_id = a.id
JOIN registry.dataset_release d ON d.id = x.dataset_release_id
ORDER BY d.window_start, a.id;`);

  const problems = [];
  const zipEntries = entries.filter((e) => e.source_type === "SEC_BDC_DATASET_ZIP" && e.http_status === 200 && e.storage_key);
  logFn(`soi:reconcile: ${zipEntries.length} ZIP entries in fetch log, ${loads.length} SOI table loads in the database`);

  for (const entry of zipEntries) {
    const zipPath = store.pathFor(entry.storage_key);
    const names = listMembers(zipPath);
    const hasSoi = names.includes(SOI_MEMBER_PATH);
    const load = loads.find((l) => l[1] === entry.url && l[2] === entry.sha256);
    if (!hasSoi) {
      if (load) problems.push(`${entry.context?.release_label ?? entry.url}: soi.tsv missing in ZIP but a table_load exists`);
      continue;
    }
    const parsed = parseSoiTsv(readMember(zipPath, SOI_MEMBER_PATH));
    const fileRows = parsed.emptyFile ? 0 : parsed.rows.length;
    if (!load) {
      problems.push(`${entry.context?.release_label ?? entry.url}: soi.tsv has ${fileRows} data lines but no table_load`);
      continue;
    }
    const dbRows = Number(load[3]);
    if (dbRows !== fileRows) {
      problems.push(`${load[0]}: file data lines ${fileRows} != table_load.row_count ${dbRows}`);
    }
    const ok = Number(load[4]);
    const obs = Number(load[5]);
    const orphan = Number(load[6]);
    if (ok - orphan !== obs) {
      problems.push(`${load[0]}: ok_row_count ${ok} - orphan ${orphan} != observations ${obs}`);
    }
    logFn(`${load[0]}: file_rows=${fileRows} db_rows=${dbRows} ok=${ok} observations=${obs} orphans=${orphan} mismatches=${load[7]} parse=${load[8]}`);
  }

  if (problems.length) {
    const err = new Error(`soi:reconcile failed:\n${problems.join("\n")}`);
    throw err;
  }
  logFn("soi:reconcile: counts agree");
  return { loads: loads.length, problems: 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const dataDir = opt("--data-dir") ?? DEFAULT_DATA_DIR;
  if (!existsSync(path.join(dataDir, LOG_FILE))) {
    console.error(`soi:reconcile: no fetch log at ${path.join(dataDir, LOG_FILE)}`);
    process.exit(1);
  }
  try {
    reconcileSoi({ dataDir, database: opt("--db") ?? DEFAULT_DATABASE });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
