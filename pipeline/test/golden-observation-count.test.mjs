import test from "node:test";
import assert from "node:assert/strict";
import {
  GOLDEN_OBSERVATION_COUNT_CODE, GOLDEN_OBSERVATION_COUNT_VERSION,
  goldenObservationCount, uniquePositionObservationIds,
} from "../normalize/golden-observation-count.mjs";

test("golden observation count is the distinct locator set", () => {
  assert.equal(GOLDEN_OBSERVATION_COUNT_CODE, "derived.golden_observation_count");
  assert.equal(GOLDEN_OBSERVATION_COUNT_VERSION, "1");
  const ids = [10, 20, 10, 30];
  assert.equal(goldenObservationCount(ids), 3);
  assert.deepEqual(uniquePositionObservationIds(ids), [10, 20, 30]);
});

test("golden observation count is deterministic across two calls", () => {
  const ids = Array.from({ length: 181 }, (_, i) => i + 1);
  assert.equal(goldenObservationCount(ids), 181);
  assert.equal(goldenObservationCount(ids), goldenObservationCount([...ids].reverse()));
});

test("rejects invalid locator ids", () => {
  assert.throws(() => goldenObservationCount(["x"]), /invalid/);
  assert.throws(() => goldenObservationCount(null), /array/);
});
