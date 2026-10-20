// One-time NUM quoted-TSV recovery backfill for a pinned artifact and locked lines (ADR 0021).
// Inserts a new NUM table_load holding only the locked rows as QUOTED_RECOVERY, with sidecars,
// exceptions, and gated facts. Stored FIELD_COUNT_MISMATCH rows and their load are never changed.
// The projection SQL mirrors obs.projection.num v3 in units/dataset-num.mjs; that file is not
// imported for its private helpers, so parser and projection v3 definitions stay unchanged.
// Recovery input is the stored raw_line. A ZIP read is only an optional byte-check.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { finished } from "node:stream/promises";
import { lit, num, queryRows } from "../lib/db.mjs";
import { NUM_MEMBER_PATH, VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import { parseIdentifierMemberFromSegments } from "../normalize/num-segments.mjs";
import { streamNumTsv } from "../parse/num.mjs";
import { footlenMatchesUnquotedFootnote, recoverQuotedNumCells } from "../parse/num-quoted-tsv.mjs";
import { streamMemberChunks } from "../parse/zip.mjs";
import { ensureAndLinkRuleForRun } from "./rules.mjs";
import { parseCounts, pipelineCodeVersion } from "./run.mjs";
import { LOCATION_COLUMNS, finishBlock, prelude } from "./sql.mjs";

export const BACKFILL_RULE = Object.freeze({ code: "pipeline.num_quoted_recovery_backfill", version: "1" });
export const PARSER_RULE = Object.freeze({ code: "parser.sec_num_tsv", version: "3" });
export const PROJECTION_RULE = Object.freeze({ code: "obs.projection.num", version: "3" });
export const BACKFILL_RUN_KIND = "NUM_QUOTED_RECOVERY_BACKFILL";
// Distinct from MATURITY_WORKER_LOCK_KEY and NUM_CURRENCY_BIND_LOCK_KEY.
export const NUM_QUOTED_BACKFILL_LOCK_KEY = 8120261020;
export const ALREADY_LOADED_MARKER = "NUM_QUOTED_BACKFILL_ALREADY_LOADED";

const ACTOR = "pipeline num:recover-quoted";
const WIDTH = VERIFIED_NUM_HEADER.length;
const pos = (label) => VERIFIED_NUM_HEADER.indexOf(label) + 1;
const ADSH = pos("adsh");
const TAG = pos("tag");
const VERSION = pos("version");
const DDATE = pos("ddate");
const QTRS = pos("qtrs");
const UOM = pos("uom");
const SEGMENTS = pos("segments");
const VALUE = pos("value");
const FOOTNOTE = pos("footnote");
const FOOTLEN = pos("footlen");

// ADR 0021 scope. Structure-only: line numbers and raw_line SHA-256, no raw text.
export const AUG_2026_NUM_BACKFILL_PIN = Object.freeze({
  label: "August 2026",
  artifactSha256: "0529ab8920f4d5c02d4f9b1ddc933d914065d4a3acf8bed39a49f44b040f657d",
  sourceTypeCode: "SEC_BDC_DATASET_ZIP",
  sourceRowCount: 950069,
  sourceMismatchCount: 23,
  locks: Object.freeze([
    { line: 1790, sha: "d50a435159ac66fbd1b99c6dd7ed6e94986b73149c62cc1c69c88e3c87dbad9f" },
    { line: 18371, sha: "8bbfca0c8b78f54570afa2ac4e8a4af961c1709bb1e546aa7d0b3cee31113a2f" },
    { line: 273144, sha: "a03cdf1fd6fb058bdd75993f130ef1d60382653c9a4a969bab11d074779bf45b" },
    { line: 273311, sha: "9378a61feba91847b2c98898d530e4d37eed0e8e2483f986649c950efdd4448c" },
    { line: 433063, sha: "65c364f597a8406899be6f3432be687180e8c2bcb4e90427ac1e0eab3a8a3236" },
    { line: 634367, sha: "b4e68d22c66e6b38f74a3f4aa7616dfe81f64625a8b56c7f32e35311574b2e25" },
    { line: 638720, sha: "27b1ca6e3ed13178ce877782bce04c65975655b56091862d5dc12cbb9836fcb4" },
    { line: 639900, sha: "7d3e9bf84caea73a41a9add890da77f359b3a875bbc04c4193285c1aeb4d998e" },
    { line: 639901, sha: "4cd89e519246373b36e296a3b2a994b11adf913ca68886228391b2141853b3f9" },
    { line: 640021, sha: "7af804dbc42b865ec2f8bc33777512cc0d4fe1086aeb6f8a4d8d12e4279c9854" },
    { line: 640022, sha: "21e7d26aa4efc17de49058b43b0a2eb33ecf79fc77dabba1dd5f8f8de991fa3b" },
    { line: 640154, sha: "e9e537ac0eb75a8edc40024686e91c7a4c5f3835fb19952b910fb8fa9a75d519" },
    { line: 643855, sha: "0093b2b44db34213e8124dac77a19b4b759105915511753ebfe0232d8da53187" },
    { line: 647250, sha: "f053b0b920b66a4b429e42ad1d8997d45b4d73d6bee1207b243acdbeddad1602" },
    { line: 652709, sha: "f5c1897310f4377404440e7972a79650ea6d3a58247acc31898e7965d5c36950" },
    { line: 793877, sha: "300e10a52e05e32c4658e7d4f18a25d6b9ff55cd33cabbd86215d7ff369ba57b" },
    { line: 802489, sha: "d801c302ae06d7420e0d9e1ab20a10d786e271708832e7dd9f4cb40d90dca615" },
    { line: 806821, sha: "28d6f594af259fe11265043ff5f0efa9f4711fea6386616f88ef0f877ec3c812" },
    { line: 816624, sha: "fc1ab92c3768f2302b701b66d966a712885bc02b41d99122f6fb10302d147565" },
    { line: 825968, sha: "74e5314e6d53ac968fb0934d2c077c2fa2bf9018a141537676b8bf0204ae8507" },
    { line: 828926, sha: "46e710eaef2dee218ea918d67957eafbca44b1285364c15cf0baa187425a2105" },
    { line: 841844, sha: "4487bb8603a191503640b19ad7acfcda01b95b94859d37deedc4e77f30dcba4a" },
    { line: 949170, sha: "a3da67bff9895ad04f51f7873662fbf1aae6e570f5713164dcbf5fa7bfeec7ce" },
  ].map((lock) => Object.freeze(lock))),
  d6PassLines: Object.freeze([
    1790, 18371, 273144, 273311, 433063, 639900, 640021, 640154, 647250, 825968, 828926, 841844, 949170,
  ]),
  d6FailLines: Object.freeze([
    634367, 638720, 639901, 640022, 643855, 652709, 793877, 802489, 806821, 816624,
  ]),
});

export class BackfillHardStop extends Error {
  constructor(message) {
    super(`num:recover-quoted hard stop: ${message}`);
    this.name = "BackfillHardStop";
  }
}

function sha256Utf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function validatePin(pin) {
  if (!/^[0-9a-f]{64}$/.test(pin?.artifactSha256 ?? "")) throw new BackfillHardStop("pin artifactSha256 is not a SHA-256");
  if (typeof pin.sourceTypeCode !== "string" || pin.sourceTypeCode === "") throw new BackfillHardStop("pin sourceTypeCode is missing");
  for (const key of ["sourceRowCount", "sourceMismatchCount"]) {
    if (!Number.isSafeInteger(pin[key]) || pin[key] < 0) throw new BackfillHardStop(`pin ${key} is not a count`);
  }
  if (!Array.isArray(pin.locks) || pin.locks.length === 0) throw new BackfillHardStop("pin has no locked lines");
  if (pin.locks.length !== pin.sourceMismatchCount) {
    throw new BackfillHardStop("pin lock count differs from the pinned field_count_mismatch_count");
  }
  const lines = new Set();
  for (const lock of pin.locks) {
    if (!Number.isSafeInteger(lock.line) || lock.line < 1) throw new BackfillHardStop(`pin line ${lock.line} is not a line number`);
    if (!/^[0-9a-f]{64}$/.test(lock.sha)) throw new BackfillHardStop(`pin line ${lock.line} has no SHA-256`);
    if (lines.has(lock.line)) throw new BackfillHardStop(`pin line ${lock.line} is listed twice`);
    lines.add(lock.line);
  }
  const pass = new Set(pin.d6PassLines);
  const fail = new Set(pin.d6FailLines);
  if (pass.size + fail.size !== lines.size || [...pass].some((l) => fail.has(l) || !lines.has(l)) || [...fail].some((l) => !lines.has(l))) {
    throw new BackfillHardStop("pin D6 pass and fail lines must partition the locked lines");
  }
}

// Classifies stored rows against the locks with the existing quoted parser. Throws on any hard stop.
export function recoverLockedRows(pin, storedRows) {
  const byLine = new Map(storedRows.map((row) => [row.line, row]));
  const pass = new Set(pin.d6PassLines);
  return pin.locks.map((lock) => {
    const row = byLine.get(lock.line);
    if (!row) throw new BackfillHardStop(`locked line ${lock.line} is missing from the pinned source table_load`);
    if (row.parseStatus !== "FIELD_COUNT_MISMATCH") {
      throw new BackfillHardStop(`locked line ${lock.line} parse_status is ${row.parseStatus}, not FIELD_COUNT_MISMATCH`);
    }
    if (row.sha !== lock.sha || sha256Utf8(row.raw) !== lock.sha) {
      throw new BackfillHardStop(`locked line ${lock.line} raw_line SHA-256 differs from the lock`);
    }
    if (row.raw.split("\t").length === WIDTH) {
      throw new BackfillHardStop(`locked line ${lock.line} naive field count equals the header width`);
    }
    const recovered = recoverQuotedNumCells(row.raw, WIDTH);
    if (!recovered || recovered.cells.length !== WIDTH) {
      throw new BackfillHardStop(`locked line ${lock.line} is not a valid ${WIDTH}-field quoted TSV row`);
    }
    const cells = recovered.cells;
    const d6 = footlenMatchesUnquotedFootnote(cells[FOOTNOTE - 1], cells[FOOTLEN - 1]);
    if (d6 !== pass.has(lock.line)) {
      throw new BackfillHardStop(`locked line ${lock.line} D6 result differs from the pinned classification`);
    }
    return {
      line: lock.line,
      sha: lock.sha,
      raw: row.raw,
      cells,
      identifierMember: parseIdentifierMemberFromSegments(cells[SEGMENTS - 1]) ?? "",
      d6,
    };
  });
}

function artifactWhere(pin, alias = "a") {
  return `${alias}.sha256 = ${lit(pin.artifactSha256)} AND ${alias}.source_type_code = ${lit(pin.sourceTypeCode)}`;
}

function loadedOnRuleCodeSql(pin) {
  return `SELECT 1 FROM raw.artifact a
JOIN ops.artifact_processing p ON p.artifact_id = a.id
JOIN ops.rule_version rv ON rv.id = p.rule_version_id
WHERE ${artifactWhere(pin)}
  AND p.outcome = 'LOADED'
  AND rv.rule_code = ${lit(BACKFILL_RULE.code)}`;
}

// LOADED on any version of the backfill rule_code. A version bump does not authorize a rerun.
export function backfillAlreadyLoaded(database, pin) {
  return queryRows(database, `${loadedOnRuleCodeSql(pin)} LIMIT 1;`).length > 0;
}

// Read-only. Raw lines are returned hex-encoded so tabs and newlines survive the row format.
export function readLockedSource(database, pin, sourceTableLoadId) {
  const artifacts = queryRows(database, `SELECT a.id::text FROM raw.artifact a WHERE ${artifactWhere(pin)} ORDER BY a.id;`);
  if (artifacts.length !== 1) {
    throw new BackfillHardStop(`expected exactly one ${pin.sourceTypeCode} artifact with the pinned SHA-256, found ${artifacts.length}`);
  }
  const artifactId = Number(artifacts[0][0]);
  const loads = queryRows(database, `SELECT tl.id::text, tl.row_count::text, tl.field_count_mismatch_count::text,
       (tl.header = ARRAY[${VERIFIED_NUM_HEADER.map(lit).join(", ")}]::text[])::text, m.member_path, rv.rule_code, rv.version
FROM raw.table_load tl
LEFT JOIN raw.artifact_member m ON m.id = tl.artifact_member_id
JOIN ops.rule_version rv ON rv.id = tl.parser_rule_version_id
WHERE tl.artifact_id = ${num(artifactId)} AND tl.table_code = 'NUM'
ORDER BY tl.id;`);
  if (loads.length !== 1) {
    throw new BackfillHardStop(`expected exactly one NUM table_load on the pinned artifact, found ${loads.length}`);
  }
  const [loadId, rowCount, mismatches, headerOk, memberPath, parserCode, parserVersion] = loads[0];
  if (parserCode === PARSER_RULE.code && parserVersion === PARSER_RULE.version) {
    throw new BackfillHardStop(`source table_load was written by ${PARSER_RULE.code} v${PARSER_RULE.version}; a second load on that version is not allowed`);
  }
  if (Number(loadId) !== sourceTableLoadId) {
    throw new BackfillHardStop(`the pinned artifact's NUM table_load is ${loadId}, not ${sourceTableLoadId}`);
  }
  if (Number(rowCount) !== pin.sourceRowCount || Number(mismatches) !== pin.sourceMismatchCount) {
    throw new BackfillHardStop(`source table_load counts ${rowCount}/${mismatches} differ from the pinned ${pin.sourceRowCount}/${pin.sourceMismatchCount}`);
  }
  if (headerOk !== "t" && headerOk !== "true") throw new BackfillHardStop("source table_load header is not the verified NUM header");
  if (memberPath !== NUM_MEMBER_PATH) throw new BackfillHardStop(`source table_load member is not ${NUM_MEMBER_PATH}`);
  const fcm = queryRows(database, `SELECT count(*)::text FROM raw.tabular_row
WHERE table_load_id = ${num(sourceTableLoadId)} AND parse_status = 'FIELD_COUNT_MISMATCH';`);
  if (Number(fcm[0][0]) !== pin.locks.length) {
    throw new BackfillHardStop(`source table_load has ${fcm[0][0]} FIELD_COUNT_MISMATCH rows, not the ${pin.locks.length} locked rows`);
  }
  const lines = pin.locks.map((lock) => num(lock.line)).join(", ");
  const rows = queryRows(database, `SELECT r.line_number::text, r.raw_line_sha256, r.parse_status::text,
       encode(convert_to(r.raw_line, 'UTF8'), 'hex')
FROM raw.tabular_row r
WHERE r.table_load_id = ${num(sourceTableLoadId)} AND r.line_number IN (${lines})
ORDER BY r.line_number;`).map(([line, sha, parseStatus, hex]) => ({
    line: Number(line), sha, parseStatus, raw: Buffer.from(hex, "hex").toString("utf8"),
  }));
  return { artifactId, rows };
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest("hex");
}

// Optional byte-check. Any disagreement is a hard stop; ZIP text never replaces stored text.
export async function verifyZipLines(pin, zipPath, recovered) {
  if (await sha256File(zipPath) !== pin.artifactSha256) {
    throw new BackfillHardStop("ZIP file SHA-256 differs from the pinned artifact");
  }
  const want = new Map(recovered.map((row) => [row.line, row.raw]));
  const last = Math.max(...want.keys());
  const seen = new Set();
  for await (const event of streamNumTsv(streamMemberChunks(zipPath, NUM_MEMBER_PATH))) {
    if (event.kind !== "row") continue;
    if (want.has(event.lineNumber)) {
      if (event.raw !== want.get(event.lineNumber)) {
        throw new BackfillHardStop(`ZIP line ${event.lineNumber} bytes differ from the stored raw_line`);
      }
      seen.add(event.lineNumber);
    }
    if (event.lineNumber >= last) break;
  }
  if (seen.size !== want.size) throw new BackfillHardStop("ZIP NUM member does not contain every locked line");
}

function exceptionRowsSql(staging, kind, detail, projId, runId) {
  return `
CREATE TEMP TABLE ${staging}_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM ${staging} s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO ${staging}_ev SELECT * FROM ins;
INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
SELECT pg_temp.ctx('load'), s.tabular_row_id, ${lit(kind)}, ${lit(detail)}, e.id, ${num(projId)}, ${num(runId)}
FROM ${staging} s JOIN ${staging}_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;
`;
}

/**
 * One transaction: every data insert and the LOADED processing row commit together or not at all.
 * @param {{ pin: object, sourceTableLoadId: number, recovered: ReturnType<typeof recoverLockedRows>,
 *   runId: number, ruleIds: { backfill: number, parser: number, projection: number } }} input
 */
export function backfillUnitSql({ pin, sourceTableLoadId, recovered, runId, ruleIds }) {
  const src = num(sourceTableLoadId);
  const run = num(runId);
  const parserId = num(ruleIds.parser);
  const projId = num(ruleIds.projection);
  const n = recovered.length;
  const passCount = recovered.filter((row) => row.d6).length;
  const failCount = n - passCount;
  const lockValues = recovered.map((row) => `(${num(row.line)}, ${lit(row.sha)}, ${lit(JSON.stringify(row.cells))}::jsonb, ${lit(row.identifierMember)}, ${row.d6})`).join(",\n  ");
  const detail = `${pin.label ?? "Pinned artifact"}: NUM quoted-TSV recovery backfill of ${n} locked rows from table_load ${sourceTableLoadId} (ADR 0021)`;
  return `${prelude()}
DO $backfill_lock$ BEGIN
  PERFORM pg_advisory_xact_lock(${NUM_QUOTED_BACKFILL_LOCK_KEY});
  IF EXISTS (${loadedOnRuleCodeSql(pin)}) THEN
    RAISE EXCEPTION '%', ${lit(ALREADY_LOADED_MARKER)};
  END IF;
END $backfill_lock$;

SELECT pg_temp.fail('expected exactly one pinned artifact')
WHERE (SELECT count(*) FROM raw.artifact a WHERE ${artifactWhere(pin)}) <> 1;
INSERT INTO _ctx SELECT 'artifact', a.id FROM raw.artifact a WHERE ${artifactWhere(pin)};
SELECT pg_temp.fail('pipeline.num_load is not LOADED for the pinned artifact')
WHERE NOT EXISTS (
  SELECT 1 FROM ops.artifact_processing p JOIN ops.rule_version rv ON rv.id = p.rule_version_id
  WHERE p.artifact_id = pg_temp.ctx('artifact') AND rv.rule_code = 'pipeline.num_load' AND p.outcome = 'LOADED');
SELECT pg_temp.fail('the pinned source table_load is not the only NUM load of the pinned artifact')
WHERE (SELECT count(*) FROM raw.table_load WHERE artifact_id = pg_temp.ctx('artifact') AND table_code = 'NUM') <> 1
   OR NOT EXISTS (
     SELECT 1 FROM raw.table_load tl JOIN raw.artifact_member m ON m.id = tl.artifact_member_id
     WHERE tl.id = ${src} AND tl.artifact_id = pg_temp.ctx('artifact') AND tl.table_code = 'NUM'
       AND tl.parser_rule_version_id <> ${parserId}
       AND tl.row_count = ${num(pin.sourceRowCount)} AND tl.field_count_mismatch_count = ${num(pin.sourceMismatchCount)}
       AND tl.header = ARRAY[${VERIFIED_NUM_HEADER.map(lit).join(", ")}]::text[]
       AND m.member_path = ${lit(NUM_MEMBER_PATH)});
INSERT INTO _ctx SELECT 'num_member', artifact_member_id FROM raw.table_load WHERE id = ${src};

CREATE TEMP TABLE _lock (line_number bigint PRIMARY KEY, raw_line_sha256 text NOT NULL, recovered_cells jsonb NOT NULL,
  identifier_member text NOT NULL, d6 boolean NOT NULL) ON COMMIT DROP;
INSERT INTO _lock VALUES
  ${lockValues};
SELECT pg_temp.fail('locked source row is missing, changed, or not FIELD_COUNT_MISMATCH')
FROM _lock l
WHERE NOT EXISTS (
  SELECT 1 FROM raw.tabular_row s
  WHERE s.table_load_id = ${src} AND s.line_number = l.line_number
    AND s.raw_line_sha256 = l.raw_line_sha256 AND s.parse_status = 'FIELD_COUNT_MISMATCH')
LIMIT 1;
SELECT pg_temp.fail('source FIELD_COUNT_MISMATCH rows differ from the locked rows')
WHERE (SELECT count(*) FROM raw.tabular_row s WHERE s.table_load_id = ${src} AND s.parse_status = 'FIELD_COUNT_MISMATCH')
   <> (SELECT count(*) FROM _lock);

WITH ins AS (
  INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
  SELECT s.artifact_id, s.artifact_member_id, 'NUM', s.delimiter, s.header, s.header_sha256,
         ${parserId}, ${num(n)}, ${num(n)}, 'OK'::ref.parse_status, ${run}
  FROM raw.table_load s WHERE s.id = ${src}
  RETURNING id)
INSERT INTO _ctx SELECT 'load', id FROM ins;

INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT pg_temp.ctx('load'), s.line_number, s.raw_line, s.raw_line_sha256, s.cells, s.field_count,
       'QUOTED_RECOVERY'::ref.parse_status, ${run}
FROM raw.tabular_row s JOIN _lock l ON l.line_number = s.line_number
WHERE s.table_load_id = ${src}
ORDER BY s.line_number;

INSERT INTO raw.num_quoted_recovery (tabular_row_id, recovered_cells, recovered_field_count, parser_rule_version_id, run_id)
SELECT r.id,
       ARRAY(SELECT e FROM jsonb_array_elements_text(l.recovered_cells) WITH ORDINALITY AS t(e, ord) ORDER BY ord),
       jsonb_array_length(l.recovered_cells),
       ${parserId}, ${run}
FROM raw.tabular_row r
JOIN _lock l ON l.line_number = r.line_number
WHERE r.table_load_id = pg_temp.ctx('load')
ORDER BY r.line_number;

SELECT pg_temp.fail('D6 result in the database differs from the quoted parser')
FROM _lock l
JOIN raw.tabular_row r ON r.table_load_id = pg_temp.ctx('load') AND r.line_number = l.line_number
JOIN raw.table_load tl ON tl.id = r.table_load_id
JOIN raw.num_quoted_recovery q ON q.tabular_row_id = r.id
WHERE raw.num_quoted_footlen_ok(q.recovered_cells, tl.header) IS DISTINCT FROM l.d6
LIMIT 1;

CREATE TEMP TABLE _footlen (${LOCATION_COLUMNS}) ON COMMIT DROP;
INSERT INTO _footlen
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.id, NULL, NULL, NULL, r.line_number
FROM raw.tabular_row r
JOIN raw.table_load tl ON tl.id = r.table_load_id
JOIN raw.num_quoted_recovery q ON q.tabular_row_id = r.id
WHERE r.table_load_id = pg_temp.ctx('load')
  AND r.parse_status = 'QUOTED_RECOVERY'
  AND NOT raw.num_quoted_footlen_ok(q.recovered_cells, tl.header)
ORDER BY r.line_number;
${exceptionRowsSql("_footlen", "FOOTLEN_MISMATCH", "NUM quoted-recovery footnote length does not equal footlen; recovery kept, not projected (SOURCE_SCHEMAS 4.8)", ruleIds.projection, runId)}
CREATE TEMP TABLE _ok ON COMMIT DROP AS
SELECT r.id AS tabular_row_id, r.line_number, q.recovered_cells AS cells
FROM raw.tabular_row r
JOIN raw.table_load tl ON tl.id = r.table_load_id
JOIN raw.num_quoted_recovery q ON q.tabular_row_id = r.id
WHERE r.table_load_id = pg_temp.ctx('load')
  AND r.parse_status = 'QUOTED_RECOVERY'
  AND raw.num_quoted_footlen_ok(q.recovered_cells, tl.header);
SELECT pg_temp.fail('NUM adsh cell is not an accession number') FROM _ok WHERE cells[${ADSH}] !~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' LIMIT 1;
SELECT pg_temp.fail('NUM tag cell is empty') FROM _ok WHERE cells[${TAG}] = '' LIMIT 1;
SELECT pg_temp.fail('NUM version cell is empty') FROM _ok WHERE cells[${VERSION}] = '' LIMIT 1;
SELECT pg_temp.fail('NUM uom cell is empty') FROM _ok WHERE cells[${UOM}] = '' LIMIT 1;
SELECT pg_temp.fail('NUM qtrs is not a non-negative integer') FROM _ok WHERE cells[${QTRS}] !~ '^[0-9]+$' LIMIT 1;
DO $num_date$ BEGIN
  PERFORM pg_temp.strict_date(cells[${DDATE}], 'YYYYMMDD', '^[0-9]{8}$') FROM _ok;
END $num_date$;
SELECT pg_temp.fail('NUM value cell is not empty or a decimal')
FROM _ok WHERE cells[${VALUE}] <> '' AND cells[${VALUE}] !~ '^-?[0-9]+(\\.[0-9]+)?$' LIMIT 1;

CREATE TEMP TABLE _orphan (${LOCATION_COLUMNS}) ON COMMIT DROP;
INSERT INTO _orphan
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, NULL, NULL, NULL, r.line_number
FROM _ok r
WHERE NOT EXISTS (SELECT 1 FROM registry.filing f WHERE f.accession_number = r.cells[${ADSH}])
ORDER BY r.line_number;
${exceptionRowsSql("_orphan", "ORPHAN_ADSH", "NUM adsh cell has no registry.filing row; raw line kept, observation not created; accession prefix was not used", ruleIds.projection, runId)}
CREATE TEMP TABLE _matched ON COMMIT DROP AS
SELECT r.*, f.id AS filing_id, nullif(l.identifier_member, '') AS identifier_member
FROM _ok r
JOIN registry.filing f ON f.accession_number = r.cells[${ADSH}]
JOIN _lock l ON l.line_number = r.line_number
WHERE NOT EXISTS (SELECT 1 FROM _orphan o WHERE o.tabular_row_id = r.tabular_row_id);

CREATE TEMP TABLE _row_src (${LOCATION_COLUMNS}, filing_id bigint, tag text, tag_version text,
  reported_date_raw text, reported_date date, qtrs_raw text, qtrs integer, duration_kind ref.duration_kind,
  uom_raw text, segments_raw text, identifier_member_raw text, value_raw text, value_numeric numeric,
  value_state ref.value_state) ON COMMIT DROP;
INSERT INTO _row_src
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, NULL, NULL, NULL, r.line_number,
       r.filing_id, r.cells[${TAG}], r.cells[${VERSION}],
       r.cells[${DDATE}], pg_temp.strict_date(r.cells[${DDATE}], 'YYYYMMDD', '^[0-9]{8}$'),
       r.cells[${QTRS}], r.cells[${QTRS}]::integer,
       (CASE WHEN r.cells[${QTRS}]::integer = 0 THEN 'POINT_IN_TIME' ELSE 'DURATION' END)::ref.duration_kind,
       r.cells[${UOM}], nullif(r.cells[${SEGMENTS}], ''), r.identifier_member,
       r.cells[${VALUE}],
       CASE WHEN r.cells[${VALUE}] = '' THEN NULL ELSE r.cells[${VALUE}]::numeric END,
       (CASE WHEN r.cells[${VALUE}] = '' THEN 'UNKNOWN' ELSE 'REPORTED' END)::ref.value_state
FROM _matched r ORDER BY r.line_number;
CREATE TEMP TABLE _row_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${run}
  FROM _row_src s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _row_ev SELECT * FROM ins;

INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw, reported_date,
    qtrs_raw, qtrs, duration_kind, uom_raw, segments_raw, identifier_member_raw, value_raw, value_numeric,
    value_state, rule_version_id, evidence_id, run_id)
SELECT s.tabular_row_id, s.filing_id, s.tag, s.tag_version, s.reported_date_raw, s.reported_date,
       s.qtrs_raw, s.qtrs, s.duration_kind, s.uom_raw, s.segments_raw, s.identifier_member_raw,
       s.value_raw, s.value_numeric, s.value_state, ${projId}, e.id, ${run}
FROM _row_src s JOIN _row_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, artifact_member_id, run_id)
  VALUES ('L1_STRUCTURED_DATASET'::ref.evidence_level, pg_temp.ctx('artifact'), 'DOCUMENT'::ref.locator_type,
          pg_temp.ctx('num_member'), ${run})
  RETURNING id)
INSERT INTO _ctx SELECT 'member_evidence', id FROM ins;

INSERT INTO _counts VALUES
  ('num_rows', ${num(n)}),
  ('num_field_count_mismatch_rows', ${num(n)}),
  ('num_header_width', ${WIDTH}),
  ('source_table_load_id', ${src});
INSERT INTO _counts SELECT 'num_ok_rows', count(*) FROM _ok;
INSERT INTO _counts SELECT 'num_quoted_recovery_rows', count(*) FROM raw.tabular_row r
  WHERE r.table_load_id = pg_temp.ctx('load') AND r.parse_status = 'QUOTED_RECOVERY';
INSERT INTO _counts SELECT 'num_quoted_recovery_sidecars', count(*) FROM raw.num_quoted_recovery q
  JOIN raw.tabular_row r ON r.id = q.tabular_row_id WHERE r.table_load_id = pg_temp.ctx('load');
INSERT INTO _counts SELECT 'num_footlen_mismatch_rows', count(*) FROM _footlen;
INSERT INTO _counts SELECT 'num_orphan_adsh', count(*) FROM _orphan;
INSERT INTO _counts SELECT 'num_fact_observations', count(*) FROM obs.num_fact_observation o
  JOIN raw.tabular_row r ON r.id = o.tabular_row_id WHERE r.table_load_id = pg_temp.ctx('load');
INSERT INTO _counts SELECT 'num_with_identifier_member', count(*) FROM obs.num_fact_observation o
  JOIN raw.tabular_row r ON r.id = o.tabular_row_id
  WHERE r.table_load_id = pg_temp.ctx('load') AND o.identifier_member_raw IS NOT NULL;

SELECT pg_temp.fail('backfill row, sidecar, or FOOTLEN_MISMATCH counts differ from the locks')
WHERE (SELECT n FROM _counts WHERE k = 'num_quoted_recovery_rows') <> ${num(n)}
   OR (SELECT count(*) FROM raw.tabular_row r WHERE r.table_load_id = pg_temp.ctx('load')) <> ${num(n)}
   OR (SELECT n FROM _counts WHERE k = 'num_quoted_recovery_sidecars') <> ${num(n)}
   OR (SELECT n FROM _counts WHERE k = 'num_footlen_mismatch_rows') <> ${num(failCount)}
   OR (SELECT count(*) FROM ops.projection_exception e WHERE e.table_load_id = pg_temp.ctx('load') AND e.kind = 'FOOTLEN_MISMATCH') <> ${num(failCount)};
SELECT pg_temp.fail('backfill facts exceed the D6-pass lines or come from a D6-fail line')
WHERE (SELECT n FROM _counts WHERE k = 'num_fact_observations') > ${num(passCount)}
   OR EXISTS (
     SELECT 1 FROM obs.num_fact_observation o
     JOIN raw.tabular_row r ON r.id = o.tabular_row_id
     JOIN _lock l ON l.line_number = r.line_number
     WHERE r.table_load_id = pg_temp.ctx('load') AND NOT l.d6);
${finishBlock({ keys: ["artifact"], ruleId: ruleIds.backfill, runId, outcome: "LOADED", detail, actor: ACTOR })}`;
}

function finishRun(database, runId, totals) {
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(totals))}::jsonb);`);
}

export async function runNumQuotedRecoveryBackfill({
  database, pin = AUG_2026_NUM_BACKFILL_PIN, sourceTableLoadId, zipPath = null, log: logFn = console.log,
}) {
  validatePin(pin);
  if (!Number.isSafeInteger(sourceTableLoadId) || sourceTableLoadId < 1) {
    throw new BackfillHardStop("a pinned source table_load id is required");
  }
  const parameters = {
    artifact_sha256: pin.artifactSha256,
    source_table_load_id: sourceTableLoadId,
    locked_lines: pin.locks.length,
    zip_byte_check: zipPath != null,
  };
  const startRun = () => Number(queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES (${lit(BACKFILL_RUN_KIND)}, ${lit(pipelineCodeVersion())}, ${lit(pin.artifactSha256)}, ${lit(JSON.stringify(parameters))}::jsonb, now())
RETURNING id;`)[0][0]);

  // A skip applies no rule, so it records the run and outcome only.
  if (backfillAlreadyLoaded(database, pin)) {
    const runId = startRun();
    const totals = { units: 0, skipped: 1 };
    finishRun(database, runId, totals);
    logFn(`num:recover-quoted: run ${runId} ${JSON.stringify(totals)}`);
    return { runId, totals, ruleIds: null, skipped: true };
  }

  // Read-only checks. A hard stop here writes nothing, not even the run row.
  const source = readLockedSource(database, pin, sourceTableLoadId);
  const recovered = recoverLockedRows(pin, source.rows);
  if (zipPath != null) await verifyZipLines(pin, zipPath, recovered);

  const runId = startRun();
  const ruleIds = {
    backfill: ensureAndLinkRuleForRun(database, runId, BACKFILL_RULE).id,
    parser: ensureAndLinkRuleForRun(database, runId, PARSER_RULE).id,
    projection: ensureAndLinkRuleForRun(database, runId, PROJECTION_RULE).id,
  };

  let lines;
  try {
    lines = queryRows(database, backfillUnitSql({ pin, sourceTableLoadId, recovered, runId, ruleIds }));
  } catch (error) {
    if (!String(error?.message ?? "").includes(ALREADY_LOADED_MARKER)) throw error;
    const totals = { units: 0, skipped: 1, skipped_in_transaction: 1 };
    finishRun(database, runId, totals);
    logFn(`num:recover-quoted: run ${runId} ${JSON.stringify(totals)}`);
    return { runId, totals, ruleIds, skipped: true };
  }
  const totals = { units: 1, skipped: 0, ...parseCounts(lines) };
  finishRun(database, runId, totals);
  logFn(`num:recover-quoted: run ${runId} ${JSON.stringify(totals)}`);
  return { runId, totals, ruleIds, skipped: false };
}
