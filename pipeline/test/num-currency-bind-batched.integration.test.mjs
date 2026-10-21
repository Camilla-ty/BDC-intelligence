// Batched NUM currency binder (rule v3, ADR 0022): same state at any batch size, an
// independent SQL audit of unique-fact and dimension exclusions, batch atomicity, failure
// accounting and resume, reruns, and concurrent binders.
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
import { openPipelineSession, queryRows, runScript } from "../lib/db.mjs";
import { runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { runNumLoad } from "../load/num-run.mjs";
import { RULES, registerRules, ruleDefinitionSha } from "../load/rules.mjs";
import {
  NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS,
  abandonNumCurrencyBind,
  bindBatchSql,
  committedProgress,
  runNumCurrencyBind,
} from "../load/num-currency-bind.mjs";
import { SOI_RANGE_AXIS_LABEL, SOI_SUBSIDIARY_AXIS_LABEL } from "../normalize/num-currency-bind.mjs";
import { auditBindState, exportBindState } from "./num-currency-bind-export.mjs";
import { assertIntegrationPipelineIsLocal } from "./local-pipeline-db.mjs";
import {
  FAKE, SOI_EXTRA_HEADERS, defaultSources, defaultSubRows, numFactRow, numSegmentsTyped, numTsv, soiTsv, subTsv,
  writeSyntheticTree,
} from "./synthetic.mjs";
import { buildStoredZip } from "./zip-store.mjs";

const BINDER_URL = pathToFileURL(fileURLToPath(new URL("../load/num-currency-bind.mjs", import.meta.url))).href;
const DB_LIB_URL = pathToFileURL(fileURLToPath(new URL("../lib/db.mjs", import.meta.url))).href;

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
  numRange: "TEST BORROWER NUM | BATCH NUM RANGE AXIS",
  numSub: "TEST BORROWER NUM | BATCH NUM SUBSIDIARY AXIS",
  numSubPlain: "TEST BORROWER NUM | BATCH NUM SUBSIDIARY PLUS PLAIN",
  soiSub: "TEST BORROWER NUM | BATCH SOI SUBSIDIARY",
  soiRange: "TEST BORROWER NUM | BATCH SOI RANGE",
  jv: "TEST BORROWER NUM | BATCH DIRECT AND JV",
};
const BULK = Array.from({ length: 40 }, (_, i) => `TEST BORROWER NUM | BATCH BULK ${String(i).padStart(2, "0")}`);

const P = "InvestmentOwnedBalancePrincipalAmount";
const C = "InvestmentOwnedAtCost";
const F = "InvestmentOwnedAtFairValue";

const SOI_HEADERS = [...SOI_EXTRA_HEADERS, SOI_SUBSIDIARY_AXIS_LABEL, SOI_RANGE_AXIS_LABEL];
const SUB_MEMBER = "TEST ONLY Joint Venture [Member]";

function soiRow({ identifier, principal = "", adjCost = "", initFv = "", subsidiary = "", range = "" }) {
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
    [SOI_SUBSIDIARY_AXIS_LABEL]: subsidiary,
    [SOI_RANGE_AXIS_LABEL]: range,
  };
}

const fact = (identifier, tag, value, uom = "USD", version = "us-gaap/2099", extraSegments = "") => numFactRow({
  tag, identifier, value, uom, version,
  segments: extraSegments === "" ? undefined : `${extraSegments}${numSegmentsTyped(identifier, version)}`,
});
const RANGE = "RangeAxis(srt/2099)=MaximumMember(srt/2099);";
const SUBSIDIARY = "InvestmentCompanyNonconsolidatedSubsidiaryAxis(us-gaap/2099)=TestOnlyJointVentureMember(test);";

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
    soiRow({ identifier: ID.numRange, principal: "1100" }),
    soiRow({ identifier: ID.numSub, principal: "1200" }),
    soiRow({ identifier: ID.numSubPlain, principal: "1300" }),
    soiRow({ identifier: ID.soiSub, principal: "1400", adjCost: "1390", subsidiary: SUB_MEMBER }),
    soiRow({ identifier: ID.soiRange, principal: "1500", range: "Maximum [Member]" }),
    soiRow({ identifier: ID.jv, principal: "1600" }),
    soiRow({ identifier: ID.jv, principal: "1700", subsidiary: SUB_MEMBER }),
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
    fact(ID.numRange, P, "1100", "USD", "us-gaap/2099", RANGE),
    fact(ID.numSub, P, "1200", "USD", "us-gaap/2099", SUBSIDIARY),
    fact(ID.numSubPlain, P, "1300", "USD", "us-gaap/2099", SUBSIDIARY), fact(ID.numSubPlain, P, "1300"),
    fact(ID.soiSub, P, "1400"), fact(ID.soiSub, C, "1390"),
    fact(ID.soiRange, P, "1500"),
    fact(ID.jv, P, "1600"), fact(ID.jv, P, "1700", "USD", "us-gaap/2099", SUBSIDIARY),
    ...BULK.flatMap((identifier, i) => [
      fact(identifier, P, String(1000 + i)), fact(identifier, C, String(2000 + i)), fact(identifier, F, String(3000 + i)),
    ]),
  ];
  const sources = defaultSources();
  sources.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv(defaultSubRows()),
    "datasets/num.tsv": numTsv(num),
    "soi.tsv": soiTsv(soi, SOI_HEADERS),
    "readme.htm": "<html>TEST ONLY</html>",
  });
  return sources;
}

