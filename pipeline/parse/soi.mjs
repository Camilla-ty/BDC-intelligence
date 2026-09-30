// SOI table of a BDC data set (SOURCE_SCHEMAS 3.3, 4.8, 5.1): UTF-8, tab-delimited,
// LF-terminated. The first 21 labels must match the documented preset list in order.
// Extra dynamic columns after that are expected. Lines are kept exactly; cells are
// derived in the database by splitting on tabs.

import { createHash } from "node:crypto";
import { VERIFIED_SOI_PRESET_HEADER } from "../lib/config.mjs";

export const EMPTY_BUFFER_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function sha256Utf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function presetHeaderMatches(header) {
  if (header.length < VERIFIED_SOI_PRESET_HEADER.length) return false;
  return VERIFIED_SOI_PRESET_HEADER.every((label, i) => header[i] === label);
}

export function parseSoiTsv(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error("soi.tsv parse requires a Buffer");
  if (buffer.length === 0) {
    return {
      emptyFile: true,
      header: [],
      headerSha256: EMPTY_BUFFER_SHA256,
      presetHeaderMatches: false,
      rows: [],
      carriageReturns: 0,
    };
  }
  const text = buffer.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(buffer)) throw new Error("soi.tsv is not valid UTF-8");
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const [headerLine, ...data] = lines;
  const header = headerLine.split("\t");
  const rows = data.map((raw, i) => ({ lineNumber: i + 2, raw }));
  return {
    emptyFile: false,
    header,
    headerSha256: sha256Utf8(headerLine),
    presetHeaderMatches: presetHeaderMatches(header),
    carriageReturns: data.filter((l) => l.includes("\r")).length,
    rows,
  };
}
