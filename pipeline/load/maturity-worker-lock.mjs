// One session-level advisory lock for the whole maturity worker.
// A repository search found no other pg_advisory_lock or pg_try_advisory_lock key.
// This key is fixed. It is not derived from an accession, run, rule, or position.
// pg_try_advisory_lock is session-level: it is released by pg_advisory_unlock, and
// also when this dedicated session disconnects, including process death.

import { openPipelineSession } from "../lib/db.mjs";

export const MATURITY_WORKER_LOCK_KEY = 8120261003;

export const MATURITY_WORKER_BUSY =
  "maturity worker lock is already held; another maturity worker is running";

export class MaturityWorkerBusy extends Error {
  constructor() {
    super(MATURITY_WORKER_BUSY);
    this.name = "MaturityWorkerBusy";
    this.exitCode = 2;
  }
}

function locked(value) {
  const text = String(value).trim();
  return text === "t" || text === "true";
}

export async function acquireMaturityWorkerLock(database) {
  const session = await openPipelineSession(database);
  let released = false;
  const finish = async () => {
    if (released) return;
    released = true;
    await session.close();
  };
  try {
    const held = await session.query(`SELECT pg_try_advisory_lock(${MATURITY_WORKER_LOCK_KEY})`);
    if (!locked(held)) {
      await finish();
      throw new MaturityWorkerBusy();
    }
  } catch (error) {
    await finish();
    throw error;
  }
  return {
    async identity() {
      const statementTimeout = await session.query("SELECT current_setting('statement_timeout')");
      const role = await session.query("SELECT current_user");
      return { statementTimeout: statementTimeout.trim(), role: role.trim() };
    },
    release: async () => {
      if (released) return;
      released = true;
      try {
        await session.query(`SELECT pg_advisory_unlock(${MATURITY_WORKER_LOCK_KEY})`);
      } finally {
        await session.close();
      }
    },
    // Closes the session without an unlock. PostgreSQL releases the lock
    // because the session is gone. Used to test process-death behavior.
    dropSession: async () => {
      await finish();
    },
  };
}

// Closes the lock session once on SIGINT or SIGTERM, then exits.
// A second signal during shutdown does nothing.
export function bindMaturityWorkerShutdown(lock, hooks = process) {
  let stopping = false;
  const onSignal = (signal) => {
    if (stopping) return;
    stopping = true;
    const code = signal === "SIGINT" ? 130 : 143;
    Promise.resolve(lock.release()).finally(() => hooks.exit(code));
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  hooks.on("SIGINT", onInt);
  hooks.on("SIGTERM", onTerm);
  return () => {
    hooks.off("SIGINT", onInt);
    hooks.off("SIGTERM", onTerm);
  };
}
