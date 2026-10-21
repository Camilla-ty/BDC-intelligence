import test from "node:test";
import assert from "node:assert/strict";
import {
  EXCLUSION_REASONS,
  isoCurrencyCode,
  planCurrencyBind,
  prohibitedNumAxes,
} from "../normalize/num-currency-bind.mjs";
import { readFileSync } from "node:fs";
import {
  NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS,
  NUM_CURRENCY_BIND_LOCK_KEY,
  abandonNumCurrencyBind,
  bindBatchSql,
  runNumCurrencyBind,
} from "../load/num-currency-bind.mjs";
import { MATURITY_WORKER_LOCK_KEY } from "../load/maturity-worker-lock.mjs";

const head = (extra = {}) => ({
  id: 1,
  field_code: "PRINCIPAL_AMOUNT",
  normalized_numeric: "100",
  currency_state: "UNKNOWN",
  soi_subsidiary_axis: null,
  soi_range_axis: null,
  ...extra,
});

const fact = (extra = {}) => ({
  id: 10,
  tag: "InvestmentOwnedBalancePrincipalAmount",
  value_numeric: "100",
  uom_raw: "USD",
  segments_raw: "InvestmentIdentifierAxis=TEST ONLY;",
  ...extra,
});

const RANGE_SEGMENTS = "InvestmentIdentifierAxis=TEST ONLY;RangeAxis(srt/2099)=MaximumMember(srt/2099);";
const SUBSIDIARY_SEGMENTS =
  "InvestmentCompanyNonconsolidatedSubsidiaryAxis(us-gaap/2099)=TestOnlyMember(test);InvestmentIdentifierAxis=TEST ONLY;";

const checkpoint = { batchIndex: 1, firstHeadId: 11, lastHeadId: 12, heads: 2 };

test("isoCurrencyCode accepts only three-letter uppercase codes", () => {
  assert.equal(isoCurrencyCode("USD"), "USD");
  assert.equal(isoCurrencyCode("EUR"), "EUR");
  assert.equal(isoCurrencyCode("pure"), null);
  assert.equal(isoCurrencyCode("Rate"), null);
  assert.equal(isoCurrencyCode("shares"), null);
  assert.equal(isoCurrencyCode("usd"), null);
  assert.equal(isoCurrencyCode("US"), null);
});

test("one eligible equal-value fact with a currency code binds", () => {
  assert.deepEqual(planCurrencyBind({ fieldValue: head(), numFacts: [fact()] }), {
    action: "promote",
    currencyCode: "USD",
    numFactId: 10,
    reason: "unique_fact",
    numExclusions: [],
  });
});

test("two equal-value facts in the same currency do not bind", () => {
  const plan = planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ id: 1 }), fact({ id: 2 })],
  });
  assert.equal(plan.action, "multiple");
  assert.equal(plan.reason, "multiple_equal_facts");
  assert.equal(plan.currencyCode, undefined);
  assert.equal(plan.numFactId, undefined);
});

test("equal-value facts in different currencies do not bind", () => {
  const plan = planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ id: 1, uom_raw: "USD" }), fact({ id: 2, uom_raw: "EUR" })],
  });
  assert.equal(plan.action, "multiple");
  assert.equal(plan.reason, "multiple_units");
});

test("an equal currency fact beside an equal non-currency fact does not bind", () => {
  const plan = planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ id: 1, uom_raw: "pure" }), fact({ id: 2, uom_raw: "USD" })],
  });
  assert.equal(plan.action, "multiple");
  assert.equal(plan.reason, "multiple_units");
});

test("zero match leaves unchanged", () => {
  assert.deepEqual(planCurrencyBind({ fieldValue: head(), numFacts: [] }), {
    action: "skip",
    reason: "zero_match",
    numExclusions: [],
  });
});

test("non-currency uom does not promote", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ uom_raw: "pure" })],
  }), { action: "skip", reason: "non_currency_uom", numExclusions: [] });
});

test("value mismatch with a unique eligible fact records not_equal", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ value_numeric: "99" })],
  }), { action: "not_equal", numFactId: 10, reason: "value_mismatch", numExclusions: [] });
});

