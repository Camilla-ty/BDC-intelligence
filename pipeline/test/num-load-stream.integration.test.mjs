import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { queryRows } from "../lib/db.mjs";
import { createStore } from "../lib/store.mjs";
import { LOG_FILE, readFetchLog } from "../lib/fetch-log.mjs";
import { alreadyProcessed, parseCounts, pipelineCodeVersion } from "../load/run.mjs";
import { registerRules } from "../load/rules.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { runNumLoad } from "../load/num-run.mjs";
import { datasetNumUnitLegacy } from "../load/units/dataset-num.mjs";
import {
  FAKE, defaultSoiRows, defaultSources, defaultSubRows, numFactRow, numSegmentsPlain, numTsv, soiTsv, subTsv,
  writeSyntheticTree,
} from "./synthetic.mjs";
import { buildStoredZip } from "./zip-store.mjs";
import { assertIntegrationPipelineIsLocal } from "./local-pipeline-db.mjs";

const STREAM_DB = `bdc_num_stream_${process.pid}`;
const LEGACY_DB = `bdc_num_legacy_${process.pid}`;

function fingerprint(database) {
  return {
    loads: query(database, `SELECT table_code, parse_status::text, row_count::text, field_count_mismatch_count::text, header_sha256
FROM raw.table_load WHERE table_code = 'NUM' ORDER BY id`),
    rows: query(database, `SELECT r.line_number::text, r.raw_line_sha256, r.field_count::text, r.parse_status::text
FROM raw.tabular_row r JOIN raw.table_load t ON t.id = r.table_load_id
WHERE t.table_code = 'NUM' ORDER BY r.line_number`),
    facts: query(database, `SELECT n.tag, n.tag_version, n.reported_date_raw, n.qtrs_raw, n.uom_raw,
       coalesce(n.segments_raw, ''), coalesce(n.identifier_member_raw, ''),
       n.value_raw, n.value_state::text
FROM obs.num_fact_observation n ORDER BY n.tabular_row_id, n.tag`),
    exceptions: query(database, `SELECT kind FROM ops.projection_exception ORDER BY id`),
  };
}

function sourcesWithNum(numRows, { soiRows = defaultSoiRows() } = {}) {
  const sources = defaultSources();
  sources.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv(defaultSubRows()),
    "datasets/num.tsv": Buffer.isBuffer(numRows) ? numRows : numTsv(numRows),
    "soi.tsv": soiTsv(soiRows),
    "readme.htm": "<html>TEST ONLY</html>",
  });
  return sources;
}

const EQUIV_NUM = [
  numFactRow({ tag: "InvestmentOwnedBalancePrincipalAmount", value: "100" }),
  numFactRow({ tag: "InvestmentOwnedAtCost", value: "90", segments: numSegmentsPlain(FAKE.ident) }),
  numFactRow({ tag: "InvestmentOwnedAtFairValue", value: "" }),
  `${numTsv([numFactRow({ tag: "InvestmentOwnedBalancePrincipalAmount", value: "50", identifier: FAKE.ident2 })]).split("\n")[1]}\r`,
  "0000000000-00-000001\tSHORT",
  numFactRow({ adsh: FAKE.accOrphan, tag: "InvestmentOwnedBalancePrincipalAmount", value: "7" }),
];

async function runLegacyNumLoad({ dataDir, database }) {
  const { entries } = readFetchLog(dataDir);
  const store = createStore(dataDir);
  const inputSha = createHash("sha256").update(readFileSync(path.join(dataDir, LOG_FILE))).digest("hex");
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('NUM_LOAD', '${pipelineCodeVersion()}', '${inputSha}', '{}'::jsonb, now()) RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const loaderRuleId = rules["pipeline.num_load"];
  const totals = { units: 0 };
  for (const entry of entries) {
    if (entry.source_type !== "SEC_BDC_DATASET_ZIP" || entry.http_status !== 200 || !entry.storage_key) continue;
    if (alreadyProcessed(database, entry, loaderRuleId)) continue;
    const unit = await datasetNumUnitLegacy({
      database, entry, zipPath: store.pathFor(entry.storage_key), runId, rules,
    });
    if (unit.sql) {
      const lines = queryRows(database, unit.sql);
      Object.assign(totals, parseCounts(lines));
      totals.units += 1;
    }
    if (unit.stop) throw new Error(unit.stop);
  }
  return totals;
}

