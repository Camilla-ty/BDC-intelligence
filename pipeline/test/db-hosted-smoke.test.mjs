// Connects only when PIPELINE_DATABASE_URL is already in the process environment.
// Does not read or write .env.local. Prints neither the URL nor the password.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { lit, pipelineConnectionTarget, queryRows } from "../lib/db.mjs";

function assertNoSecret(message, connectionString) {
  if (/postgres(?:ql)?:\/\//i.test(message) || (connectionString && message.includes(connectionString))) {
    throw new Error("hosted pipeline error included a connection URL");
  }
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return;
  }
  const password = decodeURIComponent(url.password);
  const user = decodeURIComponent(url.username);
  if (password && message.includes(password)) throw new Error("hosted pipeline error included a password");
  if (user && message.includes(user)) throw new Error("hosted pipeline error included a user");
  if (url.hostname && message.includes(url.hostname)) throw new Error("hosted pipeline error included a host");
}

test("hosted pipeline connection sets the writer role and rolls back a write", { timeout: 60_000 }, (t) => {
  const target = pipelineConnectionTarget();
  if (target.mode !== "hosted") {
    t.skip("PIPELINE_DATABASE_URL is not set");
    return;
  }
  const marker = `PIPELINE_HOSTED_SMOKE_${randomUUID()}`;
  let rows;
  try {
    rows = queryRows("bdc_local", `
SELECT current_user;
SELECT 1;
BEGIN;
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST', ${lit(marker)}, '{}', now())
RETURNING id::text;
ROLLBACK;
SELECT count(*)::text FROM ops.run WHERE code_version = ${lit(marker)};
`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertNoSecret(message, target.connectionString);
    throw error;
  }
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0], "bdc_pipeline_writer");
  assert.equal(rows[1][0], "1");
  assert.match(rows[2][0], /^[0-9]+$/);
  assert.equal(rows[3][0], "0");
});
