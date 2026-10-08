import assert from "node:assert/strict";
import test from "node:test";
import { parseAccessGrantArgs, recordGrantSql } from "./access-grant.mjs";

const user = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000099";

test("bootstrap ADMIN grant", () => {
  const parsed = parseAccessGrantArgs(["--user-id", user, "--kind", "ADMIN", "--action", "GRANT", "--source", "BOOTSTRAP", "--reason", "TEST FIRST ADMIN"]);
  assert.equal(parsed.actorId, null);
  const sql = recordGrantSql(parsed);
  assert.match(sql, /access\.record_grant/);
  assert.match(sql, /BOOTSTRAP/);
  assert.match(sql, /NULL/);
  assert.doesNotMatch(sql, /email|camilla@/i);
});

test("operator cannot target themselves", () => {
  assert.throws(
    () => parseAccessGrantArgs(["--user-id", user, "--kind", "PRO", "--action", "GRANT", "--source", "OPERATOR", "--actor-id", user, "--reason", "TEST SELF"]),
    /same user/,
  );
});

test("email is not a user id", () => {
  assert.throws(
    () => parseAccessGrantArgs(["--user-id", "camilla@bdcflow.com", "--kind", "ADMIN", "--action", "GRANT", "--source", "BOOTSTRAP", "--reason", "TEST"]),
    /UUID/,
  );
});

test("operator requires actor", () => {
  const parsed = parseAccessGrantArgs(["--user-id", user, "--kind", "PRO", "--action", "REVOKE", "--source", "OPERATOR", "--actor-id", actor, "--reason", "TEST REVOKE"]);
  assert.equal(parsed.actorId, actor);
  assert.match(recordGrantSql(parsed), /REVOKE/);
});
