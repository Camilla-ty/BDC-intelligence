import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import {
  MATURITY_WORKER_BUSY,
  MATURITY_WORKER_LOCK_KEY,
  bindMaturityWorkerShutdown,
} from "../load/maturity-worker-lock.mjs";

test("the maturity worker lock key is one fixed safe integer", () => {
  assert.equal(MATURITY_WORKER_LOCK_KEY, 8120261003);
  assert.equal(Number.isSafeInteger(MATURITY_WORKER_LOCK_KEY), true);
  assert.equal(MATURITY_WORKER_BUSY, "maturity worker lock is already held; another maturity worker is running");
});

test("SIGINT and SIGTERM release the lock once and exit", async () => {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const hooks = new EventEmitter();
    let releases = 0;
    let exited = null;
    const detach = bindMaturityWorkerShutdown({
      release: () => {
        releases += 1;
        return Promise.resolve();
      },
    }, { ...hooks, on: hooks.on.bind(hooks), off: hooks.off.bind(hooks), exit: (status) => { exited = status; } });
    hooks.emit(signal);
    hooks.emit(signal);
    hooks.emit(signal === "SIGINT" ? "SIGTERM" : "SIGINT");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases, 1);
    assert.equal(exited, code);
    detach();
  }
});
