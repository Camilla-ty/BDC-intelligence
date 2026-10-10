import test from "node:test";
import assert from "node:assert/strict";
import { assessP6Batches, planExactNameBatches } from "../p6-balance-endpoints.mjs";

test("exact-name batches keep reuse observations with that name only", () => {
  const batches = planExactNameBatches([
    { id: 2, rawText: "TEST ISSUER A", normalizedText: "TEST ISSUER A" },
    { id: 1, rawText: "TEST ISSUER A", normalizedText: "TEST ISSUER A" },
    { id: 3, rawText: "TEST ISSUER B", normalizedText: "TEST ISSUER B" },
  ], [
    { id: 9, rawText: "TEST ISSUER A", normalizedText: "TEST ISSUER A", legalEntityId: "entity-a" },
  ]);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].mode, "reuse");
  assert.deepEqual(batches[0].submittedIds, [1, 2, 9]);
  assert.equal(batches[0].legalEntityId, "entity-a");
  assert.equal(batches[1].mode, "new");
  assert.deepEqual(batches[1].submittedIds, [3]);
  assert.equal(batches[1].legalEntityId, null);
  const assessment = assessP6Batches(batches);
  assert.equal(assessment.entitiesToCreate, 1);
  assert.equal(assessment.entitiesToReuse, 1);
  assert.equal(assessment.decisionsToInsert, 3);
  assert.equal(assessment.submittedObservations, 4);
});

test("one exact name matched to two legal entities is refused", () => {
  assert.throws(
    () => planExactNameBatches([
      { id: 1, rawText: "TEST ISSUER A", normalizedText: "TEST ISSUER A" },
    ], [
      { id: 8, rawText: "TEST ISSUER A", normalizedText: "TEST ISSUER A", legalEntityId: "entity-a" },
      { id: 9, rawText: "TEST ISSUER A", normalizedText: "TEST ISSUER A", legalEntityId: "entity-b" },
    ]),
    /more than one legal entity/,
  );
});

test("a raw identifier that differs from its normalized text is refused", () => {
  assert.throws(
    () => planExactNameBatches([
      { id: 1, rawText: "TEST ISSUER A ", normalizedText: "TEST ISSUER A" },
    ], []),
    /differs from normalized text/,
  );
});
