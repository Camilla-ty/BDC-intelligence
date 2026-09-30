// SUB table of a BDC data set (SOURCE_SCHEMAS 4.1, 4.8): UTF-8, tab-delimited, LF-terminated,
// one header row. Lines are kept exactly; cells are derived in the database by splitting on tabs.

import { createHash } from "node:crypto";
import { VERIFIED_SUB_HEADER } from "../lib/config.mjs";

export function parseSubTsv(buffer) {
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) throw new Error("sub.tsv is not valid UTF-8");
  if (text.length === 0) return { empty: true, header: [], headerSha256: null, headerMatches: false, rows: [] };
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const [headerLine, ...data] = lines;
  const header = headerLine.split("\t");
  const rows = data.map((raw, i) => ({ lineNumber: i + 2, raw }));
  return {
    empty: false,
    header,
    headerSha256: createHash("sha256").update(headerLine, "utf8").digest("hex"),
    headerMatches: JSON.stringify(header) === JSON.stringify(VERIFIED_SUB_HEADER),
    carriageReturns: data.filter((l) => l.includes("\r")).length,
    rows,
  };
}