// Heads: 17 named heads across the cases above, 120 bulk heads.
const EXPECTED = {
  heads_considered: 3 + 3 + 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 2 + 1 + 2 + BULK.length * 3,
  // unique (3), mixed (3), numSubPlain, the direct jv holding, and bulk.
  promoted: 3 + 3 + 1 + 1 + BULK.length * 3,
  not_equal: 1,
  // ambiguous (values differ), multi and purePlus (units differ), dup (same unit).
  multiple: 4,
  multiple_equal_facts: 1,
  multiple_units: 2,
  multiple_value_mismatch: 1,
  // soiSub (principal and cost), soiRange, and the jv holding.
  excluded_soi_heads: 4,
  // numRange and numSub.
  excluded_num_heads: 2,
  // Four SOI reasons, plus NUM facts excluded for numRange, numSub, numSubPlain, and the direct jv holding.
  exclusion_rows: 8,
  // zero's three heads, and wrongTag's COST head, which has only a principal-tag fact.
  skipped_zero_match: 4,
  skipped_non_currency: 1,
  skipped_other: 0,
};

const withoutBatches = ({ batches_committed: _b, ...rest }) => rest;

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

function headState(db, identifier, fieldCode, value = null) {
  return scalar(db, `
SELECT fv.currency_state::text || '|' || coalesce(fv.currency_code, '') || '|' || fv.normalized_numeric::text
FROM obs.current_position_field_value fv
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${identifier}' AND fv.field_code = '${fieldCode}'
  ${value == null ? "" : `AND fv.normalized_numeric = ${Number(value)}`}`);
}

function exclusionsFor(db, identifier) {
  return query(db, `
SELECT fv.field_code || ':' || fv.normalized_numeric::text || ':' || x.reason || ':' ||
       coalesce(x.soi_cell_raw, '') || ':' || coalesce(x.num_axis, '') || ':' || coalesce(n.value_numeric::text, '')
FROM obs.field_value_currency_exclusion x
JOIN obs.position_field_value fv ON fv.id = x.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
LEFT JOIN obs.num_fact_observation n ON n.id = x.num_fact_observation_id
WHERE p.holding_descriptor_raw = '${identifier}' ORDER BY 1`);
}

function assertSameExport(left, right, label) {
  assert.deepEqual(left.counts, right.counts, `${label}: table counts`);
  for (const side of [left, right]) {
    assert.equal(side.fieldValueKeyDuplicates, 0, `${label}: field-value keys unique`);
    assert.equal(side.corroborationDuplicates, 0, `${label}: corroborations unique`);
    assert.equal(side.exclusionDuplicates, 0, `${label}: exclusions unique`);
  }
  assert.deepEqual(left.fieldValues, right.fieldValues, `${label}: field values`);
  assert.deepEqual(left.corroborations, right.corroborations, `${label}: corroborations`);
  assert.deepEqual(left.exclusions, right.exclusions, `${label}: exclusions`);
}

function runState(db, runId) {
  return JSON.parse(scalar(db, `
SELECT json_build_object('status', s.status, 'counts', o.counts, 'error', coalesce(o.error_summary, ''),
                         'parameters', r.parameters)::text
FROM ops.run r JOIN ops.current_run_status s ON s.run_id = r.id LEFT JOIN ops.run_outcome o ON o.run_id = r.id
WHERE r.id = ${Number(runId)}`));
}

// Rows each run actually wrote, against what its checkpoints claim.
function assertCheckpointsMatchWrites(db, runId) {
  assert.equal(scalar(db, `
SELECT (coalesce(sum(b.successors_written), 0) = (SELECT count(*) FROM obs.position_field_value WHERE run_id = ${runId} AND supersedes_id IS NOT NULL)
    AND coalesce(sum(b.equal_written), 0) = (SELECT count(*) FROM obs.field_value_corroboration WHERE run_id = ${runId} AND outcome = 'EQUAL')
    AND coalesce(sum(b.not_equal_written), 0) = (SELECT count(*) FROM obs.field_value_corroboration WHERE run_id = ${runId} AND outcome = 'NOT_EQUAL')
    AND coalesce(sum(b.multiple_written), 0) = (SELECT count(*) FROM obs.field_value_corroboration WHERE run_id = ${runId} AND outcome = 'MULTIPLE_CANDIDATES')
    AND coalesce(sum(b.exclusions_written), 0) = (SELECT count(*) FROM obs.field_value_currency_exclusion WHERE run_id = ${runId}))::text
FROM ops.num_currency_bind_batch b WHERE b.run_id = ${runId}`), "true", `run ${runId}: checkpoints match writes`);
}

