// Pipeline database access. SQL text is unchanged.
// PIPELINE_DATABASE_URL selects the hosted pg client. Otherwise psql runs inside the
// local Docker container (scripts/db/pg.mjs). Every script runs as bdc_pipeline_writer
// unless asWriter is false. Bulk data stays in COPY. This module does not read the web URL.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { psql } from "../../scripts/db/pg.mjs";

export function lit(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function num(value) {
  if (value === null || value === undefined) return "NULL";
  if (!Number.isSafeInteger(value)) throw new Error(`not a safe integer: ${value}`);
  return String(value);
}

function copyField(value) {
  if (value === null || value === undefined) return "\\N";
  return String(value).replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// A COPY ... FROM STDIN block with its data inline, for psql scripts.
export function copyBlock(table, columns, rows) {
  const lines = rows.map((r) => r.map(copyField).join("\t"));
  return `COPY ${table} (${columns.join(", ")}) FROM STDIN;\n${lines.join("\n")}${lines.length ? "\n" : ""}\\.\n`;
}

export function pipelineConnectionTarget(env = process.env) {
  const raw = env.PIPELINE_DATABASE_URL;
  if (raw == null || String(raw).trim() === "") return { mode: "local" };
  return { mode: "hosted", connectionString: String(raw).trim() };
}

export function assertPipelineUrl(connectionString) {
  if (!connectionString || !String(connectionString).trim()) {
    throw new Error("PIPELINE_DATABASE_URL is not set");
  }
  let port = "";
  try {
    port = new URL(String(connectionString).trim()).port;
  } catch {
    throw new Error("PIPELINE_DATABASE_URL is not a valid URL");
  }
  if (port === "6543") {
    throw new Error(
      "PIPELINE_DATABASE_URL port 6543 is the transaction pooler. Pipeline writes require the session pooler on port 5432 or a direct connection.",
    );
  }
}

export function publicPipelineError(error, connectionString) {
  let message = error instanceof Error ? error.message : String(error);
  if (!message) message = "pipeline database script failed";
  if (connectionString) message = message.split(String(connectionString)).join("[redacted-url]");
  message = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-url]");
  try {
    const url = new URL(String(connectionString));
    const password = decodeURIComponent(url.password);
    const user = decodeURIComponent(url.username);
    if (password) message = message.split(password).join("[redacted]");
    if (user) message = message.split(user).join("[redacted-user]");
    if (url.hostname) message = message.split(url.hostname).join("[redacted-host]");
  } catch {
    // assertPipelineUrl already rejected a URL that cannot be parsed.
  }
  return message;
}

export function pipelineScript(sql, { asWriter = true } = {}) {
  return `${asWriter ? "SET ROLE bdc_pipeline_writer;\n" : ""}${sql}`;
}

// Splits a psql script into SQL text and COPY FROM STDIN payloads. The `\.` terminator
// is a psql meta-command; the hosted client sends that payload with the COPY protocol.
export function splitPsqlScript(script) {
  const parts = [];
  const lines = String(script).split("\n");
  const sql = [];
  const flushSql = () => {
    const text = sql.join("\n").trim();
    sql.length = 0;
    if (text) parts.push({ kind: "sql", text });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^COPY\s+\S.*\sFROM\sSTDIN;\s*$/.test(line)) {
      flushSql();
      const data = [];
      i += 1;
      for (; i < lines.length; i += 1) {
        if (lines[i] === "\\.") break;
        data.push(lines[i]);
      }
      if (i >= lines.length || lines[i] !== "\\.") {
        throw new Error("COPY FROM STDIN is missing its terminator");
      }
      parts.push({ kind: "copy", text: line.trim(), payload: data.length ? `${data.join("\n")}\n` : "" });
      continue;
    }
    sql.push(line);
  }
  flushSql();
  return parts;
}

