// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DockerSpawnResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  signal?: string | null;
  error?: Error;
};

const spawnMocks = vi.hoisted(() => ({
  spawnSync: vi.fn((): DockerSpawnResult => ({ status: 1, stdout: "", stderr: "" })),
}));

vi.mock("node:child_process", () => ({
  spawnSync: spawnMocks.spawnSync,
}));

const mocks = vi.hoisted(() => {
  const released: Array<{ destroy: boolean }> = [];
  const queries: Array<{ sql: string; mode?: string }> = [];
  let failNextQuery = false;
  let failResetRole = false;
  let nextQueryError: unknown = null;
  let connectError: unknown = null;
  let resetRoleError: unknown = null;
  let connectCount = 0;
  let poolConstructCount = 0;
  let poolEndCount = 0;

  class MockPoolClient {
    release(err?: Error | boolean) {
      released.push({ destroy: Boolean(err) });
    }
    async query(arg: string | { text: string; queryMode?: string; rowMode?: string }) {
      const text = typeof arg === "string" ? arg : arg.text;
      const mode = typeof arg === "string" ? undefined : arg.queryMode;
      queries.push({ sql: text, mode });
      if (text === "RESET ROLE") {
        if (resetRoleError) {
          const error = resetRoleError;
          resetRoleError = null;
          throw error;
        }
        if (failResetRole) throw new Error("reset failed");
        return { rows: [], command: "RESET" };
      }
      if (nextQueryError) {
        const error = nextQueryError;
        nextQueryError = null;
        throw error;
      }
      if (failNextQuery) {
        failNextQuery = false;
        throw new Error("query failed");
      }
      return { rows: [["result-cell"]], command: "SELECT" };
    }
  }

  class MockPool {
    readonly clients: MockPoolClient[] = [];
    constructor(public readonly config: Record<string, unknown>) {
      poolConstructCount += 1;
    }
    async connect() {
      connectCount += 1;
      if (connectError) {
        const error = connectError;
        connectError = null;
        throw error;
      }
      const client = new MockPoolClient();
      this.clients.push(client);
      return client;
    }
    async end() {
      poolEndCount += 1;
    }
  }

  return {
    released,
    queries,
    MockPool,
    reset() {
      released.length = 0;
      queries.length = 0;
      failNextQuery = false;
      failResetRole = false;
      nextQueryError = null;
      connectError = null;
      resetRoleError = null;
      connectCount = 0;
      poolConstructCount = 0;
      poolEndCount = 0;
    },
    setFailNextQuery(value: boolean) {
      failNextQuery = value;
    },
    setFailResetRole(value: boolean) {
      failResetRole = value;
    },
    setNextQueryError(error: unknown) {
      nextQueryError = error;
    },
    setConnectError(error: unknown) {
      connectError = error;
    },
    setResetRoleError(error: unknown) {
      resetRoleError = error;
    },
    counts: () => ({ connectCount, poolConstructCount, poolEndCount }),
  };
});

vi.mock("pg", () => ({
  Pool: mocks.MockPool,
  Client: vi.fn(),
}));

import {
  executeSql,
  getHostedPool,
  resetHostedPoolCacheForTests,
  setHostedPoolFactoryForTests,
  type SqlOperation,
} from "@/server/sql-text";

const URL = "postgresql://user:pass@db.example.test:5432/bdc?sslmode=require";

beforeEach(() => {
  mocks.reset();
  spawnMocks.spawnSync.mockReset();
  spawnMocks.spawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "" });
  resetHostedPoolCacheForTests();
  setHostedPoolFactoryForTests((connectionString) => {
    expect(connectionString).toBe(URL);
    return new mocks.MockPool({
      connectionString,
      max: 3,
      allowExitOnIdle: true,
    }) as unknown as import("pg").Pool;
  });
  vi.stubEnv("DATABASE_URL", URL);
});

