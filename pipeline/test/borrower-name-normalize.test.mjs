import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBorrowerName } from "../normalize/borrower-name.mjs";
import {
  BORROWER_NAME_SUPERSEDE_REASON,
  BorrowerNameHeadConflictError,
  planBorrowerNameNormalize,
  planBorrowerNameSuccessor,
} from "../load/borrower-name-normalize.mjs";

const RULE = { id: 15, code: "norm.borrower_name", version: "1" };
const PARSER_RULE_ID = 34;
const RAW = "TEST BORROWER A";

function root(id, extras = {}) {
  return {
    id,
    positionObservationId: 1000 + id,
    evidenceId: 2000 + id,
    rawText: RAW,
    nameSource: "FILING_CELL",
    sourceColumnLabel: null,
    sourceColumnPosition: null,
    extractionState: "RAW_ONLY",
    normalizedText: null,
    ruleVersionId: PARSER_RULE_ID,
    supersedesId: null,
    ...extras,
  };
}

function normalizedHead(id, supersedesId, extras = {}) {
  const source = root(supersedesId);
  return {
    ...source,
    id,
    extractionState: "EXTRACTED",
    normalizedText: normalizeBorrowerName(source.rawText).normalizedText,
    ruleVersionId: RULE.id,
    supersedesId,
    ...extras,
  };
}

test("a root with no successor plans exactly one successor", () => {
  const filing = root(1);
  const plan = planBorrowerNameSuccessor(filing, [filing], RULE);
  const expected = normalizeBorrowerName(RAW);
  assert.equal(plan.action, "insert");
  assert.equal(plan.successor.supersedesId, 1);
  assert.equal(plan.successor.positionObservationId, filing.positionObservationId);
  assert.equal(plan.successor.evidenceId, filing.evidenceId);
  assert.equal(plan.successor.rawText, RAW);
  assert.equal(plan.successor.nameSource, "FILING_CELL");
  assert.equal(plan.successor.sourceColumnLabel, null);
  assert.equal(plan.successor.sourceColumnPosition, null);
  assert.equal(plan.successor.extractionState, expected.extractionState);
  assert.equal(plan.successor.normalizedText, expected.normalizedText);
  assert.equal(plan.successor.ruleVersionId, RULE.id);
  assert.equal(plan.successor.supersedeReason, BORROWER_NAME_SUPERSEDE_REASON);
  assert.equal(Object.hasOwn(plan.successor, "id"), false);
});

test("a rerun against the original root after its successor exists inserts nothing", () => {
  const filing = root(1);
  const head = normalizedHead(5, 1);
  const plan = planBorrowerNameNormalize([filing], [filing, head], RULE);
  assert.deepEqual(plan.inserts, []);
  assert.deepEqual(plan.skips, [{ action: "skip", rootId: 1, currentHeadId: 5 }]);
});

test("a current head already normalized by the same rule, state, and text inserts nothing", () => {
  const filing = root(1, {
    extractionState: "EXTRACTED",
    normalizedText: normalizeBorrowerName(RAW).normalizedText,
    ruleVersionId: RULE.id,
  });
  const plan = planBorrowerNameSuccessor(filing, [filing], RULE);
  assert.deepEqual(plan, { action: "skip", rootId: 1, currentHeadId: 1 });
});

test("a conflicting current head fails and plans no insert", () => {
  const filing = root(1);
  const head = normalizedHead(6, 1, { normalizedText: "TEST BORROWER B" });
  assert.throws(
    () => planBorrowerNameNormalize([filing], [filing, head], RULE),
    (error) => {
      assert.ok(error instanceof BorrowerNameHeadConflictError);
      assert.equal(error.rootId, 1);
      assert.equal(error.currentHeadId, 6);
      assert.match(error.message, /current head 6 conflicts with norm\.borrower_name v1/);
      assert.match(error.message, /TEST BORROWER B/);
      assert.match(error.message, /expected rule_version_id 15, extraction_state EXTRACTED/);
      return true;
    },
  );
});