test("batched binder writes the same state at any batch size, checkpoints every batch, and reruns are no-ops", withLoadedDbs(
  ["b1000", "b1", "b7"],
  async ([db1000, db1, db7]) => {
    const new1000 = await runNumCurrencyBind({ database: db1000, log: quiet });
    const new1 = await runNumCurrencyBind({ database: db1, log: quiet, batchSize: 1 });
    const new7 = await runNumCurrencyBind({ database: db7, log: quiet, batchSize: 7 });

    assert.deepEqual(withoutBatches(new1000.totals), EXPECTED);
    for (const run of [new1, new7]) assert.deepEqual(withoutBatches(run.totals), EXPECTED);
    assert.equal(new1000.totals.batches_committed, 1);
    assert.ok(new1.totals.batches_committed > new7.totals.batches_committed);

    const reference = exportBindState(db1000);
    for (const db of [db1, db7]) assertSameExport(reference, exportBindState(db), db);

    for (const [db, run] of [[db1000, new1000], [db1, new1], [db7, new7]]) {
      assertCheckpointsMatchWrites(db, run.runId);
      assert.equal(scalar(db, `
SELECT (count(*) = ${run.totals.batches_committed} AND sum(heads_in_batch) = ${EXPECTED.heads_considered}
    AND max(batch_index) = count(*))::text
FROM ops.num_currency_bind_batch WHERE run_id = ${run.runId}`), "true");
      const state = runState(db, run.runId);
      assert.equal(state.status, "SUCCEEDED");
      assert.equal(state.parameters.uniqueness, "unique-fact");
    }

    const again = await runNumCurrencyBind({ database: db1000, log: quiet });
    assert.equal(again.totals.promoted, 0);
    assert.equal(again.totals.not_equal, 0);
    assert.equal(again.totals.multiple, 0);
    assert.equal(again.totals.exclusion_rows, 0);
    assert.equal(again.totals.heads_considered, EXPECTED.heads_considered - EXPECTED.promoted);
    assertSameExport(reference, exportBindState(db1000), "rerun wrote nothing");
  },
));

