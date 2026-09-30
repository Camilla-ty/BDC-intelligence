// Database access for the pipeline: psql inside the local Docker container (scripts/db/pg.mjs),
// every script run as bdc_pipeline_writer (INSERT and SELECT only). Bulk data goes through COPY.

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

export function runScript(database, sql, { asWriter = true } = {}) {
  const script = `${asWriter ? "SET ROLE bdc_pipeline_writer;\n" : ""}${sql}`;
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