afterEach(() => {
  setHostedPoolFactoryForTests(null);
  resetHostedPoolCacheForTests();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("hosted executeSql connection reuse", () => {
  it("reuses one Pool across multiple executeSql calls instead of constructing per call", async () => {
    const a = await executeSql("SET ROLE bdc_reader;\nSELECT 1;\nRESET ROLE;\n");
    const b = await executeSql("SET ROLE bdc_reader;\nSELECT 2;\nRESET ROLE;\n");
    expect(a).toEqual({ ok: true, text: "result-cell" });
    expect(b).toEqual({ ok: true, text: "result-cell" });
    expect(mocks.counts().poolConstructCount).toBe(1);
    expect(mocks.counts().connectCount).toBe(2);
    expect(mocks.counts().poolEndCount).toBe(0);
    expect(getHostedPool(URL)).toBe(getHostedPool(URL));
  });

  it("passes the caller SQL text unchanged to query (simple mode)", async () => {
    const sql = "SET ROLE admin_reader;\nSET statement_timeout = '30s';\nSELECT 1;\nRESET ROLE;\n";
    await executeSql(sql);
    const main = mocks.queries.find((q) => q.sql.includes("SET ROLE admin_reader"));
    expect(main?.sql).toBe(sql);
    expect(main?.mode).toBe("simple");
  });

  it("issues RESET ROLE before release so pooled sessions cannot leak roles", async () => {
    await executeSql("SET ROLE bdc_reader;\nSELECT 1;\nRESET ROLE;\n");
    expect(mocks.queries.map((q) => q.sql)).toEqual([
      "SET ROLE bdc_reader;\nSELECT 1;\nRESET ROLE;\n",
      "RESET ROLE",
    ]);
    expect(mocks.released).toEqual([{ destroy: false }]);
  });

  it("releases the acquired connection after a failed query and still attempts RESET ROLE", async () => {
    mocks.setFailNextQuery(true);
    const result = await executeSql("SET ROLE bdc_reader;\nSELECT boom;\nRESET ROLE;\n");
    expect(result).toEqual({ ok: false });
    expect(mocks.queries.at(-1)?.sql).toBe("RESET ROLE");
    expect(mocks.released).toEqual([{ destroy: false }]);
    expect(mocks.counts().poolEndCount).toBe(0);
  });

  it("destroys the connection when RESET ROLE fails after use", async () => {
    mocks.setFailResetRole(true);
    const result = await executeSql("SELECT 1;");
    expect(result).toEqual({ ok: true, text: "result-cell" });
    expect(mocks.released).toEqual([{ destroy: true }]);
  });

  it("does not end the pool after each request", async () => {
    await executeSql("SELECT 1;");
    await executeSql("SELECT 2;");
    expect(mocks.counts().poolEndCount).toBe(0);
  });
});

describe("executeSql failure diagnostics", () => {
  const secretUri = "postgresql://app_login:s3cret-token@db.internal.example:5432/postgres?sslmode=require";
  const secretSql = "SET ROLE bdc_reader;\nSELECT secret_marker FROM registry.borrower_observation_listing;\n";

  function loggedDiagnostics(): unknown[] {
    return vi.mocked(console.error).mock.calls.map((call) => {
      expect(call).toHaveLength(1);
      expect(typeof call[0]).toBe("string");
      return JSON.parse(String(call[0]));
    });
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("logs query SQLSTATE without the driver message, SQL, or connection string", async () => {
    mocks.setNextQueryError(Object.assign(new Error(`query failed for ${secretUri} running ${secretSql}`), {
      code: "42501",
      detail: secretUri,
      where: secretSql,
    }));
    const result = await executeSql(secretSql);
    expect(result).toEqual({ ok: false });
    const logged = loggedDiagnostics();
    expect(logged).toEqual([{
      source: "executeSql",
      operation: "unspecified",
      category: "query",
      sqlstate: "42501",
    }]);
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("s3cret-token");
    expect(serialized).not.toContain("app_login");
    expect(serialized).not.toContain("db.internal.example");
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("secret_marker");
    expect(serialized).not.toContain("borrower_observation_listing");
    expect(serialized).not.toContain("SET ROLE");
  });

  it("does not treat a non-SQLSTATE code or a connect message as loggable detail", async () => {
    mocks.setConnectError(Object.assign(new Error(`connect failed ${secretUri}`), { code: "ENOTFOUND" }));
    const result = await executeSql(secretSql);
    expect(result).toEqual({ ok: false });
    const logged = loggedDiagnostics();
    expect(logged).toEqual([{
      source: "executeSql",
      operation: "unspecified",
      category: "connect",
      sqlstate: "unknown",
    }]);
    expect(JSON.stringify(logged)).not.toContain("s3cret-token");
    expect(JSON.stringify(logged)).not.toContain("ENOTFOUND");
    expect(JSON.stringify(logged)).not.toContain(secretSql);
  });

  it("drops a code field that is not a five-character SQLSTATE", async () => {
    mocks.setNextQueryError(Object.assign(new Error("query failed"), { code: secretUri }));
    await executeSql("SELECT 1;");
    expect(loggedDiagnostics()).toEqual([
      { source: "executeSql", operation: "unspecified", category: "query", sqlstate: "unknown" },
    ]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("s3cret-token");
  });

  it("logs the caller operation and drops any other operation text", async () => {
    const secretUri = "postgresql://app_login:s3cret-token@db.internal.example:5432/postgres";
    const userId = "00000000-0000-4000-8000-000000000099";
    mocks.setNextQueryError(Object.assign(new Error(`query failed ${secretUri} ${userId}`), { code: "42501" }));
    await executeSql("SELECT secret_marker;", "borrower-listing");
    expect(loggedDiagnostics()).toEqual([{
      source: "executeSql",
      operation: "borrower-listing",
      category: "query",
      sqlstate: "42501",
    }]);

    mocks.setNextQueryError(Object.assign(new Error("access failed"), { code: "42501" }));
    await executeSql("SELECT secret_marker;", "access-lookup");
    expect(loggedDiagnostics()[1]).toEqual({
      source: "executeSql",
      operation: "access-lookup",
      category: "query",
      sqlstate: "42501",
    });

    mocks.setNextQueryError(Object.assign(new Error("rejected label"), { code: "42501" }));
    await executeSql(
      "SELECT secret_marker;",
      `${secretUri} ${userId} SET ROLE bdc_reader` as SqlOperation,
    );
    const rejected = loggedDiagnostics()[2];
    expect(rejected).toEqual({
      source: "executeSql",
      operation: "unspecified",
      category: "query",
      sqlstate: "42501",
    });
    const serialized = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serialized).not.toContain("s3cret-token");
    expect(serialized).not.toContain("app_login");
    expect(serialized).not.toContain("db.internal.example");
    expect(serialized).not.toContain(userId);
    expect(serialized).not.toContain("secret_marker");
    expect(serialized).not.toContain("SET ROLE");
  });

  it("logs a reset-role failure without its message", async () => {
    mocks.setResetRoleError(Object.assign(new Error(`reset failed ${secretUri}`), { code: "42501" }));
    const result = await executeSql("SELECT 1;");
    expect(result).toEqual({ ok: true, text: "result-cell" });
    expect(loggedDiagnostics()).toEqual([
      { source: "executeSql", operation: "unspecified", category: "reset_role", sqlstate: "42501" },
    ]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("s3cret-token");
  });
});

describe("executeSql without DATABASE_URL", () => {
  it("does not construct a hosted Pool when falling back to Docker psql", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await executeSql("SELECT 1;");
    expect(mocks.counts().poolConstructCount).toBe(0);
    expect(mocks.counts().connectCount).toBe(0);
  });

  it("returns trimmed stdout when docker psql exits 0 without a spawn error", async () => {
    vi.stubEnv("DATABASE_URL", "");
    spawnMocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: "  listing-row\n",
      stderr: "",
    });
    await expect(executeSql("SELECT 1;")).resolves.toEqual({ ok: true, text: "listing-row" });
    expect(spawnMocks.spawnSync).toHaveBeenCalledTimes(1);
  });

  it("fails closed on ENOBUFS with exit status 0 and discards the partial stdout", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    spawnMocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: '[{"legalEntityId":"partial"',
      stderr: "",
      error: Object.assign(new Error("spawnSync docker ENOBUFS"), { code: "ENOBUFS" }),
    });
    const result = await executeSql("SELECT secret_marker;");
    expect(result).toEqual({ ok: false });
    expect(result).not.toHaveProperty("text");
    expect(vi.mocked(console.error).mock.calls).toEqual([
      [JSON.stringify({ source: "executeSql", operation: "unspecified", category: "docker", sqlstate: "unknown" })],
    ]);
    const serialized = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serialized).not.toContain("ENOBUFS");
    expect(serialized).not.toContain("partial");
    expect(serialized).not.toContain("secret_marker");
  });

  it("fails closed on a spawn error with a null status or a non-zero status", async () => {
    vi.stubEnv("DATABASE_URL", "");
    spawnMocks.spawnSync.mockReturnValue({
      status: null,
      signal: "SIGTERM",
      stdout: "partial-null",
      stderr: "",
      error: Object.assign(new Error("spawnSync docker ENOBUFS"), { code: "ENOBUFS" }),
    });
    await expect(executeSql("SELECT 1;")).resolves.toEqual({ ok: false });

    spawnMocks.spawnSync.mockReturnValue({
      status: 3,
      stdout: "",
      stderr: "psql: ERROR:  boom",
      error: Object.assign(new Error("spawnSync docker ENOBUFS"), { code: "ENOBUFS" }),
    });
    await expect(executeSql("SELECT 1;")).resolves.toEqual({ ok: false });
  });

  it("fails closed on a spawn error that has no code", async () => {
    vi.stubEnv("DATABASE_URL", "");
    spawnMocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: "ok",
      stderr: "",
      error: new Error("spawnSync docker ETIMEDOUT"),
    });
    await expect(executeSql("SELECT 1;")).resolves.toEqual({ ok: false });
  });

  it("logs a docker failure without psql stderr, SQL, or a connection string", async () => {
    const secretUri = "postgresql://app_login:s3cret-token@db.internal.example:5432/postgres";
    const secretSql = "SET ROLE bdc_reader;\nSELECT secret_marker;\n";
    vi.stubEnv("DATABASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    spawnMocks.spawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: `ERROR: ${secretUri}\n${secretSql}`,
    });
    const result = await executeSql(secretSql);
    expect(result).toEqual({ ok: false });
    expect(vi.mocked(console.error).mock.calls).toEqual([
      [JSON.stringify({ source: "executeSql", operation: "unspecified", category: "docker", sqlstate: "unknown" })],
    ]);
    const serialized = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(serialized).not.toContain("s3cret-token");
    expect(serialized).not.toContain("app_login");
    expect(serialized).not.toContain("db.internal.example");
    expect(serialized).not.toContain("secret_marker");
    expect(serialized).not.toContain("SET ROLE");
  });
});