test("prohibited NUM axes are found on any pair boundary, typed or plain", () => {
  assert.deepEqual(prohibitedNumAxes(RANGE_SEGMENTS), ["RangeAxis"]);
  assert.deepEqual(prohibitedNumAxes(SUBSIDIARY_SEGMENTS), ["InvestmentCompanyNonconsolidatedSubsidiaryAxis"]);
  assert.deepEqual(prohibitedNumAxes("RangeAxis=MaximumMember;"), ["RangeAxis"]);
  assert.deepEqual(prohibitedNumAxes("InvestmentIdentifierAxis=TEST ONLY;"), []);
  assert.deepEqual(prohibitedNumAxes("InvestmentIdentifierAxis=TEST RangeAxis ONLY;"), []);
  assert.deepEqual(prohibitedNumAxes("TestOnlyRangeAxis=X;"), []);
  assert.deepEqual(prohibitedNumAxes(null), []);
  assert.deepEqual(prohibitedNumAxes(""), []);
});

test("a NUM fact with RangeAxis is excluded and recorded", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ segments_raw: RANGE_SEGMENTS })],
  }), { action: "exclude", reason: "num_dimension", numExclusions: [{ numFactId: 10, axis: "RangeAxis" }] });
});

test("a NUM fact with the nonconsolidated-subsidiary axis is excluded and recorded", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ segments_raw: SUBSIDIARY_SEGMENTS })],
  }), {
    action: "exclude",
    reason: "num_dimension",
    numExclusions: [{ numFactId: 10, axis: "InvestmentCompanyNonconsolidatedSubsidiaryAxis" }],
  });
});

test("a plain fact still binds beside an excluded dimensioned fact, which is recorded", () => {
  const plan = planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ id: 1, segments_raw: SUBSIDIARY_SEGMENTS }), fact({ id: 2 })],
  });
  assert.equal(plan.action, "promote");
  assert.equal(plan.numFactId, 2);
  assert.deepEqual(plan.numExclusions, [{ numFactId: 1, axis: "InvestmentCompanyNonconsolidatedSubsidiaryAxis" }]);
});

test("a non-empty SOI subsidiary cell excludes the head even when a plain fact matches", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head({ soi_subsidiary_axis: "TEST ONLY Subsidiary [Member]" }),
    numFacts: [fact()],
  }), {
    action: "exclude",
    reason: "soi_dimension",
    soiExclusions: [EXCLUSION_REASONS.SOI_SUBSIDIARY],
    numExclusions: [],
  });
});

test("a non-empty SOI range cell excludes the head", () => {
  const plan = planCurrencyBind({ fieldValue: head({ soi_range_axis: "Maximum [Member]" }), numFacts: [fact()] });
  assert.equal(plan.action, "exclude");
  assert.deepEqual(plan.soiExclusions, [EXCLUSION_REASONS.SOI_RANGE]);
});

test("both SOI cells record both reasons; a whitespace-only cell is not blank", () => {
  const plan = planCurrencyBind({
    fieldValue: head({ soi_subsidiary_axis: " ", soi_range_axis: "Minimum [Member]" }),
    numFacts: [fact()],
  });
  assert.deepEqual(plan.soiExclusions, [EXCLUSION_REASONS.SOI_SUBSIDIARY, EXCLUSION_REASONS.SOI_RANGE]);
  assert.equal(planCurrencyBind({ fieldValue: head({ soi_range_axis: "" }), numFacts: [fact()] }).action, "promote");
});

test("issuer identity alone never supplies USD", () => {
  assert.equal(planCurrencyBind({
    fieldValue: head({ field_code: "COST" }),
    numFacts: [],
  }).action, "skip");
  assert.equal(isoCurrencyCode("TEST BDC 1"), null);
});

test("wrong tag is ignored for the field", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head({ field_code: "COST" }),
    numFacts: [fact({ tag: "InvestmentOwnedBalancePrincipalAmount" })],
  }), { action: "skip", reason: "zero_match", numExclusions: [] });
});

test("a head that is not UNKNOWN is never planned", () => {
  assert.equal(planCurrencyBind({ fieldValue: head({ currency_state: "FROM_FILING" }), numFacts: [fact()] }).reason,
    "head_not_unknown");
});

