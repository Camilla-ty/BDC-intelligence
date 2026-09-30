import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import {
  FAKE, defaultFilledZip, defaultSources, subTsv, writeSyntheticTree,
} from "./synthetic.mjs";
import { reconcileSoi } from "../soi-reconcile.mjs";
import { createStore } from "../lib/store.mjs";
import { createFetchLog } from "../lib/fetch-log.mjs";
import { buildStoredZip } from "./zip-store.mjs";

const dbName = `bdc_soi_${process.pid}`;

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  return found[0];
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline integration tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-soi-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

test("synthetic SOI load: identity, duplicates, dates, Q14, coverage, linkage, idempotency, refresh", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir);
  await runLoad({ dataDir, database: dbName, log: () => {} });
  const first = await runSoiLoad({ dataDir, database: dbName, log: () => {} });
  assert.ok(first.totals.units >= 2);
  reconcileSoi({ dataDir, database: dbName, log: () => {} });

  assert.equal(scalar("SELECT coverage_state FROM obs.current_soi_coverage WHERE registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_11')"), "EMPTY_PERIOD");
  assert.equal(scalar("SELECT coverage_state FROM obs.current_soi_coverage WHERE registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_12')"), "COVERED");
  assert.equal(scalar("SELECT coverage_state FROM ops.current_coverage WHERE coverage_aspect = 'FILING_METADATA' AND registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_11')"), "EMPTY_PERIOD");

  const rec = scalar(`SELECT ok_row_count || ' ' || soi_row_observation_count || ' ' || position_observation_count || ' ' || identifier_row_count || ' ' || no_identifier_row_count || ' ' || orphan_adsh_count || ' ' || quarantined_mismatch_count || ' ' || row_count
    FROM obs.soi_load_reconciliation r
    JOIN registry.dataset_release_artifact a ON a.artifact_id = r.artifact_id
    JOIN registry.dataset_release d ON d.id = a.dataset_release_id
    WHERE d.release_label = '2099_12'`).split(" ");
  assert.deepEqual(rec, ["7", "6", "5", "5", "1", "1", "1", "8"]);

  assert.equal(scalar(`SELECT count(*) FROM obs.soi_row_observation o JOIN registry.filing f ON f.id = o.filing_id
    WHERE f.accession_number = '${FAKE.acc}' AND o.identifier_raw = '${FAKE.ident}' AND o.reported_date = '2099-12-31' AND o.qtrs = 0`), "2");
  assert.equal(scalar(`SELECT count(*) FROM obs.position_observation p JOIN registry.filing f ON f.id = p.filing_id
    WHERE f.accession_number = '${FAKE.acc}' AND p.holding_descriptor_raw = '${FAKE.ident}' AND p.reported_date = '2099-12-31'`), "2");
  assert.equal(scalar(`SELECT observation_count FROM obs.soi_duplicate_key_groups WHERE accession_number = '${FAKE.acc}' AND identifier_raw = '${FAKE.ident}' AND reported_date = '2099-12-31'`), "2");

  assert.equal(scalar(`SELECT count(DISTINCT reported_date) FROM obs.soi_row_observation o JOIN registry.filing f ON f.id = o.filing_id WHERE f.accession_number = '${FAKE.acc}'`), "2");
  assert.equal(scalar("SELECT bool_and(period_role = 'UNRESOLVED') FROM obs.current_soi_row_classification"), "t");
  assert.equal(scalar("SELECT count(*) FROM obs.position_observation_group"), "0");
  assert.equal(scalar("SELECT count(*) FROM resolution.entity_resolution_decision"), "0");
  assert.equal(scalar("SELECT count(*) FROM resolution.instrument_resolution_decision"), "0");

  assert.equal(scalar("SELECT authority FROM obs.field_value_authority a JOIN obs.position_field_value f ON f.id = a.field_value_id WHERE f.source_column_label = 'Adjusted cost basis' LIMIT 1"), "PROVISIONAL");
  assert.equal(scalar("SELECT authority FROM obs.field_value_authority a JOIN obs.position_field_value f ON f.id = a.field_value_id WHERE f.source_column_label = 'Initial fair value of Investment' LIMIT 1"), "PROVISIONAL");
  assert.equal(scalar("SELECT count(*) FROM obs.position_field_value WHERE source_column_label IN ('Investment Owned, Cost', 'Investment Owned, Fair Value')"), "0");
  assert.equal(scalar("SELECT count(*) FROM derived.derived_value"), "0");
  assert.equal(scalar("SELECT count(*) FROM obs.num_fact_observation"), "0");

  assert.equal(scalar(`SELECT DISTINCT cik::text FROM registry.current_filing_registrant WHERE accession_number = '${FAKE.accPrefix}'`), "9999999901");
  assert.equal(scalar("SELECT count(*) FROM registry.registrant WHERE cik = 99"), "0");
  assert.equal(scalar("SELECT count(*) FROM registry.filing WHERE accession_number = '0000000000-00-000099'"), "0");
  assert.ok(Number(scalar("SELECT count(*) FROM validation.validation_result WHERE outcome = 'PASS' AND detail LIKE 'SOI cik cell matches%'")) >= 1);
  assert.ok(Number(scalar("SELECT count(*) FROM validation.validation_result WHERE outcome = 'FAIL' AND detail LIKE 'SOI cik cell does not match%'")) >= 1);
  assert.equal(scalar(`SELECT count(*) FROM obs.soi_row_observation o
    WHERE EXISTS (
      SELECT 1 FROM registry.current_filing_registrant c
      WHERE c.filing_id = o.filing_id AND c.cik = nullif(obs.cell_by_label(o.tabular_row_id, 'cik'), '')::bigint
    ) IS DISTINCT FROM EXISTS (
      SELECT 1 FROM registry.filing_registrant_link l
      JOIN registry.registrant r ON r.id = l.registrant_id
      WHERE l.filing_id = o.filing_id
        AND r.cik = nullif(obs.cell_by_label(o.tabular_row_id, 'cik'), '')::bigint
        AND NOT EXISTS (SELECT 1 FROM registry.filing_registrant_link s WHERE s.supersedes_id = l.id)
    )`), "0");
  assert.equal(scalar("SELECT count(*) FROM obs.position_field_value WHERE source_column_label = 'TEST ONLY Unmapped Column'"), "0");
  assert.equal(scalar("SELECT count(*) FROM raw.table_load WHERE table_code = 'SOI' AND cardinality(header) = 0 AND row_count = 0"), "1");

  const before = scalar("SELECT count(*) FROM obs.soi_row_observation");
  const second = await runSoiLoad({ dataDir, database: dbName, log: () => {} });
  assert.ok(second.totals.skipped >= first.totals.units);
  assert.equal(scalar("SELECT count(*) FROM obs.soi_row_observation"), before);

  const store = createStore(dataDir);
  const put = store.put(defaultFilledZip("<html>TEST ONLY REFRESH</html>"));
  createFetchLog(dataDir).append({
    session_id: "TEST-ONLY-SOI-REFRESH",
    requested_at: "2099-12-31T02:00:00.000Z",
    url: "https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2099_12_bdc.zip",
    final_url: "https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2099_12_bdc.zip",
    http_status: 200,
    sha256: put.sha256,
    storage_key: put.storageKey,
    byte_size: put.byteSize,
    source_type: "SEC_BDC_DATASET_ZIP",
    context: { kind: "dataset_zip", page_seq: 1, release_label: "2099_12" },
  });
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });
  assert.equal(scalar("SELECT count(*) FROM obs.soi_row_observation"), String(Number(before) * 2));
  assert.ok(Number(scalar("SELECT count(*) FROM obs.observation_equivalence")) >= 1);
  assert.equal(scalar("SELECT count(*) FROM raw.artifact_lineage a JOIN raw.artifact n ON n.id = a.artifact_id WHERE n.source_url LIKE '%2099_12_bdc.zip'"), "1");
  assert.equal(scalar("SELECT count(*) FROM ops.current_coverage WHERE coverage_aspect = 'SOI_HOLDINGS' AND coverage_state = 'COVERED' AND registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_12')"), "1");
}));

