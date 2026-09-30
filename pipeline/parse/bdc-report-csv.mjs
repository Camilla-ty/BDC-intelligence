// BDC Report CSV (SOURCE_SCHEMAS 6 and 6.1). Only the verified 2020-2026 layout is accepted:
// the header must equal VERIFIED_BDC_REPORT_HEADER exactly (after removing an optional BOM).

import { createHash } from "node:crypto";
import { VERIFIED_BDC_REPORT_HEADER } from "../lib/config.mjs";
import { parseCsvRecords } from "./csv.mjs";

export function parseBdcReportCsv(buffer) {
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) throw new Error("BDC Report CSV is not valid UTF-8");
  const { bom, records } = parseCsvRecords(text);
  if (records.length === 0) {
    return { bom, header: [], headerRaw: "", headerSha256: null, headerMatches: false, rows: [] };
  }
  const [headerRecord, ...rest] = records;
  const header = headerRecord.cells;
  const headerRaw = (bom ? "\uFEFF" : "") + headerRecord.raw;
  const rows = rest.filter((r) => !(r.cells.length === 1 && r.cells[0] === ""));
  return {
    bom,
    header,
    headerRaw,
    headerSha256: createHash("sha256").update(headerRaw, "utf8").digest("hex"),
    headerMatches: JSON.stringify(header) === JSON.stringify(VERIFIED_BDC_REPORT_HEADER),
    rows,
  };
}
