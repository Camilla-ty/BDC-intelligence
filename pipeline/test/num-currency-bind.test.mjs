import test from "node:test";
import assert from "node:assert/strict";
import {
  isoCurrencyCode,
  planCurrencyBind,
} from "../normalize/num-currency-bind.mjs";
import { NUM_CURRENCY_BIND_LOCK_KEY, bindBatchSql } from "../load/num-currency-bind.mjs";
import { MATURITY_WORKER_LOCK_KEY } from "../load/maturity-worker-lock.mjs";

const head = (extra = {}) => ({
  id: 1,
  field_code: "PRINCIPAL_AMOUNT",
  normalized_numeric: "100",
  currency_state: "UNKNOWN",
  ...extra,
});

const fact = (extra = {}) => ({
  id: 10,
  tag: "InvestmentOwnedBalancePrincipalAmount",
  value_numeric: "100",
  uom_raw: "USD",
  ...extra,
});

test("isoCurrencyCode accepts only three-letter uppercase codes", () => {
  assert.equal(isoCurrencyCode("USD"), "USD");
  assert.equal(isoCurrencyCode("EUR"), "EUR");
  assert.equal(isoCurrencyCode("pure"), null);
  assert.equal(isoCurrencyCode("Rate"), null);
  assert.equal(isoCurrencyCode("shares"), null);
  assert.equal(isoCurrencyCode("usd"), null);
  assert.equal(isoCurrencyCode("US"), null);
});

test("unique value+currency match promotes", () => {
  assert.deepEqual(planCurrencyBind({ fieldValue: head(), numFacts: [fact()] }), {
    action: "promote",
    currencyCode: "USD",
    numFactId: 10,
    reason: "unique_match",
  });
});

test("zero match leaves unchanged", () => {
  assert.deepEqual(planCurrencyBind({ fieldValue: head(), numFacts: [] }), {
    action: "skip",
    reason: "zero_match",
  });
});

test("multiple incompatible currencies leave unresolved", () => {
  const plan = planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ id: 1, uom_raw: "USD" }), fact({ id: 2, uom_raw: "EUR" })],
  });
  assert.equal(plan.action, "multiple");
  assert.equal(plan.reason, "multiple_currencies");
});

test("non-currency uom does not promote", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ uom_raw: "pure" })],
  }), { action: "skip", reason: "non_currency_uom" });
});

test("value mismatch with a unique key fact records not_equal", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ value_numeric: "99" })],
  }), { action: "not_equal", numFactId: 10, reason: "value_mismatch" });
});

test("same currency on duplicate equal facts still promotes once", () => {
  const plan = planCurrencyBind({
    fieldValue: head(),
    numFacts: [fact({ id: 1 }), fact({ id: 2 })],
  });
  assert.equal(plan.action, "promote");
  assert.equal(plan.currencyCode, "USD");
});

test("issuer identity alone never supplies USD", () => {
  // No NUM facts: even if the caller knows the registrant, planner stays skip.
  assert.equal(planCurrencyBind({
    fieldValue: head({ field_code: "COST" }),
    numFacts: [],
  }).action, "skip");
  assert.equal(isoCurrencyCode("TEST BDC 1"), null);
});

test("an empty batch writes nothing", () => {
  assert.equal(bindBatchSql({ promotes: [], corroborations: [], runId: 1, ruleId: 2 }), "");
});

test("a batch is one locked DO statement that checks one EQUAL row per successor", () => {
  const sql = bindBatchSql({
    promotes: [{ headId: 11, currencyCode: "EUR", numFactId: 21 }],
    corroborations: [{ fieldValueId: 12, numFactId: null, outcome: "MULTIPLE_CANDIDATES" }],
    runId: 1,
    ruleId: 2,
  });
  assert.match(sql, /^DO \$bind\$/);
  assert.match(sql, new RegExp(`pg_advisory_xact_lock\\(${NUM_CURRENCY_BIND_LOCK_KEY}\\)`));
  assert.match(sql, /IF equal_rows <> successors THEN/);
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM obs\.position_field_value s WHERE s\.supersedes_id = h\.id\)/);
  assert.match(sql, /\(11::bigint, 'EUR'::text, 21::bigint\)/);
  assert.match(sql, /\(12::bigint, NULL::bigint, 'MULTIPLE_CANDIDATES'::ref\.corroboration_outcome\)/);
  assert.notEqual(NUM_CURRENCY_BIND_LOCK_KEY, MATURITY_WORKER_LOCK_KEY);
});

test("a batch refuses a non-currency code or an unexpected outcome", () => {
  assert.throws(() => bindBatchSql({
    promotes: [{ headId: 1, currencyCode: "pure", numFactId: 2 }], corroborations: [], runId: 1, ruleId: 2,
  }), /not a currency code/);
  assert.throws(() => bindBatchSql({
    promotes: [], corroborations: [{ fieldValueId: 1, numFactId: 2, outcome: "EQUAL" }], runId: 1, ruleId: 2,
  }), /unexpected corroboration outcome/);
});

test("wrong tag is ignored for the field", () => {
  assert.deepEqual(planCurrencyBind({
    fieldValue: head({ field_code: "COST" }),
    numFacts: [fact({ tag: "InvestmentOwnedBalancePrincipalAmount" })],
  }), { action: "skip", reason: "zero_match" });
});
