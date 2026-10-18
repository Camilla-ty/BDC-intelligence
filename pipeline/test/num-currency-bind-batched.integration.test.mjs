// Batched NUM currency binder: differential test against the frozen row-at-a-time binder,
// explicit fail-closed outcomes, batch atomicity, reruns, and concurrent binders.
// Local disposable Docker databases only; synthetic TEST ONLY data.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { queryRows, runScript } from "../lib/db.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { runNumLoad } from "../load/num-run.mjs";
import { registerRules } from "../load/rules.mjs";
import { bindBatchSql, runNumCurrencyBind } from "../load/num-currency-bind.mjs";
import { runNumCurrencyBind as runLegacyNumCurrencyBind } from "./legacy-num-currency-bind.mjs";
import { auditBindState, exportBindState } from "./num-currency-bind-export.mjs";
import { assertIntegrationPipelineIsLocal } from "./local-pipeline-db.mjs";
import {
  FAKE, defaultSources, defaultSubRows, numFactRow, numTsv, soiTsv, subTsv, writeSyntheticTree,
} from "./synthetic.mjs";
import { buildStoredZip } from "./zip-store.mjs";

const BINDER_URL = pathToFileURL(fileURLToPath(new URL("../load/num-currency-bind.mjs", import.meta.url))).href;

const ID = {
  unique: "TEST BORROWER NUM | BATCH UNIQUE",
  mixed: "TEST BORROWER NUM | BATCH MIXED CCY FIELDS",
  zero: "TEST BORROWER NUM | BATCH ZERO MATCH",
  mismatch: "TEST BORROWER NUM | BATCH VALUE MISMATCH",
  ambiguous: "TEST BORROWER NUM | BATCH AMBIGUOUS MISMATCH",
  multi: "TEST BORROWER NUM | BATCH MULTI CCY",
  pure: "TEST BORROWER NUM | BATCH NON CURRENCY",
  purePlus: "TEST BORROWER NUM | BATCH NON CURRENCY PLUS USD",
  dup: "TEST BORROWER NUM | BATCH DUPLICATE EQUAL",
  wrongTag: "TEST BORROWER NUM | BATCH WRONG TAG",
};
const BULK = Array.from({ length: 40 }, (_, i) => `TEST BORROWER NUM | BATCH BULK ${String(i).padStart(2, "0")}`);

const P = "InvestmentOwnedBalancePrincipalAmount";
const C = "InvestmentOwnedAtCost";
const F = "InvestmentOwnedAtFairValue";

function soiRow({ identifier, principal = "", adjCost = "", initFv = "" }) {
  return {
    adsh: FAKE.acc,
    cik: String(FAKE.cik1),
    name: FAKE.name1,
    ddate: "2099-12-31",
    qtrs: "0",
    form: "10-K",
    filed: "2099-12-31",
    period: "2099-12-31",
    inlineurl: `https://www.sec.gov/ix?doc=/Archives/edgar/data/${FAKE.cik1}/000000000000000001/test-only.htm`,
    cstm: "0",
    "Investment, Identifier Axis": identifier,
    "Investment Owned, Balance, Principal Amount": principal,
    "Adjusted cost basis": adjCost,
    "Initial fair value of Investment": initFv,
    "Investment Maturity Date": "",
  };
}

const fact = (identifier, tag, value, uom = "USD", version = "us-gaap/2099") => numFactRow({
  tag, identifier, value, uom, version,
});