function hostedSsl(connectionString) {
  const mode = /(?:\?|&)sslmode=([^&]+)/.exec(connectionString)?.[1];
  if (mode === "disable") return false;
  if (mode === "verify-ca" || mode === "verify-full") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function rowsToLines(result) {
  const results = Array.isArray(result) ? result : [result];
  const lines = [];
  for (const item of results) {
    for (const row of item.rows ?? []) {
      const cells = Array.isArray(row) ? row : [row];
      lines.push(cells.map(cellText).join("\t"));
    }
  }
  return lines;
}

function copyInQuery(text, payload) {
  let settled = false;
  return {
    text,
    callback: null,
    submit(connection) {
      connection.query(text);
      return null;
    },
    handleCopyInResponse(connection) {
      const buf = Buffer.from(payload, "utf8");
      const chunk = 1024 * 1024;
      for (let i = 0; i < buf.length; i += chunk) connection.sendCopyFromChunk(buf.subarray(i, i + chunk));
      connection.endCopyFrom();
    },
    handleCopyData() {},
    handleRowDescription() {},
    handleDataRow() {},
    handleCommandComplete() {},
    handleEmptyQuery() {},
    handlePortalSuspended() {},
    handleReadyForQuery() {
      if (settled) return;
      settled = true;
      this.callback?.(null);
    },
    handleError(err) {
      if (settled) return;
      settled = true;
      this.callback?.(err instanceof Error ? err : new Error(err?.message || "COPY failed"));
    },
  };
}

export async function executeHostedScript(connectionString, script) {
  assertPipelineUrl(connectionString);
  const client = new pg.Client({
    connectionString: String(connectionString).trim(),
    ssl: hostedSsl(connectionString),
    connectionTimeoutMillis: 30_000,
  });
  client._types.getTypeParser = () => (value) => value;
  client.on("error", () => {});
  try {
    await client.connect();
    const lines = [];
    for (const part of splitPsqlScript(script)) {
      if (part.kind === "sql") {
        const result = await client.query({ text: part.text, queryMode: "simple", rowMode: "array" });
        lines.push(...rowsToLines(result));
      } else {
        await new Promise((resolve, reject) => {
          const query = copyInQuery(part.text, part.payload);
          query.callback = (err) => (err ? reject(err) : resolve());
          client.query(query);
        });
      }
    }
    return lines;
  } catch (error) {
    throw new Error(publicPipelineError(error, connectionString));
  } finally {
    await client.end().catch(() => undefined);
  }
}

function runHosted(connectionString, script) {
  assertPipelineUrl(connectionString);
  const runner = fileURLToPath(import.meta.url);
  const result = spawnSync(process.execPath, [runner, "--hosted-script"], {
    input: script,
    encoding: "utf8",
    env: { ...process.env, PIPELINE_DATABASE_URL: connectionString },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw new Error(publicPipelineError(result.error, connectionString));
  if (result.status !== 0) {
    const message = publicPipelineError(
      new Error((result.stderr || "").trim() || `hosted pipeline script exited with ${result.status}`),
      connectionString,
    );
    throw new Error(message);
  }
  return (result.stdout ?? "").split("\n").filter((line) => line !== "");
}

export function runScript(database, sql, { asWriter = true } = {}) {
  const script = pipelineScript(sql, { asWriter });
  const target = pipelineConnectionTarget();
  if (target.mode === "hosted") return runHosted(target.connectionString, script);
  const r = psql(database, script, ["-At", "-F", "\t"]);
  if (r.status !== 0) {
    const message = r.stderr.split("\n").filter((l) => /ERROR|DETAIL|CONTEXT|LINE/.test(l)).slice(0, 10).join("\n");
    throw new Error(message || r.stderr.trim() || `psql exited with ${r.status}`);
  }
  return r.stdout.split("\n").filter((l) => l !== "");
}

export function queryRows(database, sql, opts) {
  return runScript(database, sql, opts).map((l) => l.split("\t"));
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect && process.argv[2] === "--hosted-script") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    const lines = await executeHostedScript(process.env.PIPELINE_DATABASE_URL, Buffer.concat(chunks).toString("utf8"));
    if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