function withTwoDbs(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline integration tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    assertIntegrationPipelineIsLocal();
    const previousPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-num-stream-"));
    try {
      dropDatabase(STREAM_DB);
      dropDatabase(LEGACY_DB);
      createDatabase(STREAM_DB);
      createDatabase(LEGACY_DB);
      migrate(STREAM_DB);
      migrate(LEGACY_DB);
      await fn(dataDir);
    } finally {
      try { dropDatabase(STREAM_DB); } catch { /* keep going */ }
      try { dropDatabase(LEGACY_DB); } catch { /* keep going */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
      if (previousPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = previousPipelineUrl;
    }
  };
}

test("streamed NUM load matches the buffered loader on a synthetic ZIP", withTwoDbs(async (dataDir) => {
  writeSyntheticTree(dataDir, sourcesWithNum(EQUIV_NUM));
  await runLoad({ dataDir, database: STREAM_DB, log: () => {} });
  await runSoiLoad({ dataDir, database: STREAM_DB, log: () => {} });
  const streamed = await runNumLoad({ dataDir, database: STREAM_DB, log: () => {} });

  await runLoad({ dataDir, database: LEGACY_DB, log: () => {} });
  await runSoiLoad({ dataDir, database: LEGACY_DB, log: () => {} });
  const legacy = await runLegacyNumLoad({ dataDir, database: LEGACY_DB });

  assert.deepEqual(fingerprint(STREAM_DB), fingerprint(LEGACY_DB));
  assert.equal(Number(streamed.totals.num_rows), Number(legacy.num_rows));
  assert.equal(Number(streamed.totals.num_field_count_mismatch_rows), 1);
  assert.equal(Number(streamed.totals.num_rows_with_carriage_return), 1);
  assert.equal(Number(streamed.totals.num_orphan_adsh), 1);
  assert.ok(Number(streamed.totals.num_fact_observations) >= 3);
}));

test("a malformed accession is rejected and does not leave a committed NUM load", withTwoDbs(async (dataDir) => {
  writeSyntheticTree(dataDir, sourcesWithNum([
    numFactRow({ adsh: "not-an-accession", tag: "InvestmentOwnedBalancePrincipalAmount", value: "100" }),
  ]));
  await runLoad({ dataDir, database: STREAM_DB, log: () => {} });
  await runSoiLoad({ dataDir, database: STREAM_DB, log: () => {} });
  await assert.rejects(
    runNumLoad({ dataDir, database: STREAM_DB, log: () => {} }),
    /accession number/,
  );
  assert.equal(query(STREAM_DB, "SELECT count(*) FROM raw.table_load WHERE table_code = 'NUM'").join(), "0");
  assert.equal(query(STREAM_DB, "SELECT count(*) FROM obs.num_fact_observation").join(), "0");

  await runLoad({ dataDir, database: LEGACY_DB, log: () => {} });
  await runSoiLoad({ dataDir, database: LEGACY_DB, log: () => {} });
  await assert.rejects(
    runLegacyNumLoad({ dataDir, database: LEGACY_DB }),
    /accession number/,
  );
  assert.equal(query(LEGACY_DB, "SELECT count(*) FROM raw.table_load WHERE table_code = 'NUM'").join(), "0");
}));

test("invalid UTF-8 in datasets/num.tsv fails closed", withTwoDbs(async (dataDir) => {
  const header = Buffer.from(`${["adsh", "tag", "version", "ddate", "qtrs", "uom", "segments", "dimn", "value", "footnote", "footlen"].join("\t")}\n`, "utf8");
  writeSyntheticTree(dataDir, sourcesWithNum(Buffer.concat([header, Buffer.from([0xff, 0xfe])])));
  await runLoad({ dataDir, database: STREAM_DB, log: () => {} });
  await runSoiLoad({ dataDir, database: STREAM_DB, log: () => {} });
  await assert.rejects(
    runNumLoad({ dataDir, database: STREAM_DB, log: () => {} }),
    /not valid UTF-8/,
  );
  assert.equal(query(STREAM_DB, "SELECT count(*) FROM raw.table_load WHERE table_code = 'NUM'").join(), "0");
  assert.equal(query(STREAM_DB, "SELECT count(*) FROM obs.num_fact_observation").join(), "0");
}));
