import { spawnSync } from "node:child_process";
import { Client, type QueryResult } from "pg";

// ADR 0009: the one in-process client. It sends SQL text.
// DATABASE_URL selects the hosted runtime. Local and CI keep Docker psql.

const CONTAINER = process.env.BDC_DB_CONTAINER ?? "bdc-intelligence-pg";
const DATABASE = process.env.BDC_DATABASE ?? "bdc_local";

export type SqlText = { ok: true; text: string } | { ok: false };

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
  const client = new Client({
    connectionString,
    ssl: hostedSsl(connectionString),
    connectionTimeoutMillis: 30_000,
  });
  try {
    await client.connect();
    const result = await client.query({ text: sql, queryMode: "simple", rowMode: "array" });
    return { ok: true, text: scriptText(result) };
  } catch {
    return { ok: false };
  } finally {
    await client.end().catch(() => undefined);
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
