import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { batchesByIdentifierHash } from "../p4-balance-candidates.mjs";

function sha(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("balance candidates batch by exact identifier hash", () => {
  const batches = batchesByIdentifierHash([
    { id: 30, identifierRaw: "TEST ISSUER B" },
    { id: 10, identifierRaw: "TEST ISSUER A" },
    { id: 20, identifierRaw: "TEST ISSUER A" },
  ]);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0], {
    identifierRaw: "TEST ISSUER A",
    identifierSha256: sha("TEST ISSUER A"),
    ids: [10, 20],
  });
  assert.deepEqual(batches[1].ids, [30]);
  assert.equal(batches[1].identifierSha256, sha("TEST ISSUER B"));
});

test("a repeated observation id is refused", () => {
  assert.throws(
    () => batchesByIdentifierHash([
      { id: 10, identifierRaw: "TEST ISSUER A" },
      { id: 10, identifierRaw: "TEST ISSUER A" },
    ]),
    /duplicate position_observation_id/,
  );
});

test("a blank identifier is refused", () => {
  assert.throws(
    () => batchesByIdentifierHash([{ id: 10, identifierRaw: "" }]),
    /no identifier text/,
  );
});
