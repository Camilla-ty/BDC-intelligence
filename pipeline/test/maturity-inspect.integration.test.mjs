// maturity-inspect by accession on a throwaway database built from the synthetic tree
// (TEST BDC, 2099 dates, TEST-ONLY HTML). No SEC request: the client is a stub.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createFetchLog } from "../lib/fetch-log.mjs";
import { createStore } from "../lib/store.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import {
  bindFilingPositions, commitInspectionPublication, ensureRule, inspectFilingPositions,
  recordMaturityRunFailure,
} from "../load/maturity-inspection-batch.mjs";
import { listIxContextRows } from "../normalize/ix-context-row.mjs";
import { parseAccessions, runMaturityInspect } from "../maturity-inspect.mjs";
import { FAKE, submissionsMain, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_mi_${process.pid}`;
const DOC_URL = `https://www.sec.gov/Archives/edgar/data/${FAKE.cik1}/000000000000000001/test-only.htm`;

// c-1 (2099-12-31) matches the principal-100 position on that date and shows a date.
// c-2 (2099-09-30) matches the 2099-09-30 position and shows no date.
// Nothing matches the principal-101 position.
const HTML = `<html><body><p>TEST ONLY filing document</p>
<ix:header><ix:resources>
<xbrli:context id="c-1"><xbrli:period><xbrli:instant>2099-12-31</xbrli:instant></xbrli:period></xbrli:context>
<xbrli:context id="c-2"><xbrli:period><xbrli:instant>2099-09-30</xbrli:instant></xbrli:period></xbrli:context>
</ix:resources></ix:header>
<table>
<tr><td>TEST BORROWER A</td>
<td><ix:nonFraction contextRef="c-1" id="f-1" name="us-gaap:InvestmentInterestRate">0.05</ix:nonFraction></td>
<td><ix:nonFraction contextRef="c-1" id="f-2" name="us-gaap:InvestmentOwnedBalancePrincipalAmount">100</ix:nonFraction></td>
<td><ix:nonFraction contextRef="c-1" id="f-3" name="us-gaap:InvestmentOwnedAtCost">90</ix:nonFraction></td>
<td><ix:nonFraction contextRef="c-1" id="f-4" name="us-gaap:InvestmentOwnedAtFairValue">80</ix:nonFraction></td>
<td>6/30/2099</td></tr>
<tr><td>TEST BORROWER A</td>
<td><ix:nonFraction contextRef="c-2" id="f-5" name="us-gaap:InvestmentInterestRate">0.05</ix:nonFraction></td>
<td><ix:nonFraction contextRef="c-2" id="f-6" name="us-gaap:InvestmentOwnedBalancePrincipalAmount">100</ix:nonFraction></td>
<td><ix:nonFraction contextRef="c-2" id="f-7" name="us-gaap:InvestmentOwnedAtCost">90</ix:nonFraction></td>
<td><ix:nonFraction contextRef="c-2" id="f-8" name="us-gaap:InvestmentOwnedAtFairValue">80</ix:nonFraction></td>
<td>TEST ONLY</td></tr>
</table></body></html>`;

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, sql);
  return found[0];
}

