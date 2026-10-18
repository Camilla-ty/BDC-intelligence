// A spawn error from the local psql wrapper must fail closed: no partial stdout, a non-zero
// status, and a thrown error in every caller. No database or Docker is used.

import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { commandResult } from "../../scripts/db/pg.mjs";
import { localScriptLines } from "../lib/db.mjs";

const enobufs = () => Object.assign(new Error("spawnSync docker ENOBUFS"), { code: "ENOBUFS" });

test("a spawn error with exit status 0 is a failure and drops the partial output", () => {
  const r = commandResult({ status: 0, signal: null, stdout: "1\tpartial\n2\tpart", stderr: "", error: enobufs() });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /^ERROR: command did not complete \(ENOBUFS\); its output is incomplete and was discarded\n$/);
  assert.equal(r.error.code, "ENOBUFS");
});

test("a spawn error keeps an existing non-zero status and the original stderr", () => {
  const killed = commandResult({ status: null, signal: "SIGTERM", stdout: "x", stderr: "", error: enobufs() });
  assert.equal(killed.status, 1);
  assert.equal(killed.stdout, "");

  const failed = commandResult({ status: 3, stdout: "", stderr: "psql: ERROR:  boom", error: enobufs() });
  assert.equal(failed.status, 3);
  assert.match(failed.stderr, /^psql: ERROR: {2}boom\nERROR: command did not complete \(ENOBUFS\)/);
});

test("a spawn error without a code is still a failure", () => {
  const r = commandResult({ status: 0, stdout: "ok", stderr: "", error: new Error("spawnSync docker ETIMEDOUT") });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /command did not complete \(Error\)/);
});

test("a successful result is unchanged", () => {
  assert.deepEqual(
    commandResult({ status: 0, stdout: "a\tb\n", stderr: "NOTICE: x\n" }),
    { status: 0, stdout: "a\tb\n", stderr: "NOTICE: x\n", error: undefined },
  );
  assert.deepEqual(
    commandResult({ status: 2, stdout: "", stderr: "psql: ERROR: no" }),
    { status: 2, stdout: "", stderr: "psql: ERROR: no", error: undefined },
  );
  assert.equal(commandResult({ status: null, signal: "SIGKILL", stdout: "", stderr: "" }).status, 1);
});

test("a real maxBuffer overflow becomes a failure with no stdout", () => {
  const raw = spawnSync(process.execPath, ["-e", "process.stdout.write('x'.repeat(1 << 20))"], {
    encoding: "utf8",
    maxBuffer: 1024,
  });
  assert.equal(raw.error?.code, "ENOBUFS");
  assert.ok(raw.stdout.length > 0, "Node returns the partial output it captured");
  const r = commandResult(raw);
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /ENOBUFS/);
});

test("runScript's local result handling throws on a spawn error instead of returning lines", () => {
  const partial = { status: 0, stdout: "10\tUSD\n11\tEU", stderr: "", error: enobufs() };
  assert.throws(() => localScriptLines(partial), /^Error: psql did not complete \(ENOBUFS\)$/);
  assert.throws(() => localScriptLines(commandResult(partial)), (error) => {
    assert.match(error.message, /ERROR: command did not complete \(ENOBUFS\)/);
    assert.doesNotMatch(error.message, /postgres(ql)?:\/\/|password/i);
    return true;
  });
});

test("runScript's local result handling keeps psql diagnostics and successful lines", () => {
  assert.deepEqual(localScriptLines({ status: 0, stdout: "1\ta\n\n2\tb\n", stderr: "" }), ["1\ta", "2\tb"]);
  assert.throws(
    () => localScriptLines({
      status: 3, stdout: "", stderr: "psql:<stdin>:4: ERROR:  relation \"x\" does not exist\nLINE 1: SELECT * FROM x\n",
    }),
    /ERROR: {2}relation "x" does not exist\nLINE 1: SELECT \* FROM x/,
  );
});