function buildSources() {
  const soi = [
    soiRow({ identifier: ID.unique, principal: "100", adjCost: "90", initFv: "80" }),
    soiRow({ identifier: ID.mixed, principal: "500", adjCost: "490", initFv: "480" }),
    soiRow({ identifier: ID.zero, principal: "200", adjCost: "190", initFv: "180" }),
    soiRow({ identifier: ID.mismatch, principal: "600" }),
    soiRow({ identifier: ID.ambiguous, principal: "700" }),
    soiRow({ identifier: ID.multi, principal: "300" }),
    soiRow({ identifier: ID.pure, principal: "400" }),
    soiRow({ identifier: ID.purePlus, principal: "410" }),
    soiRow({ identifier: ID.dup, principal: "800" }),
    soiRow({ identifier: ID.wrongTag, adjCost: "990" }),
    ...BULK.map((identifier, i) => soiRow({
      identifier, principal: String(1000 + i), adjCost: String(2000 + i), initFv: String(3000 + i),
    })),
  ];
  const num = [
    fact(ID.unique, P, "100"), fact(ID.unique, C, "90"), fact(ID.unique, F, "80"),
    fact(ID.mixed, P, "500", "EUR"), fact(ID.mixed, C, "490", "USD"), fact(ID.mixed, F, "480", "USD"),
    fact(ID.mismatch, P, "599"),
    fact(ID.ambiguous, P, "699"), fact(ID.ambiguous, P, "698", "USD", "us-gaap/2098"),
    fact(ID.multi, P, "300", "USD"), fact(ID.multi, P, "300", "EUR", "us-gaap/2098"),
    fact(ID.pure, P, "400", "pure"),
    fact(ID.purePlus, P, "410", "pure"), fact(ID.purePlus, P, "410", "USD", "us-gaap/2098"),
    fact(ID.dup, P, "800"), fact(ID.dup, P, "800", "USD", "us-gaap/2098"),
    fact(ID.wrongTag, P, "990"),
    ...BULK.flatMap((identifier, i) => [
      fact(identifier, P, String(1000 + i)), fact(identifier, C, String(2000 + i)), fact(identifier, F, String(3000 + i)),
    ]),
  ];
  const sources = defaultSources();
  sources.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv(defaultSubRows()),
    "datasets/num.tsv": numTsv(num),
    "soi.tsv": soiTsv(soi),
    "readme.htm": "<html>TEST ONLY</html>",
  });
  return sources;
}

const EXPECTED = {
  heads_considered: 3 + 3 + 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + BULK.length * 3,
  promoted: 3 + 3 + 1 + 1 + BULK.length * 3,
  not_equal: 1,
  multiple: 2,
  // zero's three heads, and wrongTag's COST head, which has only a principal-tag fact.
  skipped_zero_match: 4,
  skipped_non_currency: 1,
  skipped_other: 0,
};

