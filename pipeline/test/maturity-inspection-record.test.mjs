import test from "node:test";
import assert from "node:assert/strict";
import { NO_BIND_REASON } from "../normalize/maturity-context-bind.mjs";
import {
  noBindReasonOf, planInspection, recordFilingInspections,
} from "../load/maturity-inspection-batch.mjs";

const RULE = { ruleId: 2, ruleVersion: "2" };
const OLD_RULE_ID = 1;

function unbound(noBindReason, reason = "test-only reason") {
  return { outcome: "UNKNOWN", contextId: null, facts: [], reason, noBindReason };
}

function displayed(contextId, rawValue) {
  return { outcome: "FILING_DISPLAYED", contextId, facts: [{ id: "f-1" }], rawValue, normalizedDate: "2099-01-02", reason: null };
}

function currentDisplayed(id, ruleId, contextId = "c-1", rawValue = "1/2/2099") {
  return { id, state: "FILING_DISPLAYED", contextId, rawValue, noBindReason: null, ruleId };
}

function currentNotBound(id, ruleId, noBindReason) {
  return { id, state: "NOT_BOUND", contextId: null, rawValue: null, noBindReason, ruleId };
}

test("each binder no-bind reason maps to itself and anything else is refused", () => {
  for (const code of Object.values(NO_BIND_REASON)) {
    assert.equal(noBindReasonOf(unbound(code)), code);
  }
  assert.deepEqual(Object.values(NO_BIND_REASON).sort(), [
    "CONTEXT_NOT_SINGLE_ROW", "MULTIPLE_ROWS", "NO_COMPARABLE_FIELD", "NO_MATCH", "NO_REPORTED_DATE", "SHARED_ROW",
  ]);
  assert.throws(() => noBindReasonOf(unbound(undefined, "no context matched every comparable field")), /no recognised no-bind reason/);
  assert.throws(() => noBindReasonOf(unbound("UNAVAILABLE")), /no recognised no-bind reason/);
  assert.throws(() => noBindReasonOf(displayed("c-1", "1/2/2099")), /has no no-bind reason/);
});

test("a first-ever NOT_BOUND supersedes nothing", () => {
  const plan = planInspection(unbound(NO_BIND_REASON.NO_MATCH), null, RULE);
  assert.deepEqual(plan, {
    action: "insert",
    state: "NOT_BOUND",
    contextId: null,
    rawValue: null,
    noBindReason: "NO_MATCH",
    supersedesId: null,
    supersedeReason: null,
  });
});

test("NOT_BOUND supersedes the current row and names the rule version and reason", () => {
  const plan = planInspection(unbound(NO_BIND_REASON.SHARED_ROW), currentDisplayed(41, OLD_RULE_ID), RULE);
  assert.equal(plan.action, "insert");
  assert.equal(plan.state, "NOT_BOUND");
  assert.equal(plan.supersedesId, 41);
  assert.equal(plan.supersedeReason, "superseded by binder rule v2: SHARED_ROW");
});

test("a bound result supersedes a current NOT_BOUND row", () => {
  const plan = planInspection(displayed("c-1", "1/2/2099"), currentNotBound(7, OLD_RULE_ID, "SHARED_ROW"), RULE);
  assert.equal(plan.action, "insert");
  assert.equal(plan.state, "FILING_DISPLAYED");
  assert.equal(plan.supersedesId, 7);
  assert.equal(plan.supersedeReason, "superseded by binder rule v2: FILING_DISPLAYED");
});

test("an identical rerun under the same rule version writes nothing", () => {
  const notBound = planInspection(unbound(NO_BIND_REASON.SHARED_ROW), currentNotBound(9, RULE.ruleId, "SHARED_ROW"), RULE);
  assert.equal(notBound.action, "skip");
  assert.equal(notBound.currentId, 9);
  const bound = planInspection(displayed("c-1", "1/2/2099"), currentDisplayed(10, RULE.ruleId), RULE);
  assert.equal(bound.action, "skip");
});

test("the same outcome under an older rule version, or a different outcome, is written", () => {
  assert.equal(planInspection(unbound(NO_BIND_REASON.SHARED_ROW), currentNotBound(9, OLD_RULE_ID, "SHARED_ROW"), RULE).action, "insert");
  assert.equal(planInspection(unbound(NO_BIND_REASON.NO_MATCH), currentNotBound(9, RULE.ruleId, "SHARED_ROW"), RULE).action, "insert");
  assert.equal(planInspection(displayed("c-2", "1/2/2099"), currentDisplayed(10, RULE.ruleId), RULE).action, "insert");
  assert.equal(planInspection(displayed("c-1", "3/4/2099"), currentDisplayed(10, RULE.ruleId), RULE).action, "insert");
});

test("recording writes inserts, skips identical reruns, and supersedes the current row", () => {
  const positions = [{ positionId: 101 }, { positionId: 102 }, { positionId: 103 }];
  const binds = [unbound(NO_BIND_REASON.SHARED_ROW), unbound(NO_BIND_REASON.MULTIPLE_ROWS), displayed("c-1", "1/2/2099")];
  const currentById = new Map([
    [101, currentDisplayed(55, OLD_RULE_ID)],
    [102, currentNotBound(56, RULE.ruleId, "MULTIPLE_ROWS")],
  ]);
  const writes = [];
  const recorded = recordFilingInspections({
    positions, binds, currentById, rule: RULE,
    write: (position, bound, plan) => writes.push([position.positionId, plan.state, plan.supersedesId, plan.supersedeReason]),
  });
  assert.deepEqual(recorded.errors, []);
  assert.deepEqual(writes, [
    [101, "NOT_BOUND", 55, "superseded by binder rule v2: SHARED_ROW"],
    [103, "FILING_DISPLAYED", null, null],
  ]);
  assert.deepEqual(recorded.results.map((r) => r.plan.action), ["insert", "skip", "insert"]);
});

test("a write error records nothing for that position and never falls back to NOT_BOUND", () => {
  const positions = [{ positionId: 201 }, { positionId: 202 }];
  const binds = [displayed("c-1", "1/2/2099"), unbound(NO_BIND_REASON.NO_MATCH)];
  const attempts = [];
  const recorded = recordFilingInspections({
    positions, binds, currentById: new Map(), rule: RULE,
    write: (position, bound, plan) => {
      attempts.push([position.positionId, plan.state]);
      throw new Error("test-only database failure");
    },
  });
  assert.deepEqual(attempts, [[201, "FILING_DISPLAYED"], [202, "NOT_BOUND"]]);
  assert.deepEqual(recorded.results, []);
  assert.deepEqual(recorded.errors, [
    { positionId: 201, message: "test-only database failure" },
    { positionId: 202, message: "test-only database failure" },
  ]);
});

test("an unbound result without a valid reason is an error, not NOT_BOUND", () => {
  const writes = [];
  const recorded = recordFilingInspections({
    positions: [{ positionId: 301 }],
    binds: [unbound(undefined, "processing failed")],
    currentById: new Map(),
    rule: RULE,
    write: (position, bound, plan) => writes.push(plan.state),
  });
  assert.deepEqual(writes, []);
  assert.deepEqual(recorded.results, []);
  assert.equal(recorded.errors.length, 1);
  assert.match(recorded.errors[0].message, /no recognised no-bind reason/);
});