test("a different rule or state on the current head is a conflict", () => {
  const filing = root(2);
  assert.throws(
    () => planBorrowerNameSuccessor(filing, [filing, normalizedHead(7, 2, { ruleVersionId: 99 })], RULE),
    (error) => error instanceof BorrowerNameHeadConflictError && error.currentHeadId === 7,
  );
  assert.throws(
    () => planBorrowerNameSuccessor(filing, [filing, normalizedHead(8, 2, { extractionState: "UNRESOLVED", normalizedText: null })], RULE),
    (error) => error instanceof BorrowerNameHeadConflictError && error.currentHeadId === 8,
  );
});

test("raw text may differ when the current head already has the normalized result", () => {
  const filing = root(1, { rawText: `  ${RAW}  ` });
  const head = normalizedHead(5, 1, { rawText: "TEST BORROWER A OTHER RAW" });
  const plan = planBorrowerNameSuccessor(filing, [filing, head], RULE);
  assert.deepEqual(plan, { action: "skip", rootId: 1, currentHeadId: 5 });
});

test("a multi-generation chain resolves the current head and stays idempotent", () => {
  const filing = root(1);
  const middle = normalizedHead(5, 1, {
    ruleVersionId: 99,
    normalizedText: "TEST BORROWER B",
  });
  const head = normalizedHead(9, 5, {
    positionObservationId: filing.positionObservationId,
    evidenceId: filing.evidenceId,
  });
  const plan = planBorrowerNameSuccessor(filing, [filing, middle, head], RULE);
  assert.deepEqual(plan, { action: "skip", rootId: 1, currentHeadId: 9 });
});

test("a multi-generation chain whose current head conflicts names that head", () => {
  const filing = root(1);
  const middle = normalizedHead(5, 1);
  const head = normalizedHead(9, 5, { normalizedText: "TEST BORROWER B" });
  assert.throws(
    () => planBorrowerNameSuccessor(filing, [filing, middle, head], RULE),
    (error) => error instanceof BorrowerNameHeadConflictError && error.currentHeadId === 9 && !error.message.includes("current head 5"),
  );
});

test("a second successor on one row is refused and nothing is planned", () => {
  const filing = root(1);
  const first = normalizedHead(5, 1);
  const second = normalizedHead(6, 1);
  assert.throws(
    () => planBorrowerNameSuccessor(filing, [filing, first, second], RULE),
    /borrower name 1 has more than one successor/,
  );
});

test("plans only insert or skip and never rewrite an existing row", () => {
  const filings = [1, 2, 3, 4].map((id) => root(id));
  const first = planBorrowerNameNormalize(filings, filings, RULE);
  assert.equal(first.inserts.length, 4);
  assert.deepEqual(first.skips, []);
  for (const plan of first.inserts) {
    assert.equal(plan.action, "insert");
    assert.equal(plan.successor.supersedesId, plan.rootId);
    assert.equal(JSON.stringify(plan).includes("UPDATE"), false);
    assert.equal(JSON.stringify(plan).includes("DELETE"), false);
  }
  const heads = filings.map((filing) => normalizedHead(filing.id + 4, filing.id));
  const rerun = planBorrowerNameNormalize(filings, [...filings, ...heads], RULE);
  assert.deepEqual(rerun.inserts, []);
  assert.deepEqual(rerun.skips.map((plan) => plan.currentHeadId), [5, 6, 7, 8]);
  for (const plan of rerun.skips) assert.equal(plan.action, "skip");
});

test("four RAW_ONLY filing-cell roots plan four successors and the rerun plans none", () => {
  const filings = [1, 2, 3, 4].map((id) => root(id));
  const planned = planBorrowerNameNormalize(filings, filings, RULE);
  assert.equal(planned.inserts.length, 4);
  assert.deepEqual(planned.inserts.map((plan) => plan.successor.evidenceId), [2001, 2002, 2003, 2004]);
  assert.deepEqual(planned.inserts.map((plan) => plan.successor.supersedesId), [1, 2, 3, 4]);
  const stored = planned.inserts.map((plan, index) => normalizedHead(index + 5, plan.rootId));
  const rerun = planBorrowerNameNormalize(filings, [...filings, ...stored], RULE);
  assert.equal(rerun.inserts.length, 0);
  assert.equal(rerun.skips.length, 4);
});