test("a batch with no writes still writes its checkpoint under the lock", () => {
  const sql = bindBatchSql({ promotes: [], corroborations: [], checkpoint, runId: 1, ruleId: 2 });
  assert.match(sql, /^DO \$bind\$/);
  assert.match(sql, new RegExp(`pg_advisory_xact_lock\\(${NUM_CURRENCY_BIND_LOCK_KEY}\\)`));
  assert.match(sql, /INSERT INTO ops\.num_currency_bind_batch/);
  assert.match(sql, /VALUES \(1, 2, 1, 11, 12, 2,/);
  assert.doesNotMatch(sql, /INSERT INTO obs\./);
});

test("a batch is one locked DO statement that checks one EQUAL row per successor", () => {
  const sql = bindBatchSql({
    promotes: [{ headId: 11, currencyCode: "EUR", numFactId: 21 }],
    corroborations: [{ fieldValueId: 12, numFactId: null, outcome: "MULTIPLE_CANDIDATES" }],
    soiExclusions: [{ fieldValueId: 13, reason: EXCLUSION_REASONS.SOI_RANGE }],
    numExclusions: [{ fieldValueId: 11, numFactId: 22, axis: "RangeAxis" }],
    checkpoint,
    runId: 1,
    ruleId: 2,
  });
  assert.match(sql, /^DO \$bind\$/);
  assert.match(sql, new RegExp(`pg_advisory_xact_lock\\(${NUM_CURRENCY_BIND_LOCK_KEY}\\)`));
  assert.match(sql, /IF equal_rows <> successors THEN/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM obs\.position_field_value s WHERE s\.supersedes_id = h\.id\)/);
  assert.match(sql, /\(11::bigint, 'EUR'::text, 21::bigint\)/);
  assert.match(sql, /\(12::bigint, NULL::bigint, 'MULTIPLE_CANDIDATES'::ref\.corroboration_outcome\)/);
  assert.match(sql, /\(13::bigint, 'SOI_RANGE_AXIS'::text, 'Range Axis'::text\)/);
  assert.match(sql, /\(11::bigint, 22::bigint, 'RangeAxis'::text\)/);
  assert.ok(sql.indexOf("ops.num_currency_bind_batch") > sql.indexOf("field_value_currency_exclusion"),
    "the checkpoint is the last write in the batch");
  assert.notEqual(NUM_CURRENCY_BIND_LOCK_KEY, MATURITY_WORKER_LOCK_KEY);
});

test("a batch refuses a non-currency code, an unexpected outcome, or an unknown SOI reason", () => {
  assert.throws(() => bindBatchSql({
    promotes: [{ headId: 1, currencyCode: "pure", numFactId: 2 }], corroborations: [], checkpoint, runId: 1, ruleId: 2,
  }), /not a currency code/);
  assert.throws(() => bindBatchSql({
    promotes: [], corroborations: [{ fieldValueId: 1, numFactId: 2, outcome: "EQUAL" }], checkpoint, runId: 1, ruleId: 2,
  }), /unexpected corroboration outcome/);
  assert.throws(() => bindBatchSql({
    promotes: [], corroborations: [], soiExclusions: [{ fieldValueId: 1, reason: "NUM_PROHIBITED_DIMENSION" }],
    checkpoint, runId: 1, ruleId: 2,
  }), /unexpected SOI exclusion reason/);
});

test("the liveness lock class matches migration 0068 and fits a two-int advisory key", () => {
  const migration = readFileSync(new URL("../../db/migrations/0068_num_currency_bind_run_recovery.sql", import.meta.url), "utf8");
  assert.ok(Number.isInteger(NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS) && NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS <= 2 ** 31 - 1);
  assert.match(migration, new RegExp(`pg_advisory_lock\\(${NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS}, new_id::integer\\)`));
  assert.match(migration, new RegExp(`pg_try_advisory_xact_lock\\(${NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS}, p_run_id::integer\\)`));
  assert.match(migration, new RegExp(`pg_advisory_xact_lock\\(${NUM_CURRENCY_BIND_LOCK_KEY}\\)`), "abandon waits for any batch in flight");
});

