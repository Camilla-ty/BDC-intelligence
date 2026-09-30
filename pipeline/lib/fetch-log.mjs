// Append-only fetch log (JSON Lines) at <dataDir>/fetch-log.jsonl. Each entry records one HTTP
// retrieval: URL, status, response metadata, checksum, storage key, and why it was fetched.
// Entries are hash-chained (prev_sha256 = SHA-256 of the previous line) so a rewritten or
// truncated log is detected. Request headers, including the User-Agent, are never recorded.

import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import { sha256Hex } from "./store.mjs";

export const LOG_FILE = "fetch-log.jsonl";
const GENESIS = "0".repeat(64);

const ENTRY_KEYS = [
  "seq", "session_id", "requested_at", "url", "final_url", "http_status", "content_type", "last_modified", "etag",
  "byte_size", "sha256", "storage_key", "source_type", "context", "prev_sha256",
];

export function readFetchLog(dataDir) {
  const file = path.join(dataDir, LOG_FILE);
  if (!existsSync(file)) return { entries: [], lastLineSha: GENESIS, bytes: Buffer.alloc(0) };
  const bytes = readFileSync(file);
  const lines = bytes.toString("utf8").split("\n");
  if (lines[lines.length - 1] !== "") throw new Error("fetch log does not end with a newline (truncated write?)");
  lines.pop();
  const entries = [];
  let prev = GENESIS;
  lines.forEach((line, i) => {
    const entry = JSON.parse(line);
    if (entry.seq !== i + 1) throw new Error(`fetch log entry ${i + 1} has seq ${entry.seq}`);
    if (entry.prev_sha256 !== prev) throw new Error(`fetch log hash chain broken at seq ${entry.seq}`);
    const unknown = Object.keys(entry).filter((k) => !ENTRY_KEYS.includes(k));
    if (unknown.length) throw new Error(`fetch log entry ${entry.seq} has unexpected keys: ${unknown.join(", ")}`);
    prev = sha256Hex(Buffer.from(line, "utf8"));
    entries.push(entry);
  });
  return { entries, lastLineSha: prev, bytes };
}

export function createFetchLog(dataDir) {
  const file = path.join(dataDir, LOG_FILE);
  let { entries, lastLineSha } = readFetchLog(dataDir);

  function append(fields) {
    const entry = {
      seq: entries.length + 1,
      session_id: fields.session_id,
      requested_at: fields.requested_at,
      url: fields.url,
      final_url: fields.final_url ?? null,
      http_status: fields.http_status,
      content_type: fields.content_type ?? null,
      last_modified: fields.last_modified ?? null,
      etag: fields.etag ?? null,
      byte_size: fields.byte_size ?? null,
      sha256: fields.sha256 ?? null,
      storage_key: fields.storage_key ?? null,
      source_type: fields.source_type,
      context: fields.context ?? {},
      prev_sha256: lastLineSha,
    };
    const line = JSON.stringify(entry);
    const fd = openSync(file, "a");
    try {
      appendFileSync(fd, `${line}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    lastLineSha = sha256Hex(Buffer.from(line, "utf8"));
    entries = [...entries, entry];
    return entry;
  }

  return { append, entries: () => entries };
}
