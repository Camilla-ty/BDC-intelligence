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
import { FAKE, submissionsMain, writeSyntheticTree } from "./synthetic.mjs";
import { createStore } from "../lib/store.mjs";
import { createFetchLog } from "../lib/fetch-log.mjs";

const dbName = `bdc_p2_${process.pid}`;

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  return found[0];
}

test("synthetic registry load: identity, amendments, coverage, idempotency, refresh, disagreements", async (t) => {
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
  const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-p2-"));
  try {
    dropDatabase(dbName);
    createDatabase(dbName);
    migrate(dbName);
    writeSyntheticTree(dataDir);
    const first = await runLoad({ dataDir, database: dbName, log: () => {} });
    assert.ok(first.totals.units >= 8);

    assert.deepEqual(rows("SELECT cik FROM registry.registrant ORDER BY cik"), ["9999999901", "9999999902"]);

    assert.equal(scalar(`SELECT registrant_link_status FROM registry.current_filing_registrant WHERE accession_number = '${FAKE.accPrefix}' GROUP BY registrant_link_status`), "LINKED");
    assert.equal(scalar(`SELECT DISTINCT cik::text FROM registry.current_filing_registrant WHERE accession_number = '${FAKE.accPrefix}'`), "9999999901");
    assert.equal(scalar("SELECT count(*) FROM registry.registrant WHERE cik = 99"), "0");

    assert.equal(scalar(`SELECT state FROM registry.current_filing_relationship WHERE filing_id = (SELECT id FROM registry.filing WHERE accession_number = '${FAKE.accAmend}')`), "UNRESOLVED");
    assert.equal(scalar(`SELECT related_filing_id IS NULL FROM registry.current_filing_relationship r JOIN registry.filing f ON f.id = r.filing_id WHERE f.accession_number = '${FAKE.accAmend}'`), "t");
    assert.equal(scalar("SELECT count(*) FROM registry.filing_relationship_decision WHERE state IN ('MATCHED', 'PROBABLE')"), "0");

    assert.equal(scalar("SELECT coverage_state FROM ops.current_coverage WHERE coverage_aspect = 'FILING_METADATA' AND registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_11')"), "EMPTY_PERIOD");
    assert.equal(scalar("SELECT coverage_state FROM ops.current_coverage WHERE coverage_aspect = 'FILING_METADATA' AND registrant_id IS NULL AND dataset_release_id = (SELECT id FROM registry.dataset_release WHERE release_label = '2099_12')"), "COVERED");
    assert.equal(scalar("SELECT filing_history_coverage FROM registry.registrant_coverage WHERE cik = 9999999901"), "COVERED");
    assert.equal(scalar("SELECT edition_state FROM registry.bdc_report_edition_status WHERE year_label_raw = '2019'"), "NOT_IN_SCOPE");

    assert.equal(scalar("SELECT count(*) FROM registry.current_filing_registrant WHERE accession_number = '0000000000-00-000004'"), "2");
    const shared = rows("SELECT registrant_link_status FROM registry.current_filing_registrant WHERE accession_number = '0000000000-00-000004'");
    assert.ok(shared.every((s) => s === "MULTIPLE"));

    assert.ok(Number(scalar("SELECT count(*) FROM validation.validation_result WHERE outcome = 'FAIL' AND detail LIKE 'FORM differs%'")) >= 1);

    assert.equal(scalar("SELECT attribute_state FROM registry.registrant_attribute_status WHERE cik = 9999999901 AND attribute_code = 'BDC_REPORT_LISTING'"), "REPORTED");
    assert.equal(scalar("SELECT raw_value FROM registry.current_registrant_attribute WHERE cik = 9999999901 AND attribute_code = 'BDC_REPORT_LISTING'"), "2026");

    const before = Object.fromEntries(rows(`
      SELECT format('%I.%I', n.nspname, c.relname), count(*)::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('ops','raw','registry','evidence','validation')
      GROUP BY 1 ORDER BY 1`).map((l) => l.split("\t")));
    const second = await runLoad({ dataDir, database: dbName, log: () => {} });
    assert.ok(second.totals.skipped >= first.totals.units);
    const after = Object.fromEntries(rows(`
      SELECT format('%I.%I', n.nspname, c.relname), count(*)::text
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname IN ('raw','registry','evidence')
      GROUP BY 1 ORDER BY 1`).map((l) => l.split("\t")));
    for (const [k, v] of Object.entries(after)) assert.equal(v, before[k], `${k} changed on reload`);

    const origStore = createStore(dataDir);
    const changed = submissionsMain({
      cik: FAKE.cik1, name: "TEST BDC 1 RENAMED",
      formerNames: [{ name: FAKE.former, from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" }],
      filings: [
        { accessionNumber: FAKE.acc, filingDate: "2099-12-31", reportDate: "2099-12-31", acceptanceDateTime: "2099-12-31T00:00:00.000Z", form: "10-K", primaryDocument: "test-only.htm", fileNumber: "814-99999", isXBRL: 1, isInlineXBRL: 1 },
      ],
      files: [],
    });
    const put = origStore.put(Buffer.from(changed, "utf8"));
    const log = createFetchLog(dataDir);
    log.append({
      session_id: "TEST-ONLY-REFRESH",
      requested_at: "2099-12-31T01:00:00.000Z",
      url: "https://data.sec.gov/submissions/CIK9999999901.json",
      final_url: "https://data.sec.gov/submissions/CIK9999999901.json",
      http_status: 200,
      sha256: put.sha256,
      storage_key: put.storageKey,
      byte_size: put.byteSize,
      source_type: "SEC_SUBMISSIONS_JSON",
      context: { kind: "submissions", cik: FAKE.cik1 },
    });
    await runLoad({ dataDir, database: dbName, log: () => {} });
    const names = rows("SELECT raw_value FROM registry.current_registrant_attribute WHERE cik = 9999999901 AND attribute_code = 'NAME' AND source_type_code = 'SEC_SUBMISSIONS_JSON'");
    assert.ok(names.includes("TEST BDC 1 RENAMED"));
    assert.equal(scalar("SELECT count(*) FROM raw.artifact_lineage"), "1");
    assert.ok(Number(scalar("SELECT count(*) FROM ops.audit_event WHERE event_kind = 'FACTS_ABSENT_FROM_NEWER_SOURCE'")) >= 1);
  } finally {
    try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
    rmSync(dataDir, { recursive: true, force: true });
    if (startedHere) {
      try { stopContainer(); } catch { /* container may already be gone */ }
    }
  }
});