test("every batch checks the run's liveness lock under the batch lock, before its first write", () => {
  const sql = bindBatchSql({
    promotes: [{ headId: 11, currencyCode: "USD", numFactId: 21 }], corroborations: [], checkpoint, runId: 7, ruleId: 2,
  });
  const lock = sql.indexOf(`pg_advisory_xact_lock(${NUM_CURRENCY_BIND_LOCK_KEY})`);
  const live = sql.indexOf("PERFORM ops.assert_num_currency_bind_live(7);");
  const firstWrite = sql.indexOf("INSERT INTO");
  assert.ok(lock > 0 && live > lock && firstWrite > live, "lock, then liveness check, then writes");
  const migration = readFileSync(new URL("../../db/migrations/0069_num_currency_bind_liveness_fence.sql", import.meta.url), "utf8");
  assert.match(migration, new RegExp(`l\\.classid = ${NUM_CURRENCY_BIND_LIVENESS_LOCK_CLASS}\\b`));
  assert.match(migration, new RegExp(`pg_advisory_xact_lock\\(${NUM_CURRENCY_BIND_LOCK_KEY}\\)`), "abandon takes the batch lock");
});

const MIGRATION_0070 = "0070_num_currency_bind_terminal_run_fence.sql";
const readMigration = (name) => readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), "utf8");

test("migration 0070 changes only the 0069 liveness wording, not the fence or abandon logic", () => {
  const functions = (sql) => [...sql.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION (ops\.(?:assert_num_currency_bind_live|abandon_num_currency_bind_run)\([\s\S]*?^\$\$;$)/gm)]
    .map((m) => m[1]);
  const before = functions(readMigration("0069_num_currency_bind_liveness_fence.sql"));
  const after = functions(readMigration(MIGRATION_0070));
  assert.equal(before.length, 2);
  assert.equal(after.length, 2);
  const reworded = before.map((body) => body
    .replace("lost its liveness lock (its database session ended)", "lost its liveness lock (no database session holds it)")
    .replace("liveness lock was free: the run''s database session had ended, so no later write of this run can commit",
      "liveness lock was free: no database session held it, so no later bind batch, rule link, or outcome of this run can commit"));
  assert.notDeepEqual(reworded, before, "both 0069 messages were found");
  assert.deepEqual(after, reworded);
});

test("migration 0070 refuses a finished bind run's rule link only after the batch lock", () => {
  const sql = readMigration(MIGRATION_0070);
  const body = /CREATE FUNCTION ops\.check_num_currency_bind_rule_link\(\)[\s\S]*?^\$\$;$/m.exec(sql)?.[0] ?? "";
  const kind = body.indexOf("r.run_kind = 'NUM_CURRENCY_BIND'");
  const lock = body.indexOf(`PERFORM pg_advisory_xact_lock(${NUM_CURRENCY_BIND_LOCK_KEY});`);
  const outcome = body.indexOf("FROM ops.run_outcome o WHERE o.run_id = NEW.run_id");
  assert.ok(kind > 0 && lock > kind && outcome > lock, "bind runs only, then the batch lock, then the outcome check");
  assert.match(sql, /CREATE TRIGGER check_num_currency_bind_rule_link BEFORE INSERT ON ops\.run_rule_version\s+FOR EACH ROW/);
});

test("abandon refuses a bad run id, a blank actor, or a blank reason before touching the database", () => {
  const base = { database: "bdc_never_opened", runId: 1, actor: "test", reason: "TEST ONLY", log: () => {} };
  assert.throws(() => abandonNumCurrencyBind({ ...base, runId: 0 }), /invalid --abandon run id/);
  assert.throws(() => abandonNumCurrencyBind({ ...base, runId: 1.5 }), /invalid --abandon run id/);
  assert.throws(() => abandonNumCurrencyBind({ ...base, actor: " " }), /--actor is required/);
  assert.throws(() => abandonNumCurrencyBind({ ...base, reason: undefined }), /--reason is required/);
});

test("a resume refuses a bad run id before opening a session", async () => {
  await assert.rejects(runNumCurrencyBind({ database: "bdc_never_opened", resumeRunId: -3, log: () => {} }),
    /invalid --resume run id/);
});