function stubClient(seen, status = 200) {
  return {
    get: async (url) => {
      seen.push(url);
      return {
        status, finalUrl: url, body: Buffer.from(status === 200 ? HTML : "TEST ONLY not found"),
        contentType: "text/html", lastModified: null, etag: null,
      };
    },
  };
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline database tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const savedPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-mi-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      writeSyntheticTree(dataDir);
      await runLoad({ dataDir, database: dbName, log: () => {} });
      await runSoiLoad({ dataDir, database: dbName, log: () => {} });
      await fn(dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function inspectionByPrincipal() {
  return rows(`SELECT fv.raw_value || ' ' || p.reported_date || ' ' || i.inspection_state || ' '
      || coalesce(i.filing_context_id, '-') || ' ' || coalesce(i.raw_value, '-') || ' '
      || coalesce(i.normalized_date::text, '-') || ' ' || coalesce(i.no_bind_reason::text, '-') || ' '
      || mp.provenance_state
    FROM obs.maturity_inspection i
    JOIN obs.position_observation p ON p.id = i.position_observation_id
    JOIN obs.current_position_field_value fv ON fv.position_observation_id = p.id AND fv.field_code = 'PRINCIPAL_AMOUNT'
    JOIN obs.maturity_provenance mp ON mp.position_observation_id = p.id
    ORDER BY p.id`);
}

test("accession arguments are validated before any database work", () => {
  assert.deepEqual(parseAccessions(["--accession", FAKE.acc, "--db", "x", "--accession", FAKE.accPrefix]), [FAKE.acc, FAKE.accPrefix]);
  assert.throws(() => parseAccessions([]), /at least one --accession/);
  assert.throws(() => parseAccessions(["--accession"]), /needs a value/);
  assert.throws(() => parseAccessions(["--accession", "--db"]), /needs a value/);
  assert.throws(() => parseAccessions(["--accession", "123"]), /not an accession number/);
  assert.throws(() => parseAccessions(["--accession", FAKE.acc, "--accession", FAKE.acc]), /more than once/);
});

test("maturity-inspect selects positions by accession, links the filing HTML, and reruns idempotently", withDb(async (dataDir) => {
  const positionsBefore = scalar("SELECT count(*) FROM obs.position_observation");
  const fieldsBefore = scalar("SELECT count(*) FROM obs.position_field_value");
  const seen = [];
  const first = await runMaturityInspect({
    database: dbName, accessions: [FAKE.acc], dataDir, client: stubClient(seen), sessionId: "TEST-ONLY-MI", log: () => {},
  });
  assert.deepEqual(seen, [DOC_URL]);
  assert.equal(first.rule_version, "3");
  assert.equal(first.accessions.length, 1);
  assert.equal(first.accessions[0].positions, 3);
  assert.deepEqual(first.accessions[0].actions, {
    "insert:FILING_DISPLAYED": 1, "insert:NOT_BOUND": 1, "insert:UNAVAILABLE": 1,
  });
  assert.deepEqual(first.accessions[0].provenance, { FILING_DISPLAYED: 1, UNKNOWN: 2 });
  assert.deepEqual(inspectionByPrincipal(), [
    "100 2099-12-31 FILING_DISPLAYED c-1 6/30/2099 2099-06-30 - FILING_DISPLAYED",
    "101 2099-12-31 NOT_BOUND - - - NO_MATCH UNKNOWN",
    "100 2099-09-30 UNAVAILABLE c-2 - - - UNKNOWN",
  ]);

  const artifactId = first.accessions[0].artifact_id;
  assert.equal(scalar(`SELECT count(*) FROM registry.filing_document_artifact WHERE artifact_id = ${artifactId}`), "1");
  assert.equal(scalar(`SELECT count(*) FROM obs.maturity_inspection i JOIN evidence.evidence e ON e.id = i.evidence_id
    WHERE e.artifact_id = ${artifactId} AND e.evidence_level = 'L2_ORIGINAL_FILING'`), "3");
  assert.equal(scalar(`SELECT e.locator_type || ' ' || e.html_anchor FROM obs.maturity_inspection i
    JOIN evidence.evidence e ON e.id = i.evidence_id WHERE i.inspection_state = 'FILING_DISPLAYED'`), "HTML_ANCHOR ix-context-row:c-1");
  assert.equal(scalar(`SELECT e.locator_type FROM obs.maturity_inspection i
    JOIN evidence.evidence e ON e.id = i.evidence_id WHERE i.inspection_state = 'NOT_BOUND'`), "DOCUMENT");
  assert.equal(scalar(`SELECT o.status FROM ops.run_outcome o WHERE o.run_id = ${first.run_id}`), "SUCCEEDED");
  assert.equal(scalar(`SELECT run_kind || ' ' || (parameters->'accessions'->>0) FROM ops.run WHERE id = ${first.run_id}`),
    `MATURITY_INSPECTION_BATCH ${FAKE.acc}`);
  assert.equal(scalar("SELECT count(*) FROM obs.position_observation"), positionsBefore);
  assert.equal(scalar("SELECT count(*) FROM obs.position_field_value"), fieldsBefore);

  const second = await runMaturityInspect({
    database: dbName, accessions: [FAKE.acc], dataDir, client: stubClient(seen), sessionId: "TEST-ONLY-MI-B", log: () => {},
  });
  assert.equal(seen.length, 1);
  assert.equal(second.accessions[0].artifact_id, artifactId);
  assert.deepEqual(second.accessions[0].actions, {
    "skip:FILING_DISPLAYED": 1, "skip:NOT_BOUND": 1, "skip:UNAVAILABLE": 1,
  });
  assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection"), "3");
  assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection WHERE supersedes_id IS NOT NULL"), "0");
  assert.equal(scalar(`SELECT o.status FROM ops.run_outcome o WHERE o.run_id = ${second.run_id}`), "SUCCEEDED");
}));

test("maturity-inspect refuses unknown accessions, filings without positions, ambiguous documents, and missing HTML", withDb(async (dataDir) => {
  const run = (accessions, client = stubClient([])) => runMaturityInspect({
    database: dbName, accessions, dataDir, client, sessionId: "TEST-ONLY-MI-REFUSE", log: () => {},
  });
  const inspectionsBefore = scalar("SELECT count(*) FROM obs.maturity_inspection");

  await assert.rejects(() => run(["0000000000-00-000777"]), /0000000000-00-000777: accession is not in registry\.filing/);
  await assert.rejects(() => run([FAKE.accAmend]), new RegExp(`${FAKE.accAmend}: no positions found`));
  await assert.rejects(() => run([FAKE.acc, "0000000000-00-000777"]), /accession is not in registry\.filing/);

  const notFound = [];
  await assert.rejects(() => run([FAKE.accPrefix], stubClient(notFound, 404)),
    new RegExp(`${FAKE.accPrefix}: filing HTML artifact could not be established \\(HTTP 404\\)`));
  assert.equal(notFound.length, 1);

  const savedAgent = process.env.SEC_USER_AGENT;
  delete process.env.SEC_USER_AGENT;
  try {
    await assert.rejects(() => runMaturityInspect({
      database: dbName, accessions: [FAKE.acc], dataDir, sessionId: "TEST-ONLY-MI-UA", log: () => {},
    }), /SEC_USER_AGENT must be set/);
  } finally {
    if (savedAgent !== undefined) process.env.SEC_USER_AGENT = savedAgent;
  }

  const refreshed = createStore(dataDir).put(Buffer.from(submissionsMain({
    cik: FAKE.cik1,
    name: FAKE.name1,
    filings: [{
      accessionNumber: FAKE.acc, filingDate: "2099-12-31", reportDate: "2099-12-31",
      acceptanceDateTime: "2099-12-31T00:00:00.000Z", form: "10-K", fileNumber: "814-99999",
      primaryDocument: "test-only-2.htm", primaryDocDescription: "TEST ONLY", isXBRL: 1, isInlineXBRL: 1,
    }],
    files: [],
  }), "utf8"));
  createFetchLog(dataDir).append({
    session_id: "TEST-ONLY-MI-REFRESH",
    requested_at: "2099-12-31T03:00:00.000Z",
    url: `https://data.sec.gov/submissions/CIK${FAKE.cik1}.json`,
    final_url: `https://data.sec.gov/submissions/CIK${FAKE.cik1}.json`,
    http_status: 200,
    content_type: "application/json",
    byte_size: refreshed.byteSize,
    sha256: refreshed.sha256,
    storage_key: refreshed.storageKey,
    source_type: "SEC_SUBMISSIONS_JSON",
    context: { kind: "submissions", cik: FAKE.cik1 },
  });
  await runLoad({ dataDir, database: dbName, log: () => {} });
  assert.equal(scalar(`SELECT count(*) FROM registry.filing_document d JOIN registry.filing f ON f.id = d.filing_id
    WHERE f.accession_number = '${FAKE.acc}' AND d.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT'`), "2");
  await assert.rejects(() => run([FAKE.acc]), new RegExp(`${FAKE.acc}: expected one primary filing document, found 2`));

  assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection"), inspectionsBefore);
  assert.equal(scalar("SELECT count(*) FROM ops.run WHERE run_kind = 'MATURITY_INSPECTION_BATCH'"), "0");
}));

function positionIds() {
  return rows("SELECT id::text FROM obs.position_observation ORDER BY id").map((line) => line.split("\t")[0]);
}

function loadedPositions() {
  const located = rows(`SELECT p.id::text, o.id::text, COALESCE(p.reported_date::text, '')
    FROM obs.position_observation p
    JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
    ORDER BY p.id`).map((line) => line.split("\t"));
  const fields = rows(`SELECT position_observation_id::text, field_code, raw_value, COALESCE(normalized_numeric::text, '')
    FROM obs.current_position_field_value
    ORDER BY position_observation_id, field_code, source_column_label`).map((line) => line.split("\t"));
  const positions = located.map(([id, originId, reportedDate]) => ({
    positionId: Number(id),
    originId: Number(originId),
    reportedDate: reportedDate || null,
    fields: [],
  }));
  const byId = new Map(positions.map((position) => [position.positionId, position]));
  for (const [id, fieldCode, rawValue, normalized] of fields) {
    byId.get(Number(id)).fields.push({
      field_code: fieldCode,
      raw_value: rawValue,
      normalized_numeric: normalized === "" ? null : normalized,
    });
  }
  return positions;
}

function installPositionFailure(positionId) {
  rows(`
CREATE OR REPLACE FUNCTION public.test_fail_maturity_position() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.position_observation_id = ${Number(positionId)} THEN
    RAISE EXCEPTION 'test-only forced inspection failure';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS test_fail_maturity_position ON obs.maturity_inspection;
CREATE TRIGGER test_fail_maturity_position
BEFORE INSERT ON obs.maturity_inspection
FOR EACH ROW EXECUTE FUNCTION public.test_fail_maturity_position();`);
}

function dropPositionFailure() {
  rows(`DROP TRIGGER IF EXISTS test_fail_maturity_position ON obs.maturity_inspection;
DROP FUNCTION IF EXISTS public.test_fail_maturity_position();`);
}

test("a later position failure rolls back the accession and a retry does not supersede", withDb(async (dataDir) => {
  const ids = positionIds();
  assert.ok(ids.length >= 2);
  const firstId = ids[0];
  const secondId = ids[1];
  installPositionFailure(secondId);
  try {
    await assert.rejects(() => runMaturityInspect({
      database: dbName, accessions: [FAKE.acc], dataDir, client: stubClient([]), sessionId: "TEST-ONLY-MI-B5", log: () => {},
    }), /test-only forced inspection failure/);
    const failedRun = scalar("SELECT id::text FROM ops.run WHERE run_kind = 'MATURITY_INSPECTION_BATCH'");
    assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection"), "0");
    assert.equal(scalar(`SELECT count(*) FROM obs.maturity_inspection WHERE position_observation_id = ${firstId}`), "0");
    assert.equal(scalar(`SELECT count(*) FROM evidence.evidence WHERE run_id = ${failedRun}`), "0");
    assert.equal(scalar(`SELECT count(*) FROM evidence.supplementary_evidence WHERE run_id = ${failedRun}`), "0");
    assert.equal(scalar(`SELECT count(*) FROM validation.validation_result WHERE run_id = ${failedRun}`), "0");
    assert.equal(scalar(`SELECT status FROM ops.run_outcome WHERE run_id = ${failedRun}`), "FAILED");
    assert.match(scalar(`SELECT error_summary FROM ops.run_outcome WHERE run_id = ${failedRun}`), /maturity inspection published 0 inspection rows/);
    assert.equal(scalar("SELECT count(*) FROM registry.maturity_read WHERE maturity_source = 'FILING_DISPLAYED'"), "0");

    const artifactId = Number(scalar("SELECT artifact_id::text FROM registry.filing_document_artifact"));
    const positions = loadedPositions();
    const [created] = queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
      VALUES ('MATURITY_INSPECTION_BATCH', 'test-only', '{"groups":2}'::jsonb, now()) RETURNING id::text`);
    const batchRun = Number(created[0]);
    const ruleId = ensureRule(dbName, batchRun);
    const planned = inspectFilingPositions(dbName, {
      positions,
      binds: bindFilingPositions(listIxContextRows(HTML), positions),
      artifactId,
      ruleId,
    });
    assert.equal(planned.errors.length, 0);
    assert.equal(planned.results[0].position.positionId, Number(firstId));
    assert.equal(planned.results[0].plan.action, "insert");
    assert.equal(planned.results[1].position.positionId, Number(secondId));
    assert.throws(() => commitInspectionPublication(dbName, {
      runId: batchRun,
      ruleId,
      filings: [
        { artifactId, results: [planned.results[0]], errors: [] },
        { artifactId, results: planned.results.slice(1), errors: [] },
      ],
      counts: { maturity_inspection: planned.results.length },
    }), /test-only forced inspection failure/);
    recordMaturityRunFailure(dbName, batchRun, new Error("second group failed after the first group's statements"));
    assert.equal(scalar(`SELECT count(*) FROM obs.maturity_inspection WHERE run_id = ${batchRun}`), "0");
    assert.equal(scalar(`SELECT count(*) FROM obs.maturity_inspection WHERE position_observation_id = ${firstId}`), "0");
    assert.equal(scalar(`SELECT count(*) FROM evidence.evidence WHERE run_id = ${batchRun}`), "0");
    assert.equal(scalar(`SELECT count(*) FROM validation.validation_result WHERE run_id = ${batchRun}`), "0");
    assert.equal(scalar(`SELECT status FROM ops.run_outcome WHERE run_id = ${batchRun}`), "FAILED");
    assert.match(scalar(`SELECT error_summary FROM ops.run_outcome WHERE run_id = ${batchRun}`), /published 0 inspection rows/);
    assert.equal(scalar("SELECT count(*) FROM registry.maturity_read WHERE maturity_source = 'FILING_DISPLAYED'"), "0");
  } finally {
    dropPositionFailure();
  }

  const success = await runMaturityInspect({
    database: dbName, accessions: [FAKE.acc], dataDir, client: stubClient([]), sessionId: "TEST-ONLY-MI-RETRY", log: () => {},
  });
  assert.equal(success.accessions[0].actions["insert:FILING_DISPLAYED"], 1);
  assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection"), "3");
  assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection WHERE supersedes_id IS NOT NULL"), "0");
  assert.equal(scalar(`SELECT status FROM ops.run_outcome WHERE run_id = ${success.run_id}`), "SUCCEEDED");
  assert.equal(scalar(`SELECT count(*) FROM obs.maturity_inspection WHERE position_observation_id = ${firstId}`), "1");
  assert.equal(scalar("SELECT count(*) FROM registry.maturity_read WHERE maturity_source = 'FILING_DISPLAYED'"), "1");

  const rerun = await runMaturityInspect({
    database: dbName, accessions: [FAKE.acc], dataDir, client: stubClient([]), sessionId: "TEST-ONLY-MI-RERUN", log: () => {},
  });
  assert.deepEqual(rerun.accessions[0].actions, {
    "skip:FILING_DISPLAYED": 1, "skip:NOT_BOUND": 1, "skip:UNAVAILABLE": 1,
  });
  assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection"), "3");
  assert.equal(scalar("SELECT count(*) FROM obs.maturity_inspection WHERE supersedes_id IS NOT NULL"), "0");
  assert.equal(scalar(`SELECT status FROM ops.run_outcome WHERE run_id = ${rerun.run_id}`), "SUCCEEDED");

  assert.throws(
    () => rows("UPDATE obs.maturity_inspection SET raw_value = raw_value"),
    /append-only/,
  );
  assert.throws(() => rows(`INSERT INTO obs.maturity_inspection
      (position_observation_id, soi_row_observation_id, inspection_state, filing_context_id,
       raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
    SELECT position_observation_id, soi_row_observation_id, inspection_state, filing_context_id,
           raw_value, normalized_date, evidence_id, rule_version_id, run_id, NULL, NULL
    FROM obs.maturity_inspection
    WHERE inspection_state = 'FILING_DISPLAYED'
    LIMIT 1`), /already has a row/);
}));
