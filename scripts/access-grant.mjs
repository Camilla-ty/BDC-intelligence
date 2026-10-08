#!/usr/bin/env node
// Operator-only ADMIN/PRO grant ledger. Not a web route and not a server action.
// The connection string is never printed. Do not call this from apps/web.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS = new Set(["ADMIN", "PRO"]);
const ACTIONS = new Set(["GRANT", "REVOKE"]);
const SOURCES = new Set(["BOOTSTRAP", "OPERATOR"]);

export function parseAccessGrantArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  const userId = args["user-id"]?.trim() ?? "";
  const kind = args.kind?.trim() ?? "";
  const action = args.action?.trim() ?? "";
  const source = args.source?.trim() ?? "";
  const reason = args.reason?.trim() ?? "";
  const actorId = args["actor-id"]?.trim() ?? "";
  if (!USER_ID.test(userId)) throw new Error(" --user-id must be a UUID (not an email address)");
  if (!KINDS.has(kind)) throw new Error("--kind must be ADMIN or PRO");
  if (!ACTIONS.has(action)) throw new Error("--action must be GRANT or REVOKE");
  if (!SOURCES.has(source)) throw new Error("--source must be BOOTSTRAP or OPERATOR");
  if (reason === "") throw new Error("--reason is required");
  if (source === "BOOTSTRAP") {
    if (actorId !== "") throw new Error("BOOTSTRAP cannot include --actor-id");
  } else if (!USER_ID.test(actorId)) {
    throw new Error("OPERATOR requires --actor-id as a UUID");
  } else if (actorId.toLowerCase() === userId.toLowerCase()) {
    throw new Error("actor cannot be the same user");
  }
  return {
    userId: userId.toLowerCase(),
    kind,
    action,
    source,
    reason,
    actorId: actorId === "" ? null : actorId.toLowerCase(),
  };
}

export function recordGrantSql(input) {
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const actor = input.actorId == null ? "NULL" : `${quote(input.actorId)}::uuid`;
  return `SELECT access.record_grant(${quote(input.userId)}::uuid, ${quote(input.kind)}::access.grant_kind, ${quote(input.action)}::access.grant_action, ${quote(input.source)}::access.grant_source, ${quote(input.reason)}, ${actor});\n`;
}

function hostedSsl(connectionString) {
  const mode = /(?:\?|&)sslmode=([^&]+)/.exec(connectionString)?.[1];
  if (mode === "disable") return false;
  if (mode === "verify-ca" || mode === "verify-full") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

async function runHosted(connectionString, sql) {
  const client = new pg.Client({
    connectionString,
    ssl: hostedSsl(connectionString),
    connectionTimeoutMillis: 30_000,
  });
  try {
    await client.connect();
    const result = await client.query(sql);
    return result.rows[0]?.record_grant ?? result.rows[0]?.[0];
  } catch {
    throw new Error("hosted grant insert failed");
  } finally {
    await client.end().catch(() => undefined);
  }
}

function runDocker(sql) {
  const container = process.env.BDC_DB_CONTAINER ?? "bdc-intelligence-pg";
  const database = process.env.BDC_DATABASE ?? "bdc_local";
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-At"],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr.trim() || "local grant insert failed");
  return result.stdout.trim();
}

async function main(argv) {
  const input = parseAccessGrantArgs(argv);
  const sql = recordGrantSql(input);
  const hosted = process.env.PIPELINE_DATABASE_URL?.trim();
  const id = hosted ? await runHosted(hosted, sql) : runDocker(sql);
  console.log(`access-grant: recorded ${input.action} ${input.kind} as event ${id}`);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`access-grant failed: ${error.message}`);
    process.exitCode = 1;
  });
}
