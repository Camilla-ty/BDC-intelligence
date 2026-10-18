// NUM table of a BDC data set (SOURCE_SCHEMAS 3.3, 4.3, 4.8): UTF-8, tab-delimited,
// LF-terminated. The header must match the documented eleven-column layout exactly.

import { createHash } from "node:crypto";
import { VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";

export const EMPTY_BUFFER_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Utf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function numHeaderMatches(header) {
  if (header.length !== VERIFIED_NUM_HEADER.length) return false;
  return VERIFIED_NUM_HEADER.every((label, i) => header[i] === label);
}

function utf8Error() {
  return new Error("num.tsv is not valid UTF-8");
}

// Same rule as the original buffered parser: decode as UTF-8, re-encode, and
// require a byte-identical round trip. Incomplete sequences are held until the
// next chunk or finish().
function decodeUtf8Exact(buffer) {
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) throw utf8Error();
  return text;
}

function incompleteUtf8TailLength(buffer) {
  if (buffer.length === 0) return 0;
  let i = buffer.length - 1;
  if ((buffer[i] & 0x80) === 0) return 0;
  let cont = 0;
  while (i >= 0 && (buffer[i] & 0xc0) === 0x80) {
    cont += 1;
    i -= 1;
  }
  if (i < 0) return buffer.length;
  const lead = buffer[i];
  const need = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0;
  if (need === 0) return 0;
  return cont < need ? buffer.length - i : 0;
}

// Incremental reader used by both the buffered parser and the ZIP stream.
// Line split matches Buffer.toString("utf8").split("\\n") plus a trailing-empty pop:
// a completed file that ends in LF does not emit an extra blank row.
export function createNumTsvReader() {
  let rest = "";
  let pending = Buffer.alloc(0);
  let lineNumber = 0;
  let byteLength = 0;

  const consume = (raw, events) => {
    lineNumber += 1;
    if (lineNumber === 1) {
      const header = raw.split("\t");
      events.push({
        kind: "header",
        header,
        headerSha256: sha256Utf8(raw),
        headerMatches: numHeaderMatches(header),
      });
      return;
    }
    events.push({ kind: "row", lineNumber, raw });
  };

  return {
    push(chunk) {
      if (!Buffer.isBuffer(chunk)) throw new Error("num.tsv parse requires a Buffer");
      byteLength += chunk.length;
      const joined = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const hold = incompleteUtf8TailLength(joined);
      const prefix = hold === 0 ? joined : joined.subarray(0, joined.length - hold);
      pending = hold === 0 ? Buffer.alloc(0) : joined.subarray(joined.length - hold);
      const events = [];
      if (prefix.length === 0) return events;
      const parts = (rest + decodeUtf8Exact(prefix)).split("\n");
      rest = parts.pop();
      for (const part of parts) consume(part, events);
      return events;
    },
    finish() {
      const events = [];
      if (pending.length) {
        rest += decodeUtf8Exact(pending);
        pending = Buffer.alloc(0);
      }
      if (rest !== "") consume(rest, events);
      if (byteLength === 0) {
        return [{ kind: "empty", headerSha256: EMPTY_BUFFER_SHA256 }];
      }
      return events;
    },
  };
}

function eventsToParsed(events) {
  if (events.length === 1 && events[0].kind === "empty") {
    return {
      emptyFile: true,
      header: [],
      headerSha256: EMPTY_BUFFER_SHA256,
      headerMatches: false,
      rows: [],
      carriageReturns: 0,
    };
  }
  const headerEvent = events.find((event) => event.kind === "header");
  const rows = events.filter((event) => event.kind === "row");
  return {
    emptyFile: false,
    header: headerEvent.header,
    headerSha256: headerEvent.headerSha256,
    headerMatches: headerEvent.headerMatches,
    carriageReturns: rows.filter((row) => row.raw.includes("\r")).length,
    rows: rows.map((row) => ({ lineNumber: row.lineNumber, raw: row.raw })),
  };
}

export function parseNumTsv(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error("num.tsv parse requires a Buffer");
  const reader = createNumTsvReader();
  const events = buffer.length === 0 ? [] : reader.push(buffer);
  events.push(...reader.finish());
  return eventsToParsed(events);
}

export async function* streamNumTsv(chunks) {
  const reader = createNumTsvReader();
  for await (const chunk of chunks) {
    for (const event of reader.push(chunk)) yield event;
  }
  for (const event of reader.finish()) yield event;
}

export async function collectNumTsv(chunks) {
  const events = [];
  for await (const event of streamNumTsv(chunks)) events.push(event);
  return eventsToParsed(events);
}
