import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_CATALOG, FIRST_OBSERVED_CODE, blockedEventCodes, registrantFirstObservedEvents, supportedEventCodes,
} from "../normalize/observation-events.mjs";

function fact(id, date, registrant, status = "LINKED") {
  return {
    position_observation_id: id,
    reported_date: date,
    evidence_id: 1000 + id,
    registrant_id: status === "LINKED" ? registrant : null,
    registrant_link_status: status,
  };
}

test("only the earliest observation for a registrant is an event", () => {
  const got = registrantFirstObservedEvents([
    fact(2, "2099-09-30", 10),
    fact(1, "2099-03-31", 10),
  ]);
  assert.deepEqual(got.events.map((e) => e.position_observation_id), [1]);
  assert.equal(got.events[0].event_code, FIRST_OBSERVED_CODE);
  assert.equal(got.events[0].reported_date, "2099-03-31");
  assert.equal("amount" in got.events[0], false);
});

test("two observations on the earliest date stay separate", () => {
  const got = registrantFirstObservedEvents([
    fact(2, "2099-03-31", 10),
    fact(1, "2099-03-31", 10),
    fact(3, "2099-06-30", 10),
  ]);
  assert.deepEqual(got.events.map((e) => e.position_observation_id), [1, 2]);
});

test("different registrants keep separate earliest dates", () => {
  const got = registrantFirstObservedEvents([
    fact(1, "2099-03-31", 10),
    fact(2, "2099-09-30", 10),
    fact(3, "2099-06-30", 20),
  ]);
  assert.deepEqual(got.events.map((e) => e.position_observation_id), [1, 3]);
  assert.equal(got.distinct_registrants, 2);
});

test("a missing quarter emits no event and no zero exposure", () => {
  const got = registrantFirstObservedEvents([
    fact(1, "2099-03-31", 10),
    fact(2, "2099-09-30", 10),
  ]);
  assert.equal(got.events.some((e) => e.reported_date === "2099-06-30"), false);
  assert.equal(JSON.stringify(got).includes("exposure"), false);
  assert.equal(Object.hasOwn(got, "zero"), false);
});

test("an unlinked registrant is skipped", () => {
  const got = registrantFirstObservedEvents([
    fact(1, "2099-03-31", 10, "UNKNOWN"),
    fact(2, "2099-03-31", 20),
  ]);
  assert.equal(got.skipped_unlinked, 1);
  assert.deepEqual(got.events.map((e) => e.position_observation_id), [2]);
});

test("derivation is identical across two calls", () => {
  const facts = [fact(4, "2099-12-31", 10), fact(3, "2099-06-30", 10), fact(5, "2099-06-30", 11)];
  assert.deepEqual(registrantFirstObservedEvents(facts), registrantFirstObservedEvents(facts));
});

test("COST, fair value, and instrument identity are refused as inputs", () => {
  assert.throws(() => registrantFirstObservedEvents([{ ...fact(1, "2099-03-31", 10), cost: "1" }]), /not allowed/);
  assert.throws(() => registrantFirstObservedEvents([{ ...fact(1, "2099-03-31", 10), fair_value: "1" }]), /not allowed/);
  assert.throws(() => registrantFirstObservedEvents([{ ...fact(1, "2099-03-31", 10), instrument_id: "x" }]), /not allowed/);
});

test("catalog supports one event and blocks the rest", () => {
  assert.deepEqual(supportedEventCodes(), [FIRST_OBSERVED_CODE]);
  for (const code of [
    "NEW_POSITION", "EXPOSURE_INCREASE", "EXPOSURE_DECREASE", "MATURITY_CHANGE",
    "VALUATION_MOVEMENT", "NON_ACCRUAL", "PIK", "NO_LONGER_REPORTED",
    "MATURITY_PROXIMITY", "VALUATION_DISPERSION", "ECONOMIC_GROUP_MEMBERSHIP",
  ]) {
    assert.equal(blockedEventCodes().includes(code), true);
  }
  assert.equal(EVENT_CATALOG.some((item) => item.status === "SUPPORTED" && item.code !== FIRST_OBSERVED_CODE), false);
});
