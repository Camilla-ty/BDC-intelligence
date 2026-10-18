#!/usr/bin/env node
// Test-only, local-only validation of registry:load, soi:load, num:load, and num:bind-currency
// on the stored 2026_07 BDC data-set ZIP, in a newly created disposable database inside the
// local Docker container. Never targets Hosted. Never drops or reuses an existing database.
// Reads the content-addressed store under .data/sec; never writes it or its fetch log.
//
//   node scripts/validation/num-currency-2026-07-disposable.mjs bdc_numjul_<digits>
//
// The database is left in place for inspection. Results go to /tmp/bdc-num-jul/result.json.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.BDC_PIPELINE_TEST_LOCAL = "1";
delete process.env.BDC_PIPELINE_ALLOW_HOSTED;
delete process.env.PIPELINE_DATABASE_URL;
delete process.env.DATABASE_URL;

const imp = (p) => import(new URL(`../../${p}`, import.meta.url));

const { assertLocalPipelineTarget } = await imp("pipeline/lib/db.mjs");
const target = assertLocalPipelineTarget();
if (target.mode !== "local") throw new Error("not local");

const { createDatabase, databaseExists, query, CONTAINER } = await imp("scripts/db/pg.mjs");
const { migrate } = await imp("scripts/db/migrate.mjs");
const { DEFAULT_DATA_DIR } = await imp("pipeline/lib/config.mjs");
const { createFetchLog, readFetchLog } = await imp("pipeline/lib/fetch-log.mjs");
const { createStore, sha256Hex } = await imp("pipeline/lib/store.mjs");
const { runLoad } = await imp("pipeline/load/run.mjs");
const { runSoiLoad } = await imp("pipeline/load/soi-run.mjs");
const { runNumLoad } = await imp("pipeline/load/num-run.mjs");
const { runNumCurrencyBind } = await imp("pipeline/load/num-currency-bind.mjs");

const ZIP_SHA = "dded644dc58773ea5b9c332621ba394c11d49a18a83869d50e073b8d724fdeca";
const RESULT_DIR = "/tmp/bdc-num-jul";
const dbName = process.argv[2];
if (!/^bdc_numjul_[0-9]+$/.test(dbName ?? "")) throw new Error("bad db name");
if (CONTAINER !== "bdc-intelligence-pg") throw new Error(`unexpected container ${CONTAINER}`);
if (databaseExists(dbName)) throw new Error(`${dbName} already exists; refusing to reuse`);

const { entries } = readFetchLog(DEFAULT_DATA_DIR);
const zipEntry = entries.find((e) => e.source_type === "SEC_BDC_DATASET_ZIP" && e.sha256 === ZIP_SHA);
if (!zipEntry) throw new Error("release ZIP is not in the fetch log");
const pageEntry = entries.find((e) => e.seq === Number(zipEntry.context?.page_seq));
if (zipEntry.context.release_label !== "2026_07" || pageEntry?.source_type !== "SEC_BDC_DATASETS_PAGE") {
  throw new Error("release identity");
}
const src = createStore(DEFAULT_DATA_DIR);
const zipBytes = src.read(zipEntry.storage_key, zipEntry.sha256);
if (sha256Hex(zipBytes) !== ZIP_SHA || zipBytes.length !== Number(zipEntry.byte_size)) {
  throw new Error("release ZIP SHA-256 or size does not match");
}

mkdirSync(RESULT_DIR, { recursive: true });
const out = { dbName, container: CONTAINER, zipSha256: ZIP_SHA, zipBytes: zipBytes.length, phases: [] };
const save = () => writeFileSync(path.join(RESULT_DIR, "result.json"), JSON.stringify(out, null, 2));
const t = async (name, fn) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] start ${name}`);
  const res = await fn();
  const ms = Date.now() - start;
  out.phases.push({ name, ms, totals: res?.totals ?? null });
  console.log(`[${new Date().toISOString()}] done ${name} ${ms}ms ${JSON.stringify(res?.totals ?? {})}`);
  save();
  return res;
};

const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-numjul-data-"));
out.dataDir = dataDir;
const store = createStore(dataDir);
const log = createFetchLog(dataDir);
const copy = (entry, context) => {
  const stored = store.put(src.read(entry.storage_key, entry.sha256));
  if (stored.sha256 !== entry.sha256) throw new Error("copy hash mismatch");
  return log.append({
    session_id: entry.session_id, requested_at: entry.requested_at, url: entry.url, final_url: entry.final_url,
    http_status: entry.http_status, content_type: entry.content_type, last_modified: entry.last_modified,
    etag: entry.etag, byte_size: stored.byteSize, sha256: stored.sha256, storage_key: stored.storageKey,
    source_type: entry.source_type, context,
  });
};
const page = copy(pageEntry, pageEntry.context);
copy(zipEntry, { ...zipEntry.context, page_seq: page.seq });

createDatabase(dbName);
await t("migrate", async () => { migrate(dbName); return null; });

const counts = () => Object.fromEntries(query(dbName, `
SELECT 'registrants', count(*) FROM registry.registrant UNION ALL
SELECT 'filings', count(*) FROM registry.filing UNION ALL
SELECT 'table_loads', count(*) FROM raw.table_load UNION ALL
SELECT 'tabular_rows', count(*) FROM raw.tabular_row UNION ALL
SELECT 'soi_rows', count(*) FROM obs.soi_row_observation UNION ALL
SELECT 'positions', count(*) FROM obs.position_observation UNION ALL
SELECT 'field_values', count(*) FROM obs.position_field_value UNION ALL
SELECT 'successors', count(*) FROM obs.position_field_value WHERE supersedes_id IS NOT NULL UNION ALL
SELECT 'num_facts', count(*) FROM obs.num_fact_observation UNION ALL
SELECT 'corroborations', count(*) FROM obs.field_value_corroboration UNION ALL
SELECT 'projection_exceptions', count(*) FROM ops.projection_exception UNION ALL
SELECT 'evidence', count(*) FROM evidence.evidence UNION ALL
SELECT 'artifact_processing', count(*) FROM ops.artifact_processing`).map((l) => l.split("\t")).map(([k, v]) => [k, Number(v)]));

const quiet = () => {};
await t("registry:load", () => runLoad({ dataDir, database: dbName, log: quiet }));
await t("soi:load", () => runSoiLoad({ dataDir, database: dbName, log: quiet }));
await t("num:load", () => runNumLoad({ dataDir, database: dbName, log: quiet }));
out.countsAfterLoad = counts();
save();
await t("num:bind-currency", () => runNumCurrencyBind({ database: dbName, log: quiet }));
out.countsAfterFirst = counts();
save();

await t("rerun registry:load", () => runLoad({ dataDir, database: dbName, log: quiet }));
await t("rerun soi:load", () => runSoiLoad({ dataDir, database: dbName, log: quiet }));
await t("rerun num:load", () => runNumLoad({ dataDir, database: dbName, log: quiet }));
await t("rerun num:bind-currency", () => runNumCurrencyBind({ database: dbName, log: quiet }));
out.countsAfterRerun = counts();
out.finished = new Date().toISOString();
save();
console.log("FINISHED");
