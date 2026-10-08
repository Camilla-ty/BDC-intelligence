import { spawnSync } from "node:child_process";
import { Pool, type PoolClient, type QueryResult } from "pg";

// ADR 0009: one in-process PostgreSQL access path for hosted runtimes.
// SQL text is still the interface. Local/CI keep Docker psql.
// Hosted: a shared Pool reuses TCP connections across executeSql calls in the
// same process (Next.js/Vercel isolate). Conservative max for serverless.

const CONTAINER = process.env.BDC_DB_CONTAINER ?? "bdc-intelligence-pg";
const DATABASE = process.env.BDC_DATABASE ?? "bdc_local";

/** Small pool: serverless instances are short-lived; avoid many idle backends. */
const HOSTED_POOL_MAX = 3;
const HOSTED_IDLE_MS = 10_000;
const HOSTED_CONNECT_MS = 30_000;

export type SqlText = { ok: true; text: string } | { ok: false };

type PoolFactory = (connectionString: string) => Pool;

type GlobalPoolState = {
  __bdcSqlPool?: Pool;
  __bdcSqlPoolUrl?: string;
  __bdcSqlPoolFactory?: PoolFactory;
};

function poolState(): GlobalPoolState {
  return globalThis as typeof globalThis & GlobalPoolState;
}

function defaultPoolFactory(connectionString: string): Pool {
  return new Pool({
    connectionString,
    ssl: hostedSsl(connectionString),
    max: HOSTED_POOL_MAX,
    idleTimeoutMillis: HOSTED_IDLE_MS,
    connectionTimeoutMillis: HOSTED_CONNECT_MS,
    // Let the isolate exit when idle (Vercel/serverless-friendly).
    allowExitOnIdle: true,
  });
}

/**
 * One Pool per process (and per DATABASE_URL). Survives Next.js hot reload via globalThis.
 * Does not call pool.end() during request handling.
 */
export function getHostedPool(connectionString: string): Pool {
  const state = poolState();
  const factory = state.__bdcSqlPoolFactory ?? defaultPoolFactory;
  if (state.__bdcSqlPool && state.__bdcSqlPoolUrl === connectionString) {
    return state.__bdcSqlPool;
  }
  // URL change is rare; drop the prior pool handle without awaiting end (test/dev only).
  state.__bdcSqlPool = factory(connectionString);
  state.__bdcSqlPoolUrl = connectionString;
  return state.__bdcSqlPool;
}

/** Test-only: replace Pool construction and clear the cached pool handle. */
export function setHostedPoolFactoryForTests(factory: PoolFactory | null): void {
  const state = poolState();
  state.__bdcSqlPoolFactory = factory ?? undefined;
  state.__bdcSqlPool = undefined;
  state.__bdcSqlPoolUrl = undefined;
}

/** Test-only: clear the cached pool without ending it (avoids touching live DBs). */
export function resetHostedPoolCacheForTests(): void {
  const state = poolState();
  state.__bdcSqlPool = undefined;
  state.__bdcSqlPoolUrl = undefined;
}

export async function executeSql(sql: string): Promise<SqlText> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) return executeHosted(databaseUrl, sql);
  return executeDocker(sql);
}

function executeDocker(sql: string): SqlText {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DATABASE, "-At"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) return { ok: false };
  return { ok: true, text: (result.stdout ?? "").trim() };
}

async function executeHosted(connectionString: string, sql: string): Promise<SqlText> {
  const pool = getHostedPool(connectionString);
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    return { ok: false };
  }

  let destroyOnRelease = false;
  try {
    const result = await client.query({ text: sql, queryMode: "simple", rowMode: "array" });
    return { ok: true, text: scriptText(result) };
  } catch {
    destroyOnRelease = true;
    return { ok: false };
  } finally {
    // Callers' scripts include RESET ROLE, but a mid-script failure can leave a
    // session role set. Always clear before returning the connection to the pool.
    try {
      await client.query("RESET ROLE");
      destroyOnRelease = false;
    } catch {
      destroyOnRelease = true;
    }
    client.release(destroyOnRelease);
  }
}

function hostedSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  const mode = /(?:\?|&)sslmode=([^&]+)/.exec(connectionString)?.[1];
  if (mode === "disable") return false;
  if (mode === "verify-ca" || mode === "verify-full") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function scriptText(result: QueryResult | QueryResult[]): string {
  const results = Array.isArray(result) ? result : [result];
  const lines: string[] = [];
  for (const item of results) {
    for (const row of item.rows) {
      const cell = Array.isArray(row) ? row[0] : row;
      lines.push(cellText(cell));
    }
  }
  return lines.join("\n");
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
