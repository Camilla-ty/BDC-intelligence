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
import { runNumLoad } from "../load/num-run.mjs";
import { runNumCurrencyBind } from "../load/num-currency-bind.mjs";
import {
  FAKE, defaultSources, defaultSubRows, numFactRow, numSegmentsPlain, numTsv, soiTsv, subTsv,
  submissionsMain, writeSyntheticTree,
} from "./synthetic.mjs";
import { buildStoredZip } from "./zip-store.mjs";

const dbName = `bdc_num_${process.pid}`;

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  return found[0];
}

function filingRow(acc, form, date) {
  return {
    accessionNumber: acc, filingDate: date, reportDate: date,
    acceptanceDateTime: `${date}T00:00:00.000Z`, form,
    primaryDocument: "test-only.htm", primaryDocDescription: "TEST ONLY",
    fileNumber: "814-99999", isXBRL: 1, isInlineXBRL: 1,
  };
}

function soiRow({ identifier, principal, adjCost, initFv, ddate = "2099-12-31", adsh = FAKE.acc }) {
  return {
    adsh,
    cik: String(FAKE.cik1),
    name: FAKE.name1,
    ddate,
    qtrs: "0",
    form: "10-K",
    filed: "2099-12-31",
    period: ddate,
    inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000001/test-only.htm`,
    cstm: "0",
    "Investment, Identifier Axis": identifier,
    "Investment Owned, Balance, Principal Amount": principal,
    "Adjusted cost basis": adjCost,
    "Initial fair value of Investment": initFv,
    "Investment Maturity Date": "",
  };
}

const ID_UNIQUE = "TEST BORROWER NUM | UNIQUE MATCH";
const ID_ZERO = "TEST BORROWER NUM | ZERO MATCH";
const ID_MULTI = "TEST BORROWER NUM | MULTI CCY";
const ID_PURE = "TEST BORROWER NUM | NON CURRENCY";
const ID_MISMATCH = "TEST BORROWER NUM | VALUE MISMATCH";
const ID_Q1 = "TEST BORROWER NUM | COMPARE Q1";
const ID_ISSUER = "TEST BORROWER NUM | ISSUER ONLY";

function buildSources() {
  const soi = [
    soiRow({ identifier: ID_UNIQUE, principal: "100", adjCost: "90", initFv: "80" }),
    soiRow({ identifier: ID_ZERO, principal: "200", adjCost: "190", initFv: "180" }),
    soiRow({ identifier: ID_MULTI, principal: "300", adjCost: "290", initFv: "280" }),
    soiRow({ identifier: ID_PURE, principal: "400", adjCost: "390", initFv: "380" }),
    soiRow({ identifier: ID_MISMATCH, principal: "500", adjCost: "490", initFv: "480" }),
    soiRow({
      identifier: ID_Q1, principal: "1000", adjCost: "900", initFv: "800",
      ddate: "2099-03-31", adsh: FAKE.accP7q1,
    }),
    soiRow({
      identifier: ID_Q1, principal: "1100", adjCost: "990", initFv: "880",
      ddate: "2099-09-30", adsh: FAKE.accP7q3,
    }),
    soiRow({ identifier: ID_ISSUER, principal: "700", adjCost: "690", initFv: "680" }),
  ];

  const num = [
    numFactRow({
      tag: "InvestmentOwnedBalancePrincipalAmount", identifier: ID_UNIQUE, value: "100", uom: "USD",
    }),
    numFactRow({
      tag: "InvestmentOwnedAtCost", identifier: ID_UNIQUE, value: "90", uom: "USD",
      segments: numSegmentsPlain(ID_UNIQUE),
    }),
    numFactRow({
      tag: "InvestmentOwnedAtFairValue", identifier: ID_UNIQUE, value: "80", uom: "USD",
    }),
    numFactRow({
      tag: "InvestmentOwnedBalancePrincipalAmount", identifier: ID_MULTI, value: "300", uom: "USD",
    }),
    numFactRow({
      tag: "InvestmentOwnedBalancePrincipalAmount", identifier: ID_MULTI, value: "300", uom: "EUR",
      version: "us-gaap/2098",
    }),
    numFactRow({
      tag: "InvestmentOwnedBalancePrincipalAmount", identifier: ID_PURE, value: "400", uom: "pure",
    }),
    numFactRow({
      tag: "InvestmentOwnedBalancePrincipalAmount", identifier: ID_MISMATCH, value: "499", uom: "USD",
    }),
    numFactRow({
      adsh: FAKE.accP7q1, ddate: "20990331",
      tag: "InvestmentOwnedBalancePrincipalAmount", identifier: ID_Q1, value: "1000", uom: "USD",
    }),
    numFactRow({
      adsh: FAKE.accP7q3, ddate: "20990930",
      tag: "InvestmentOwnedBalancePrincipalAmount", identifier: ID_Q1, value: "1100", uom: "USD",
    }),
  ];

  const sub = [
    ...defaultSubRows(),
    {
      adsh: FAKE.accP7q1, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-Q",
      period: "20990331", fy: "2099", fp: "Q1", filed: "20990331",
      accepted: "2099-03-31 00:00:00", prevrpt: "0",
      inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000020/test-only.htm`,
    },
    {
      adsh: FAKE.accP7q3, cik: String(FAKE.cik1), name: FAKE.name1, form: "10-Q",
      period: "20990930", fy: "2099", fp: "Q3", filed: "20990930",
      accepted: "2099-09-30 00:00:00", prevrpt: "0",
      inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000021/test-only.htm`,
    },
  ];

  const sources = defaultSources();
  sources.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv(sub),
    "datasets/num.tsv": numTsv(num),
    "soi.tsv": soiTsv(soi),
    "readme.htm": "<html>TEST ONLY</html>",
  });
  const pageName = "CIK9999999901-submissions-001.json";
  sources.main1 = submissionsMain({
    cik: FAKE.cik1, name: FAKE.name1,
    formerNames: [{ name: FAKE.former, from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" }],
    filings: [
      filingRow(FAKE.acc, "10-K", "2099-12-31"),
      filingRow(FAKE.accAmend, "10-Q/A", "2099-12-31"),
      filingRow(FAKE.accPrefix, "8-K", "2099-12-31"),
      filingRow(FAKE.accDisagree, "10-K", "2099-12-31"),
      filingRow(FAKE.accShared, "8-K", "2099-12-31"),
      filingRow(FAKE.accP7q1, "10-Q", "2099-03-31"),
      filingRow(FAKE.accP7q3, "10-Q", "2099-09-30"),
    ],
    files: [{ name: pageName, filingCount: 1, filingFrom: "2099-01-01", filingTo: "2099-06-30" }],
  });
  return sources;
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline integration tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    // Local disposable DB only. Never route queryRows through PIPELINE_DATABASE_URL.
    const previousPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-num-"));
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
      if (previousPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = previousPipelineUrl;
    }
  };
}

function headCurrency(identifier, fieldCode, reportedDate = "2099-12-31") {
  return scalar(`
SELECT coalesce(fv.currency_state::text, '') || '|' || coalesce(fv.currency_code, '') || '|' || fv.normalized_numeric::text
FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${identifier.replaceAll("'", "''")}'
  AND fv.field_code = '${fieldCode}'
  AND p.reported_date = '${reportedDate}'
ORDER BY fv.id
LIMIT 1`);
}

test("NUM load + currency bind: unique, zero, multi, non-currency, mismatch, idempotency, comparison, no issuer USD", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir, buildSources());

  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });
  const numFirst = await runNumLoad({ dataDir, database: dbName, log: () => {} });
  assert.ok(Number(numFirst.totals.num_fact_observations ?? 0) >= 9);

  assert.equal(scalar("SELECT count(*)::text FROM raw.table_load WHERE table_code = 'NUM' AND parse_status = 'OK'"), "1");
  assert.ok(Number(scalar("SELECT count(*)::text FROM obs.num_fact_observation")) >= 9);

  assert.equal(headCurrency(ID_UNIQUE, "PRINCIPAL_AMOUNT"), "UNKNOWN||100");

  const bind1 = await runNumCurrencyBind({ database: dbName, log: () => {} });
  assert.ok(bind1.totals.promoted >= 5);

  assert.equal(headCurrency(ID_UNIQUE, "PRINCIPAL_AMOUNT"), "FROM_NUM_UNIQUE_MATCH|USD|100");
  assert.equal(headCurrency(ID_UNIQUE, "COST"), "FROM_NUM_UNIQUE_MATCH|USD|90");
  assert.equal(headCurrency(ID_UNIQUE, "FAIR_VALUE"), "FROM_NUM_UNIQUE_MATCH|USD|80");
  assert.equal(headCurrency(ID_ZERO, "PRINCIPAL_AMOUNT"), "UNKNOWN||200");
  assert.equal(headCurrency(ID_MULTI, "PRINCIPAL_AMOUNT"), "UNKNOWN||300");
  assert.equal(headCurrency(ID_PURE, "PRINCIPAL_AMOUNT"), "UNKNOWN||400");
  assert.equal(headCurrency(ID_MISMATCH, "PRINCIPAL_AMOUNT"), "UNKNOWN||500");
  assert.equal(headCurrency(ID_ISSUER, "PRINCIPAL_AMOUNT"), "UNKNOWN||700");

  assert.equal(scalar(`
SELECT count(*)::text FROM obs.field_value_corroboration c
JOIN obs.current_position_field_value fv ON fv.id = c.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID_UNIQUE}' AND c.outcome = 'EQUAL'`), "3");

  assert.equal(scalar(`
SELECT count(*)::text FROM obs.field_value_corroboration c
JOIN obs.position_field_value fv ON fv.id = c.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID_MISMATCH}' AND c.outcome = 'NOT_EQUAL'`), "1");

  assert.equal(scalar(`
SELECT count(*)::text FROM obs.field_value_corroboration c
JOIN obs.position_field_value fv ON fv.id = c.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID_MULTI}' AND c.outcome = 'MULTIPLE_CANDIDATES'`), "1");

  assert.equal(scalar(`
SELECT count(*)::text FROM obs.position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID_UNIQUE}'
  AND fv.field_code = 'PRINCIPAL_AMOUNT'
  AND fv.currency_state = 'UNKNOWN'
  AND EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = fv.id)`), "1");

  assert.equal(scalar(`
SELECT a.authority FROM obs.field_value_authority a
JOIN obs.current_position_field_value fv ON fv.id = a.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID_UNIQUE}' AND fv.field_code = 'COST'
  AND fv.source_column_label = 'Adjusted cost basis'`), "PROVISIONAL");

  const compare = rows(`
SELECT e.currency_code, l.currency_code,
       e.currency_state::text, l.currency_state::text
FROM obs.current_position_field_value e
JOIN obs.position_observation pe ON pe.id = e.position_observation_id
JOIN obs.current_position_field_value l ON l.field_code = e.field_code
JOIN obs.position_observation pl ON pl.id = l.position_observation_id
WHERE e.field_code = 'PRINCIPAL_AMOUNT'
  AND pe.holding_descriptor_raw = '${ID_Q1}' AND pl.holding_descriptor_raw = '${ID_Q1}'
  AND pe.reported_date = '2099-03-31' AND pl.reported_date = '2099-09-30'`).map((line) => String(line).split("\t"));
  assert.equal(compare.length, 1);
  assert.equal(compare[0][0], "USD");
  assert.equal(compare[0][1], "USD");
  assert.equal(compare[0][2], "FROM_NUM_UNIQUE_MATCH");
  assert.equal(compare[0][3], "FROM_NUM_UNIQUE_MATCH");

  assert.equal(Number(scalar(`
SELECT (l.normalized_numeric - e.normalized_numeric)::text
FROM obs.current_position_field_value e
JOIN obs.position_observation pe ON pe.id = e.position_observation_id
JOIN obs.current_position_field_value l ON l.field_code = e.field_code
JOIN obs.position_observation pl ON pl.id = l.position_observation_id
WHERE e.field_code = 'PRINCIPAL_AMOUNT'
  AND pe.holding_descriptor_raw = '${ID_Q1}' AND pl.holding_descriptor_raw = '${ID_Q1}'
  AND pe.reported_date = '2099-03-31' AND pl.reported_date = '2099-09-30'`)), 100);

  const factsBefore = scalar("SELECT count(*)::text FROM obs.num_fact_observation");
  const fvBefore = scalar("SELECT count(*)::text FROM obs.position_field_value");
  const corrBefore = scalar("SELECT count(*)::text FROM obs.field_value_corroboration");
  const numSecond = await runNumLoad({ dataDir, database: dbName, log: () => {} });
  assert.ok(numSecond.totals.skipped >= 1);
  assert.equal(scalar("SELECT count(*)::text FROM obs.num_fact_observation"), factsBefore);
  const bind2 = await runNumCurrencyBind({ database: dbName, log: () => {} });
  assert.equal(bind2.totals.promoted, 0);
  assert.equal(scalar("SELECT count(*)::text FROM obs.position_field_value"), fvBefore);
  assert.equal(scalar("SELECT count(*)::text FROM obs.field_value_corroboration"), corrBefore);

  assert.equal(scalar(`
SELECT count(*)::text FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID_ISSUER}' AND fv.currency_code = 'USD'`), "0");
}));
