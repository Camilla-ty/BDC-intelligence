// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const released: Array<{ destroy: boolean }> = [];
  const queries: Array<{ sql: string; mode?: string }> = [];
  let failNextQuery = false;
  let failResetRole = false;
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
        if (failResetRole) throw new Error("reset failed");
        return { rows: [], command: "RESET" };
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
} from "@/server/sql-text";

const URL = "postgresql://user:pass@db.example.test:5432/bdc?sslmode=require";

beforeEach(() => {
  mocks.reset();
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

describe("executeSql without DATABASE_URL", () => {
  it("does not construct a hosted Pool when falling back to Docker psql", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await executeSql("SELECT 1;");
    expect(mocks.counts().poolConstructCount).toBe(0);
    expect(mocks.counts().connectCount).toBe(0);
  });
});