test("batched binder: unique-fact, dimension exclusions, per-field currency, and append-only history", withLoadedDbs(
  ["semantics"],
  async ([db]) => {
    const before = query(db, `
SELECT fv.id || '|' || fv.currency_state || '|' || coalesce(fv.raw_value, '') || '|' || fv.normalized_numeric || '|' || fv.evidence_id
FROM obs.position_field_value fv ORDER BY fv.id`);
    const { totals } = await runNumCurrencyBind({ database: db, log: quiet });
    assert.deepEqual(withoutBatches(totals), EXPECTED);

    const audit = auditBindState(db);
    assert.deepEqual(audit.disagreements, []);
    const byReason = {};
    for (const row of audit.summary) {
      assert.equal(row.agrees, true);
      byReason[row.reason] = (byReason[row.reason] ?? 0) + row.n;
    }
    assert.deepEqual(byReason, {
      unique_fact: EXPECTED.promoted,
      value_mismatch: EXPECTED.not_equal,
      ambiguous_value_mismatch: EXPECTED.multiple_value_mismatch,
      multiple_units: EXPECTED.multiple_units,
      multiple_equal_facts: EXPECTED.multiple_equal_facts,
      soi_dimension: EXPECTED.excluded_soi_heads,
      num_dimension: EXPECTED.excluded_num_heads,
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
    assert.equal(headState(db, ID.purePlus, "PRINCIPAL_AMOUNT"), "UNKNOWN||410");
    assert.equal(headState(db, ID.dup, "PRINCIPAL_AMOUNT"), "UNKNOWN||800");
    assert.equal(headState(db, ID.wrongTag, "COST"), "UNKNOWN||990");

    // NUM-side exclusions: a dimensioned fact never binds; a plain fact beside one still does.
    assert.equal(headState(db, ID.numRange, "PRINCIPAL_AMOUNT"), "UNKNOWN||1100");
    assert.equal(headState(db, ID.numSub, "PRINCIPAL_AMOUNT"), "UNKNOWN||1200");
    assert.equal(headState(db, ID.numSubPlain, "PRINCIPAL_AMOUNT"), "FROM_NUM_UNIQUE_MATCH|USD|1300");
    assert.deepEqual(exclusionsFor(db, ID.numRange), ["PRINCIPAL_AMOUNT:1100:NUM_PROHIBITED_DIMENSION::RangeAxis:1100"]);
    assert.deepEqual(exclusionsFor(db, ID.numSub),
      ["PRINCIPAL_AMOUNT:1200:NUM_PROHIBITED_DIMENSION::InvestmentCompanyNonconsolidatedSubsidiaryAxis:1200"]);
    assert.deepEqual(exclusionsFor(db, ID.numSubPlain),
      ["PRINCIPAL_AMOUNT:1300:NUM_PROHIBITED_DIMENSION::InvestmentCompanyNonconsolidatedSubsidiaryAxis:1300"]);

    // SOI-side exclusions hold even when a plain equal-value fact exists.
    assert.equal(headState(db, ID.soiSub, "PRINCIPAL_AMOUNT"), "UNKNOWN||1400");
    assert.equal(headState(db, ID.soiSub, "COST"), "UNKNOWN||1390");
    assert.equal(headState(db, ID.soiRange, "PRINCIPAL_AMOUNT"), "UNKNOWN||1500");
    assert.deepEqual(exclusionsFor(db, ID.soiSub), [
      `COST:1390:SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS:${SUB_MEMBER}::`,
      `PRINCIPAL_AMOUNT:1400:SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS:${SUB_MEMBER}::`,
    ]);
    assert.deepEqual(exclusionsFor(db, ID.soiRange), ["PRINCIPAL_AMOUNT:1500:SOI_RANGE_AXIS:Maximum [Member]::"]);

    // Direct holding and JV share an identifier: the direct row binds to the plain fact, the
    // JV row stays UNKNOWN, and the JV-dimension fact is recorded as excluded for the direct row.
    assert.equal(headState(db, ID.jv, "PRINCIPAL_AMOUNT", 1600), "FROM_NUM_UNIQUE_MATCH|USD|1600");
    assert.equal(headState(db, ID.jv, "PRINCIPAL_AMOUNT", 1700), "UNKNOWN||1700");
    assert.deepEqual(exclusionsFor(db, ID.jv), [
      "PRINCIPAL_AMOUNT:1600:NUM_PROHIBITED_DIMENSION::InvestmentCompanyNonconsolidatedSubsidiaryAxis:1700",
      `PRINCIPAL_AMOUNT:1700:SOI_NONCONSOLIDATED_SUBSIDIARY_AXIS:${SUB_MEMBER}::`,
    ]);
    assert.equal(scalar(db, `
SELECT (n.segments_raw NOT LIKE '%NonconsolidatedSubsidiaryAxis%')::text
FROM obs.field_value_corroboration c
JOIN obs.num_fact_observation n ON n.id = c.num_fact_observation_id
JOIN obs.position_field_value fv ON fv.id = c.field_value_id
JOIN obs.position_observation p ON p.id = fv.position_observation_id
WHERE p.holding_descriptor_raw = '${ID.jv}' AND c.outcome = 'EQUAL'`), "true");

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
    assert.deepEqual(outcomes(ID.purePlus), ["MULTIPLE_CANDIDATES|"]);
    // Two equal facts in one currency: ambiguous, no EQUAL row, no linked fact.
    assert.deepEqual(outcomes(ID.dup), ["MULTIPLE_CANDIDATES|"]);
    for (const id of [ID.zero, ID.pure, ID.wrongTag, ID.numRange, ID.numSub, ID.soiSub, ID.soiRange]) {
      assert.deepEqual(outcomes(id), [], id);
    }

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
    assert.equal(scalar(db, `
SELECT count(*)::text FROM obs.position_field_value s
JOIN ops.rule_version rv ON rv.id = s.normalization_rule_version_id
WHERE s.supersedes_id IS NOT NULL AND rv.rule_code = 'obs.currency.from_num_unique_match' AND rv.version = '3'`),
    String(EXPECTED.promoted));
  },
));

test("a failing batch rolls back every write in it, including its checkpoint; an already-promoted head is not promoted again", withLoadedDbs(
  ["atomic"],
  async ([db], t) => {
    const bindRule = RULES.find((r) => r.code === "obs.currency.from_num_unique_match");
    const liveness = await openPipelineSession(db);
    t.after(() => liveness.close());
    const runId = (await liveness.query(`SELECT ops.start_num_currency_bind_run(
  'test-only', '{}'::jsonb, NULL, '${bindRule.version}', '${ruleDefinitionSha(bindRule)}')`)).trim();
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
       (SELECT count(*) FROM obs.field_value_corroboration) || '|' ||
       (SELECT count(*) FROM ops.num_currency_bind_batch)`);
    const checkpoint = (batchIndex) => ({
      batchIndex, firstHeadId: pairs[0].headId, lastHeadId: pairs[2].headId, heads: 3,
    });

    const failing = bindBatchSql({
      promotes: pairs,
      corroborations: [{ fieldValueId: pairs[0].headId, numFactId: 999999999, outcome: "NOT_EQUAL" }],
      checkpoint: checkpoint(1),
      runId: Number(runId),
      ruleId,
    });
    assert.throws(() => runScript(db, failing));
    assert.equal(counts(), "0|0|0");

    const ok = bindBatchSql({ promotes: pairs, corroborations: [], checkpoint: checkpoint(1), runId: Number(runId), ruleId });
    runScript(db, ok);
    assert.equal(counts(), "3|3|1");
    // The same batch again: checkpoint index 1 is taken, so the whole statement rolls back.
    assert.throws(() => runScript(db, ok), /batch_index must follow/);
    assert.equal(counts(), "3|3|1");
    runScript(db, bindBatchSql({ promotes: pairs, corroborations: [], checkpoint: { ...checkpoint(2), firstHeadId: pairs[2].headId + 1, lastHeadId: pairs[2].headId + 1, heads: 1 }, runId: Number(runId), ruleId }));
    assert.equal(counts(), "3|3|2");

    assert.throws(() => bindBatchSql({
      promotes: [{ ...pairs[0], currencyCode: "pure" }], corroborations: [], checkpoint: checkpoint(3), runId: Number(runId), ruleId,
    }), /not a currency code/);

    // Once the liveness session has ended, the next batch writes nothing.
    await liveness.close();
    const next = { promotes: [], corroborations: [], checkpoint: { ...checkpoint(3), firstHeadId: 2 ** 40, lastHeadId: 2 ** 40, heads: 1 }, runId: Number(runId), ruleId };
    assert.throws(() => runScript(db, bindBatchSql(next)), /bind write refused: run \d+ lost its liveness lock/);
    assert.equal(counts(), "3|3|2");
  },
));

const injected = (sql) => sql.replace(/\nEND\n\$bind\$;$/, "\n  RAISE EXCEPTION 'TEST ONLY injected batch failure';\nEND\n$bind$;");

async function failingRun(db, hooks) {
  let lines = [];
  const error = await runNumCurrencyBind({ database: db, log: (l) => lines.push(l), batchSize: 7, hooks })
    .then(() => null, (e) => e);
  assert.ok(error, "the run failed");
  assert.ok(Number.isSafeInteger(error.runId));
  lines = lines.join("\n");
  assert.match(lines, /FAILED/);
  return error;
}

test("failures before, during, and between batches record FAILED with committed counts; resume completes without duplicates", withLoadedDbs(
  ["ref", "before", "during", "between"],
  async ([refDb, beforeDb, duringDb, betweenDb]) => {
    await runNumCurrencyBind({ database: refDb, log: quiet, batchSize: 7 });
    const reference = exportBindState(refDb);

    const cases = [
      {
        db: beforeDb,
        hooks: { beforeBatch: (b) => { if (b.batchIndex === 1) throw new Error("TEST ONLY failure before batch 1"); } },
        committed: 0, failedBatch: 1, phase: "batch", message: /before batch 1/,
      },
      {
        db: duringDb,
        hooks: { batchSql: (sql, b) => (b.batchIndex === 3 ? injected(sql) : sql) },
        committed: 2, failedBatch: 3, phase: "batch", message: /injected batch failure/,
      },
      {
        db: betweenDb,
        hooks: { afterBatch: (b) => { if (b.batchIndex === 2) throw new Error("TEST ONLY failure after batch 2"); } },
        committed: 2, failedBatch: null, phase: "plan", message: /after batch 2/,
      },
    ];

    for (const c of cases) {
      const error = await failingRun(c.db, c.hooks);
      assert.match(error.message, c.message);
      const failed = runState(c.db, error.runId);
      assert.equal(failed.status, "FAILED");
      assert.match(failed.error, c.message);
      assert.equal(failed.counts.batches_committed, c.committed, c.db);
      assert.equal(failed.counts.failed_batch_index, c.failedBatch, c.db);
      assert.equal(failed.counts.failed_phase, c.phase, c.db);
      assert.equal(failed.counts.heads_considered, EXPECTED.heads_considered);
      if (c.failedBatch != null) {
        assert.ok(Number.isSafeInteger(failed.counts.failed_first_field_value_id));
        assert.ok(failed.counts.failed_last_field_value_id >= failed.counts.failed_first_field_value_id);
      }
      assertCheckpointsMatchWrites(c.db, error.runId);
      assert.equal(scalar(c.db, `
SELECT count(*)::text FROM obs.position_field_value WHERE run_id = ${error.runId} AND supersedes_id IS NOT NULL`),
      String(failed.counts.successors_committed));

      // A failed run cannot take more checkpoints.
      assert.throws(() => runScript(c.db, bindBatchSql({
        promotes: [], corroborations: [],
        checkpoint: { batchIndex: c.committed + 1, firstHeadId: 2 ** 40, lastHeadId: 2 ** 40, heads: 1 },
        runId: error.runId, ruleId: Number(scalar(c.db, `
SELECT rv.id FROM ops.run_rule_version rr JOIN ops.rule_version rv ON rv.id = rr.rule_version_id
WHERE rr.run_id = ${error.runId} AND rv.rule_code = 'obs.currency.from_num_unique_match'`)),
      })));

      const resumed = await runNumCurrencyBind({ database: c.db, log: quiet, batchSize: 7, resumeRunId: error.runId });
      const done = runState(c.db, resumed.runId);
      assert.equal(done.status, "SUCCEEDED");
      assert.equal(done.parameters.resumes_run_id, error.runId);
      assertCheckpointsMatchWrites(c.db, resumed.runId);
      assert.equal(failed.counts.successors_committed + resumed.totals.promoted, EXPECTED.promoted, c.db);
      assertSameExport(reference, exportBindState(c.db), `${c.db} after resume`);

      const audit = auditBindState(c.db);
      assert.equal(audit.disagreementCount, 0);
      for (const [check, n] of Object.entries(audit.integrity)) {
        if (check !== "num_facts_bound_to_more_than_one_head") assert.equal(n, 0, `${c.db}: ${check}`);
      }

      const runsBefore = scalar(c.db, "SELECT count(*)::text FROM ops.run");
      await assert.rejects(runNumCurrencyBind({ database: c.db, log: quiet, resumeRunId: error.runId }), /already resumed/);
      await assert.rejects(runNumCurrencyBind({ database: c.db, log: quiet, resumeRunId: resumed.runId }), /SUCCEEDED/);
      const otherRun = Number(scalar(c.db, "SELECT min(id)::text FROM ops.run WHERE run_kind <> 'NUM_CURRENCY_BIND'"));
      await assert.rejects(runNumCurrencyBind({ database: c.db, log: quiet, resumeRunId: otherRun }), /not NUM_CURRENCY_BIND/);
      await assert.rejects(runNumCurrencyBind({ database: c.db, log: quiet, resumeRunId: 2 ** 40 }), /does not exist/);
      assert.equal(scalar(c.db, "SELECT count(*)::text FROM ops.run"), runsBefore, "a refused resume starts no run");
    }
  },
));

function spawnNode(args) {
  const env = { ...process.env, BDC_PIPELINE_TEST_LOCAL: "1" };
  delete env.PIPELINE_DATABASE_URL;
  delete env.BDC_PIPELINE_ALLOW_HOSTED;
  delete env.DATABASE_URL;
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const proc = { child, out: "", err: "" };
  child.stdout.on("data", (d) => { proc.out += d; });
  child.stderr.on("data", (d) => { proc.err += d; });
  proc.done = new Promise((resolve) => {
    child.on("close", (status, signal) => resolve({ status, signal, out: proc.out, err: proc.err }));
  });
  return proc;
}

function spawnBinder(database, startAt, { resumeRunId = null, batchSize = 1 } = {}) {
  const code = `
const { runNumCurrencyBind } = await import(${JSON.stringify(BINDER_URL)});
while (Date.now() < ${startAt}) await new Promise((r) => setTimeout(r, 5));
const { runId, totals } = await runNumCurrencyBind({
  database: ${JSON.stringify(database)}, log: () => {}, batchSize: ${batchSize}, resumeRunId: ${resumeRunId},
});
process.stdout.write(JSON.stringify({ runId, totals }));`;
  return spawnNode(["--input-type=module", "-e", code]).done;
}

const CLI = fileURLToPath(new URL("../bind-num-currency.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, predicate, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (predicate()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function livenessLockHolders(db, runId) {
  return Number(scalar(db, `
SELECT count(*)::text FROM pg_locks l
WHERE l.locktype = 'advisory' AND l.granted AND l.classid = ${NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS}
  AND l.objid = ${Number(runId)} AND l.objsubid = 2
  AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`));
}

// A binder child that commits two batches, prints its run id, then blocks until killed.
function spawnPausedBinder(database) {
  const code = `
import { writeSync } from "node:fs";
const { runNumCurrencyBind } = await import(${JSON.stringify(BINDER_URL)});
let runId = null;
await runNumCurrencyBind({
  database: ${JSON.stringify(database)}, log: () => {}, batchSize: 7,
  hooks: {
    afterStart: (id) => { runId = id; },
    afterBatch: (b) => {
      if (b.batchIndex !== 2) return;
      writeSync(1, JSON.stringify({ runId, paused: b.batchIndex }) + "\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 600000);
    },
  },
});`;
  return spawnNode(["--input-type=module", "-e", code]);
}

const abandonCli = (db, runId, reason = "TEST ONLY binder killed with SIGKILL") => spawnNode([
  CLI, "--db", db, "--abandon", String(runId), "--actor", "integration test", "--reason", reason,
]).done;

test("a killed binder stays STARTED; abandon and resume are refused while it lives; abandon records ABORTED once; resume completes", withLoadedDbs(
  ["ref", "killed"],
  async ([refDb, db]) => {
    await runNumCurrencyBind({ database: refDb, log: quiet, batchSize: 7 });
    const reference = exportBindState(refDb);

    const binder = spawnPausedBinder(db);
    await waitFor("the binder to commit two batches", () => binder.out.includes('"paused":2'));
    const { runId } = JSON.parse(binder.out.trim().split("\n")[0]);
    const live = runState(db, runId);
    assert.equal(live.status, "STARTED");
    assert.equal(live.parameters.liveness_lock_class, NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS);
    assert.equal(livenessLockHolders(db, runId), 1, "the live binder holds its liveness lock");
    assert.equal(committedProgress(db, runId).batches_committed, 2);

    const runsBefore = scalar(db, "SELECT count(*)::text FROM ops.run");
    assert.throws(
      () => abandonNumCurrencyBind({ database: db, runId, actor: "integration test", reason: "TEST ONLY", log: quiet }),
      /abandon refused: run \d+ is still active \(its liveness lock is held\)$/,
    );
    const refusedCli = await abandonCli(db, runId);
    assert.equal(refusedCli.status, 1);
    assert.match(refusedCli.err, /abandon refused: run \d+ is still active/);
    await assert.rejects(runNumCurrencyBind({ database: db, log: quiet, resumeRunId: runId }), /is STARTED; it may still be running/);
    assert.equal(runState(db, runId).status, "STARTED", "refusals leave the live run STARTED");
    assert.equal(scalar(db, "SELECT count(*)::text FROM ops.run"), runsBefore, "a refused resume starts no run");
    assert.equal(scalar(db, "SELECT count(*)::text FROM ops.audit_event WHERE event_kind = 'NUM_CURRENCY_BIND_ABANDONED'"), "0");

    binder.child.kill("SIGKILL");
    const killed = await binder.done;
    assert.equal(killed.signal, "SIGKILL");
    assert.equal(runState(db, runId).status, "STARTED", "a killed binder writes no outcome");
    await waitFor("the killed binder's session to end", () => livenessLockHolders(db, runId) === 0);
    const progress = committedProgress(db, runId);
    assert.equal(progress.batches_committed, 2);

    const [a, b] = await Promise.all([abandonCli(db, runId), abandonCli(db, runId)]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [0, 1], `${a.err}\n${b.err}`);
    const loser = a.status === 1 ? a : b;
    assert.match(loser.err, /abandon refused: run \d+ is already ABORTED/);

    const aborted = runState(db, runId);
    assert.equal(aborted.status, "ABORTED");
    assert.deepEqual(aborted.counts, { abandoned: true, ...progress });
    assert.match(aborted.error, /^abandoned by integration test: TEST ONLY binder killed with SIGKILL/);
    assertCheckpointsMatchWrites(db, runId);
    assert.equal(scalar(db, `
SELECT count(*)::text FROM ops.audit_event
WHERE event_kind = 'NUM_CURRENCY_BIND_ABANDONED' AND subject_id = '${runId}' AND actor = 'integration test'`), "1");

    const resumed = await runNumCurrencyBind({ database: db, log: quiet, batchSize: 7, resumeRunId: runId });
    assert.equal(runState(db, resumed.runId).status, "SUCCEEDED");
    assert.equal(livenessLockHolders(db, resumed.runId), 0, "a finished run releases its liveness lock");
    assert.equal(progress.successors_committed + resumed.totals.promoted, EXPECTED.promoted);
    assertSameExport(reference, exportBindState(db), "after kill, abandon, and resume");
    const audit = auditBindState(db);
    assert.equal(audit.disagreementCount, 0);
    for (const [check, n] of Object.entries(audit.integrity)) {
      if (check !== "num_facts_bound_to_more_than_one_head") assert.equal(n, 0, check);
    }
    assert.throws(
      () => abandonNumCurrencyBind({ database: db, runId: resumed.runId, actor: "integration test", reason: "TEST ONLY", log: quiet }),
      /already SUCCEEDED/,
    );
  },
));

// A binder child whose liveness backend is terminated after batch 2 while the process keeps
// running. Abandon is tried before the loss and, optionally, after it. Prints one JSON line.
function spawnLivenessLossBinder(database, { abandonAfterLoss }) {
  const code = `
import { writeSync } from "node:fs";
const binder = await import(${JSON.stringify(BINDER_URL)});
const { queryRows } = await import(${JSON.stringify(DB_LIB_URL)});
const db = ${JSON.stringify(database)};
const lockedBy = (id) => "FROM pg_locks WHERE locktype = 'advisory' AND granted AND classid = "
  + binder.NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS + " AND objid = " + id + " AND objsubid = 2";
const holders = (id) => Number(queryRows(db, "SELECT count(*)::text " + lockedBy(id), { asWriter: false })[0][0]);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const abandon = (id, reason) => {
  try {
    return { counts: binder.abandonNumCurrencyBind({ database: db, runId: id, actor: "integration test", reason, log: () => {} }) };
  } catch (e) {
    return { refused: e.message };
  }
};
const out = { events: {} };
try {
  await binder.runNumCurrencyBind({
    database: db, log: () => {}, batchSize: 7,
    hooks: {
      afterStart: (id) => { out.runId = id; },
      afterBatch: (b) => {
        if (b.batchIndex !== 2) return;
        out.events.beforeLoss = abandon(out.runId, "TEST ONLY abandon while the binder holds its lock");
        out.events.terminated = Number(queryRows(db,
          "SELECT count(pg_terminate_backend(pid))::text " + lockedBy(out.runId), { asWriter: false })[0][0]);
        for (let i = 0; i < 300 && holders(out.runId) > 0; i += 1) sleep(100);
        out.events.holdersAfterLoss = holders(out.runId);
        if (${abandonAfterLoss}) out.events.afterLoss = abandon(out.runId, "TEST ONLY liveness connection lost");
      },
    },
  });
  out.result = "SUCCEEDED";
} catch (e) {
  out.result = "error";
  out.error = e.message;
  out.failedCounts = e.failedCounts ?? null;
}
writeSync(1, JSON.stringify(out) + "\\n");`;
  return spawnNode(["--input-type=module", "-e", code]).done;
}

test("a binder that loses its liveness connection writes no further batch; abandon cannot overlap a live write", withLoadedDbs(
  ["ref", "detect", "abandoned"],
  async ([refDb, detectDb, abandonedDb]) => {
    await runNumCurrencyBind({ database: refDb, log: quiet, batchSize: 7 });
    const reference = exportBindState(refDb);

    for (const [db, abandonAfterLoss] of [[detectDb, false], [abandonedDb, true]]) {
      const child = await spawnLivenessLossBinder(db, { abandonAfterLoss });
      assert.equal(child.status, 0, child.err);
      const out = JSON.parse(child.out.trim());
      const { runId } = out;
      assert.match(out.events.beforeLoss.refused, /abandon refused: run \d+ is still active \(its liveness lock is held\)/);
      assert.equal(out.events.terminated, 1, "the binder's liveness backend was terminated");
      assert.equal(out.events.holdersAfterLoss, 0, "the liveness lock is gone while the binder process runs on");
      assert.equal(out.result, "error", `${db}: the binder stopped`);
      assert.match(out.error, /bind write refused: run \d+ lost its liveness lock/);

      const stored = runState(db, runId);
      assert.equal(Number(scalar(db, `SELECT count(*)::text FROM ops.num_currency_bind_batch WHERE run_id = ${runId}`)), 2,
        `${db}: no batch committed after the loss`);
      assertCheckpointsMatchWrites(db, runId);

      if (abandonAfterLoss) {
        assert.equal(out.events.afterLoss.counts.batches_committed, 2);
        assert.equal(stored.status, "ABORTED");
        assert.match(stored.error, /the run's database session had ended, so no later write of this run can commit/);
        assert.match(out.error, /FAILED outcome could not be recorded .*its stored status is ABORTED$/s);
        assert.equal(out.failedCounts, null, "the binder does not claim a FAILED outcome it could not write");
      } else {
        assert.equal(stored.status, "FAILED");
        assert.match(stored.error, /lost its liveness lock/);
        assert.equal(stored.counts.failed_phase, "batch");
        assert.equal(stored.counts.failed_batch_index, 3);
        assert.equal(stored.counts.batches_committed, 2);
        assert.deepEqual(out.failedCounts, stored.counts);
        assert.throws(
          () => abandonNumCurrencyBind({ database: db, runId, actor: "integration test", reason: "TEST ONLY", log: quiet }),
          /abandon refused: run \d+ is already FAILED/,
        );
      }

      const resumed = await runNumCurrencyBind({ database: db, log: quiet, batchSize: 7, resumeRunId: runId });
      assert.equal(runState(db, resumed.runId).status, "SUCCEEDED");
      assertSameExport(reference, exportBindState(db), `${db} after resume`);
    }
  },
));

test("two concurrent resumes of one failed run: exactly one claims it and the other starts no run", withLoadedDbs(
  ["ref", "race"],
  async ([refDb, db]) => {
    await runNumCurrencyBind({ database: refDb, log: quiet, batchSize: 7 });
    const reference = exportBindState(refDb);
    const failed = await failingRun(db, { batchSql: (sql, b) => (b.batchIndex === 3 ? injected(sql) : sql) });
    const runsBefore = Number(scalar(db, "SELECT count(*)::text FROM ops.run"));

    const startAt = Date.now() + 2000;
    const results = await Promise.all([0, 1].map(() => spawnBinder(db, startAt, { resumeRunId: failed.runId, batchSize: 7 })));
    const winners = results.filter((r) => r.status === 0);
    const losers = results.filter((r) => r.status !== 0);
    assert.equal(winners.length, 1, results.map((r) => r.err).join("\n"));
    assert.equal(losers.length, 1);
    assert.match(losers[0].err, /resume refused: run \d+ was already resumed by run \d+/);

    const winner = JSON.parse(winners[0].out);
    assert.equal(Number(scalar(db, "SELECT count(*)::text FROM ops.run")), runsBefore + 1, "the losing resume inserted no run");
    assert.equal(scalar(db, `
SELECT string_agg(run_id::text, ',') FROM ops.num_currency_bind_resume WHERE prior_run_id = ${failed.runId}`), String(winner.runId));
    assert.equal(runState(db, winner.runId).status, "SUCCEEDED");
    assert.equal(runState(db, winner.runId).parameters.resumes_run_id, failed.runId);
    assertSameExport(reference, exportBindState(db), "after a concurrent resume race");
  },
));

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
    assert.equal(ra.totals.exclusion_rows + rb.totals.exclusion_rows, EXPECTED.exclusion_rows);
    for (const run of [ra, rb]) assertCheckpointsMatchWrites(concurrentDb, run.runId);

    assertSameExport(exportBindState(singleDb), exportBindState(concurrentDb), "concurrent");
  },
));