function withLoadedDbs(names, fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline integration tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    assertIntegrationPipelineIsLocal();
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dbs = names.map((n) => `bdc_numbatch_${n}_${process.pid}`);
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-numbatch-"));
    try {
      writeSyntheticTree(dataDir, buildSources());
      for (const db of dbs) {
        dropDatabase(db);
        createDatabase(db);
        migrate(db);
        await runLoad({ dataDir, database: db, log: () => {} });
        await runSoiLoad({ dataDir, database: db, log: () => {} });
        await runNumLoad({ dataDir, database: db, log: () => {} });
      }
      await fn(dbs, t);
    } finally {
      for (const db of dbs) {
        try { dropDatabase(db); } catch { /* still clean the rest */ }
      }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

const quiet = () => {};

function scalar(db, sql) {
  const rows = query(db, sql);
  assert.equal(rows.length, 1, `expected one row from: ${sql}`);
  return rows[0];
}

function headState(db, identifier, fieldCode) {
  return scalar(db, `
SELECT fv.currency_state::text || '|' || coalesce(fv.currency_code, '') || '|' || fv.normalized_numeric::text
FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${identifier}' AND fv.field_code = '${fieldCode}'`);
}

function assertSameExport(left, right, label) {
  assert.deepEqual(left.counts, right.counts, `${label}: table counts`);
  assert.equal(left.fieldValueKeyDuplicates, 0, `${label}: left field-value keys unique`);
  assert.equal(right.fieldValueKeyDuplicates, 0, `${label}: right field-value keys unique`);
  assert.equal(left.corroborationDuplicates, 0, `${label}: left corroborations unique`);
  assert.equal(right.corroborationDuplicates, 0, `${label}: right corroborations unique`);
  assert.deepEqual(left.fieldValues, right.fieldValues, `${label}: field values`);
  assert.deepEqual(left.corroborations, right.corroborations, `${label}: corroborations`);
}

test("batched binder writes exactly what the row-at-a-time binder writes, at any batch size, and reruns are no-ops", withLoadedDbs(
  ["legacy", "b1000", "b1", "b7"],
  async ([legacyDb, db1000, db1, db7]) => {
    const legacy1 = await runLegacyNumCurrencyBind({ database: legacyDb, log: quiet });
    const new1000 = await runNumCurrencyBind({ database: db1000, log: quiet });
    const new1 = await runNumCurrencyBind({ database: db1, log: quiet, batchSize: 1 });
    const new7 = await runNumCurrencyBind({ database: db7, log: quiet, batchSize: 7 });

    assert.deepEqual(legacy1.totals, EXPECTED);
    for (const run of [new1000, new1, new7]) assert.deepEqual(run.totals, legacy1.totals);

    const reference = exportBindState(legacyDb);
    for (const db of [db1000, db1, db7]) assertSameExport(reference, exportBindState(db), db);

    const legacy2 = await runLegacyNumCurrencyBind({ database: legacyDb, log: quiet });
    const new2 = await runNumCurrencyBind({ database: db1000, log: quiet });
    assert.deepEqual(new2.totals, legacy2.totals);
    assert.equal(new2.totals.promoted, 0);
    assert.equal(new2.totals.not_equal, 0);
    assert.equal(new2.totals.multiple, 0);
    assert.equal(new2.totals.heads_considered, EXPECTED.heads_considered - EXPECTED.promoted);
    assertSameExport(reference, exportBindState(legacyDb), "legacy rerun wrote nothing");
    assertSameExport(reference, exportBindState(db1000), "batched rerun wrote nothing");
  },
));

test("batched binder: per-field currency, fail-closed outcomes, and append-only history", withLoadedDbs(
  ["semantics"],
  async ([db]) => {
    const before = query(db, `
SELECT fv.id || '|' || fv.currency_state || '|' || coalesce(fv.raw_value, '') || '|' || fv.normalized_numeric || '|' || fv.evidence_id
FROM obs.position_field_value fv ORDER BY fv.id`);
    const { totals } = await runNumCurrencyBind({ database: db, log: quiet });
    assert.deepEqual(totals, EXPECTED);

    const audit = auditBindState(db);
    assert.deepEqual(audit.disagreements, []);
    const byReason = {};
    for (const row of audit.summary) {
      assert.equal(row.agrees, true);
      byReason[row.reason] = (byReason[row.reason] ?? 0) + row.n;
    }
    assert.deepEqual(byReason, {
      unique_match: EXPECTED.promoted,
      value_mismatch: EXPECTED.not_equal,
      ambiguous_value_mismatch: 1,
      multiple_currencies: 1,
      zero_match: EXPECTED.skipped_zero_match,
      non_currency_uom: EXPECTED.skipped_non_currency,
    });
    for (const [check, n] of Object.entries(audit.integrity)) {
      if (check !== "num_facts_bound_to_more_than_one_head") assert.equal(n, 0, check);
    }

    assert.equal(headState(db, ID.unique, "PRINCIPAL_AMOUNT"), "FROM_NUM_UNIQUE_MATCH|USD|100");
    assert.equal(headState(db, ID.unique, "COST"), "FROM_NUM_UNIQUE_MATCH|USD|90");
    assert.equal(headState(db, ID.unique, "FAIR_VALUE"), "FROM_NUM_UNIQUE_MATCH|USD|80");

    // Each field takes its own fact's currency; none is copied from another field.
    assert.equal(headState(db, ID.mixed, "PRINCIPAL_AMOUNT"), "FROM_NUM_UNIQUE_MATCH|EUR|500");
    assert.equal(headState(db, ID.mixed, "COST"), "FROM_NUM_UNIQUE_MATCH|USD|490");
    assert.equal(headState(db, ID.mixed, "FAIR_VALUE"), "FROM_NUM_UNIQUE_MATCH|USD|480");

    for (const field of ["PRINCIPAL_AMOUNT", "COST", "FAIR_VALUE"]) {
      assert.equal(headState(db, ID.zero, field).split("|")[0], "UNKNOWN");
    }
    assert.equal(headState(db, ID.mismatch, "PRINCIPAL_AMOUNT"), "UNKNOWN||600");
    assert.equal(headState(db, ID.ambiguous, "PRINCIPAL_AMOUNT"), "UNKNOWN||700");
    assert.equal(headState(db, ID.multi, "PRINCIPAL_AMOUNT"), "UNKNOWN||300");
    assert.equal(headState(db, ID.pure, "PRINCIPAL_AMOUNT"), "UNKNOWN||400");
    assert.equal(headState(db, ID.purePlus, "PRINCIPAL_AMOUNT"), "FROM_NUM_UNIQUE_MATCH|USD|410");
    assert.equal(headState(db, ID.dup, "PRINCIPAL_AMOUNT"), "FROM_NUM_UNIQUE_MATCH|USD|800");
    assert.equal(headState(db, ID.wrongTag, "COST"), "UNKNOWN||990");

    const outcomes = (identifier) => query(db, `
SELECT c.outcome::text || '|' || coalesce(n.value_numeric::text, '')
FROM obs.field_value_corroboration c
JOIN obs.position_field_value fv ON fv.id = c.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
LEFT JOIN obs.num_fact_observation n ON n.id = c.num_fact_observation_id
WHERE p.holding_descriptor_raw = '${identifier}' ORDER BY 1`);
    const mismatch = outcomes(ID.mismatch).map((l) => l.split("|"));
    assert.equal(mismatch.length, 1);
    assert.equal(mismatch[0][0], "NOT_EQUAL");
    assert.equal(Number(mismatch[0][1]), 599);
    assert.deepEqual(outcomes(ID.ambiguous), ["MULTIPLE_CANDIDATES|"]);
    assert.deepEqual(outcomes(ID.multi), ["MULTIPLE_CANDIDATES|"]);
    assert.deepEqual(outcomes(ID.zero), []);
    assert.deepEqual(outcomes(ID.pure), []);
    assert.deepEqual(outcomes(ID.wrongTag), []);

    // Duplicate equal facts in one currency link the lowest-id fact, as before.
    assert.equal(scalar(db, `
SELECT (c.num_fact_observation_id = (
  SELECT min(n.id) FROM obs.num_fact_observation n
  WHERE n.identifier_member_raw = '${ID.dup}' AND n.tag = '${P}'))::text
FROM obs.field_value_corroboration c
JOIN obs.position_field_value fv ON fv.id = c.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID.dup}' AND c.outcome = 'EQUAL'`), "true");

    // Originals are byte-for-byte unchanged; each promoted head has exactly one successor
    // carrying the original raw value, number, and evidence, with one EQUAL corroboration.
    const after = query(db, `
SELECT fv.id || '|' || fv.currency_state || '|' || coalesce(fv.raw_value, '') || '|' || fv.normalized_numeric || '|' || fv.evidence_id
FROM obs.position_field_value fv WHERE fv.supersedes_id IS NULL ORDER BY fv.id`);
    assert.deepEqual(after, before);
    assert.equal(scalar(db, `
SELECT count(*)::text FROM obs.position_field_value s
JOIN obs.position_field_value h ON h.id = s.supersedes_id
WHERE s.raw_value IS NOT DISTINCT FROM h.raw_value
  AND s.normalized_numeric = h.normalized_numeric
  AND s.evidence_id = h.evidence_id
  AND s.source_column_label IS NOT DISTINCT FROM h.source_column_label
  AND s.column_mapping_id IS NOT DISTINCT FROM h.column_mapping_id
  AND s.scale_state = h.scale_state
  AND h.currency_state = 'UNKNOWN' AND h.currency_code IS NULL
  AND s.currency_state = 'FROM_NUM_UNIQUE_MATCH'`), String(EXPECTED.promoted));
    assert.equal(scalar(db, `
SELECT count(*)::text FROM obs.position_field_value s
WHERE s.supersedes_id IS NOT NULL
  AND (SELECT count(*) FROM obs.field_value_corroboration c WHERE c.field_value_id = s.id AND c.outcome = 'EQUAL') = 1
  AND NOT EXISTS (SELECT 1 FROM obs.field_value_corroboration c WHERE c.field_value_id = s.supersedes_id)`),
    String(EXPECTED.promoted));
  },
));

test("a failing batch rolls back every write in it; an already-promoted head is not promoted again", withLoadedDbs(
  ["atomic"],
  async ([db]) => {
    const [[runId]] = queryRows(db, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('NUM_CURRENCY_BIND', 'test-only', '{}'::jsonb, now()) RETURNING id::text;`);
    const ruleId = registerRules(db, Number(runId))["obs.currency.from_num_unique_match"];
    const pairs = queryRows(db, `
SELECT fv.id::text, n.id::text
FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
JOIN obs.num_fact_observation n ON n.filing_id = p.filing_id AND n.identifier_member_raw = p.holding_descriptor_raw
  AND n.tag = 'InvestmentOwnedBalancePrincipalAmount'
WHERE fv.field_code = 'PRINCIPAL_AMOUNT' AND p.holding_descriptor_raw LIKE 'TEST BORROWER NUM | BATCH BULK %'
ORDER BY fv.id LIMIT 3;`).map(([h, n]) => ({ headId: Number(h), currencyCode: "USD", numFactId: Number(n) }));
    assert.equal(pairs.length, 3);
    const counts = () => scalar(db, `
SELECT (SELECT count(*) FROM obs.position_field_value WHERE supersedes_id IS NOT NULL) || '|' ||
       (SELECT count(*) FROM obs.field_value_corroboration)`);

    const failing = bindBatchSql({
      promotes: pairs,
      corroborations: [{ fieldValueId: pairs[0].headId, numFactId: 999999999, outcome: "NOT_EQUAL" }],
      runId: Number(runId),
      ruleId,
    });
    assert.throws(() => runScript(db, failing));
    assert.equal(counts(), "0|0");

    const ok = bindBatchSql({ promotes: pairs, corroborations: [], runId: Number(runId), ruleId });
    runScript(db, ok);
    assert.equal(counts(), "3|3");
    runScript(db, ok);
    assert.equal(counts(), "3|3");

    assert.throws(() => bindBatchSql({
      promotes: [{ ...pairs[0], currencyCode: "pure" }], corroborations: [], runId: Number(runId), ruleId,
    }), /not a currency code/);
  },
));

function spawnBinder(database, startAt) {
  const code = `
const { runNumCurrencyBind } = await import(${JSON.stringify(BINDER_URL)});
while (Date.now() < ${startAt}) await new Promise((r) => setTimeout(r, 5));
const { runId, totals } = await runNumCurrencyBind({ database: ${JSON.stringify(database)}, log: () => {}, batchSize: 1 });
process.stdout.write(JSON.stringify({ runId, totals }));`;
  const env = { ...process.env, BDC_PIPELINE_TEST_LOCAL: "1" };
  delete env.PIPELINE_DATABASE_URL;
  delete env.BDC_PIPELINE_ALLOW_HOSTED;
  delete env.DATABASE_URL;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (status) => resolve({ status, out, err }));
  });
}

test("two concurrent batched binders end in the single-run state with no duplicate rows", withLoadedDbs(
  ["single", "concurrent"],
  async ([singleDb, concurrentDb], t) => {
    await runNumCurrencyBind({ database: singleDb, log: quiet });
    const startAt = Date.now() + 2000;
    const [a, b] = await Promise.all([spawnBinder(concurrentDb, startAt), spawnBinder(concurrentDb, startAt)]);
    assert.equal(a.status, 0, a.err);
    assert.equal(b.status, 0, b.err);
    const ra = JSON.parse(a.out);
    const rb = JSON.parse(b.out);
    t.diagnostic(`run A promoted ${ra.totals.promoted}, run B promoted ${rb.totals.promoted}`);
    assert.equal(ra.totals.promoted + rb.totals.promoted, EXPECTED.promoted);
    assert.equal(ra.totals.not_equal + rb.totals.not_equal, EXPECTED.not_equal);
    assert.equal(ra.totals.multiple + rb.totals.multiple, EXPECTED.multiple);

    const single = exportBindState(singleDb);
    const concurrent = exportBindState(concurrentDb);
    assert.deepEqual(concurrent.counts, single.counts);
    assert.equal(concurrent.fieldValueKeyDuplicates, 0);
    assert.equal(concurrent.corroborationDuplicates, 0);
    assert.deepEqual(concurrent.fieldValues, single.fieldValues);
    assert.deepEqual(concurrent.corroborations, single.corroborations);
  },
));