test("soi:load requires registry:load and stops on preset-header drift and missing soi.tsv", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir);
  await assert.rejects(() => runSoiLoad({ dataDir, database: dbName, log: () => {} }), /registry:load first/);

  const sources = defaultSources();
  sources.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv([{
      adsh: FAKE.acc, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-K", period: "20991231",
      fy: "2099", fp: "FY", filed: "20991231", accepted: "2099-12-31 00:00:00", prevrpt: "0",
    }]),
    "soi.tsv": "adsh\tcik\n0000000000-00-000001\t9999999901\n",
  });
  const driftDir = mkdtempSync(path.join(tmpdir(), "bdc-soi-drift-"));
  try {
    writeSyntheticTree(driftDir, sources);
    await runLoad({ dataDir: driftDir, database: dbName, log: () => {} });
    await assert.rejects(() => runSoiLoad({ dataDir: driftDir, database: dbName, log: () => {} }), /preset header differs/);
    assert.equal(scalar("SELECT outcome FROM ops.artifact_processing p JOIN ops.rule_version r ON r.id = p.rule_version_id JOIN raw.artifact a ON a.id = p.artifact_id WHERE r.rule_code = 'pipeline.soi_load' AND a.source_url LIKE '%2099_12_bdc.zip'"), "SCHEMA_DRIFT");
    assert.equal(scalar("SELECT coverage_state FROM obs.current_soi_coverage WHERE registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_12')"), "NOT_INGESTED");
  } finally {
    rmSync(driftDir, { recursive: true, force: true });
  }

  dropDatabase(dbName);
  createDatabase(dbName);
  migrate(dbName);
  const missing = defaultSources();
  missing.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv([{
      adsh: FAKE.acc, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-K", period: "20991231",
      fy: "2099", fp: "FY", filed: "20991231", accepted: "2099-12-31 00:00:00", prevrpt: "0",
    }]),
  });
  const missDir = mkdtempSync(path.join(tmpdir(), "bdc-soi-miss-"));
  try {
    writeSyntheticTree(missDir, missing);
    await runLoad({ dataDir: missDir, database: dbName, log: () => {} });
    await assert.rejects(() => runSoiLoad({ dataDir: missDir, database: dbName, log: () => {} }), /has no soi\.tsv/);
    assert.equal(scalar("SELECT coverage_state FROM obs.current_soi_coverage WHERE registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_12')"), "NOT_INGESTED");
  } finally {
    rmSync(missDir, { recursive: true, force: true });
  }
}));
