// Load unit for datasets/num.tsv of a BDC data set ZIP already processed by registry:load.
// Identity is location (table_load + line_number). Filing linkage is the adsh cell only.
// Identifier members are parsed from segments by the projection rule version.
// The member is streamed line by line; COPY uses one long-lived session per ZIP.

import { createReadStream, createWriteStream, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { finished } from "node:stream/promises";
import { createInterface } from "node:readline";
import { NUM_MEMBER_PATH, VERIFIED_NUM_HEADER } from "../../lib/num-schema.mjs";
import { copyBlock, formatCopyRow, lit, num, openPipelineSession, queryRows } from "../../lib/db.mjs";
import { parseIdentifierMemberFromSegments } from "../../normalize/num-segments.mjs";
import { recoverQuotedNumCells } from "../../parse/num-quoted-tsv.mjs";
import { EMPTY_BUFFER_SHA256, parseNumTsv, streamNumTsv } from "../../parse/num.mjs";
import { listMembers, readMember, streamMemberChunks } from "../../parse/zip.mjs";
import { LOCATION_COLUMNS, artifactBlock, finishBlock, prelude } from "../sql.mjs";

const pos = (label) => VERIFIED_NUM_HEADER.indexOf(label) + 1;
const ADSH = pos("adsh");
const TAG = pos("tag");
const VERSION = pos("version");
const DDATE = pos("ddate");
const QTRS = pos("qtrs");
const UOM = pos("uom");
const SEGMENTS = pos("segments");
const VALUE = pos("value");
const WIDTH = VERIFIED_NUM_HEADER.length;

function tableLoadSql({ header, headerSha256, rowCount, mismatches, status, ruleId, runId }) {
  const headerSql = header.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[${header.map(lit).join(", ")}]::text[]`;
  return `
WITH ins AS (
  INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
    VALUES (pg_temp.ctx('artifact'), pg_temp.ctx('num_member'), 'NUM', E'\\t', ${headerSql},
          ${lit(headerSha256)}, ${num(ruleId)}, ${num(rowCount)}, ${num(mismatches)}, ${lit(status)}::ref.parse_status, ${num(runId)})
  RETURNING id)
INSERT INTO _ctx SELECT 'load', id FROM ins;
`;
}

function finish(rules, runId, outcome, detail) {
  return finishBlock({
    keys: ["artifact"], ruleId: rules["pipeline.num_load"], runId, outcome, detail,
    actor: "pipeline num:load",
  });
}

function memberEvidenceSql(runId) {
  return `
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, artifact_member_id, run_id)
  VALUES ('L1_STRUCTURED_DATASET'::ref.evidence_level, pg_temp.ctx('artifact'), 'DOCUMENT'::ref.locator_type,
          pg_temp.ctx('num_member'), ${num(runId)})
  RETURNING id)
INSERT INTO _ctx SELECT 'member_evidence', id FROM ins;
`;
}

function createTsvSql() {
  return `CREATE TEMP TABLE _tsv (line_number bigint, raw_line text) ON COMMIT DROP;`;
}

function createIdentSql() {
  return `CREATE TEMP TABLE _ident (line_number bigint PRIMARY KEY, identifier_member text) ON COMMIT DROP;`;
}

function createQuotedSql() {
  return `CREATE TEMP TABLE _quoted (line_number bigint PRIMARY KEY, recovered_cells jsonb) ON COMMIT DROP;`;
}

function quotedRecoveryRows(rows) {
  const out = [];
  for (const row of rows) {
    const naive = row.raw.split("\t");
    if (naive.length === WIDTH) continue;
    const recovered = recoverQuotedNumCells(row.raw, WIDTH);
    if (!recovered) continue;
    out.push([row.lineNumber, JSON.stringify(recovered.cells)]);
  }
  return out;
}

function identifierMemberFromRaw(raw) {
  const naive = raw.split("\t");
  const cells = naive.length === WIDTH
    ? naive
    : recoverQuotedNumCells(raw, WIDTH)?.cells;
  if (!cells) return null;
  return parseIdentifierMemberFromSegments(cells[SEGMENTS - 1]) ?? "";
}

function afterTsvSql({ width, parserId, projId, runId, header, headerSha256, rowCount, mismatches }) {
  return `
${tableLoadSql({ header, headerSha256, rowCount, mismatches, status: "OK", ruleId: parserId, runId })}
INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
SELECT pg_temp.ctx('load'), t.line_number, t.raw_line, encode(sha256(convert_to(t.raw_line, 'UTF8')), 'hex'),
       string_to_array(t.raw_line, E'\\t'), cardinality(string_to_array(t.raw_line, E'\\t')),
       (CASE
          WHEN cardinality(string_to_array(t.raw_line, E'\\t')) = ${width} THEN 'OK'
          WHEN EXISTS (SELECT 1 FROM _quoted q WHERE q.line_number = t.line_number) THEN 'QUOTED_RECOVERY'
          ELSE 'FIELD_COUNT_MISMATCH'
        END)::ref.parse_status,
       ${num(runId)}
FROM _tsv t ORDER BY t.line_number;

INSERT INTO raw.num_quoted_recovery (tabular_row_id, recovered_cells, recovered_field_count, parser_rule_version_id, run_id)
SELECT r.id,
       ARRAY(SELECT e FROM jsonb_array_elements_text(q.recovered_cells) WITH ORDINALITY AS t(e, ord) ORDER BY ord),
       jsonb_array_length(q.recovered_cells),
       ${num(parserId)}, ${num(runId)}
FROM raw.tabular_row r
JOIN _quoted q ON q.line_number = r.line_number
WHERE r.table_load_id = pg_temp.ctx('load')
ORDER BY r.line_number;

CREATE TEMP TABLE _mismatch (${LOCATION_COLUMNS}) ON COMMIT DROP;
INSERT INTO _mismatch
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.id, NULL, NULL, NULL, r.line_number
FROM raw.tabular_row r WHERE r.table_load_id = pg_temp.ctx('load') AND r.parse_status = 'FIELD_COUNT_MISMATCH'
ORDER BY r.line_number;
CREATE TEMP TABLE _mismatch_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _mismatch s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _mismatch_ev SELECT * FROM ins;
INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
SELECT pg_temp.ctx('load'), s.tabular_row_id, 'FIELD_COUNT_MISMATCH',
       'NUM line field count does not equal the header width; row kept, not projected (SOURCE_SCHEMAS 4.8)',
       e.id, ${num(projId)}, ${num(runId)}
FROM _mismatch s JOIN _mismatch_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

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
CREATE TEMP TABLE _footlen_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _footlen s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _footlen_ev SELECT * FROM ins;
INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
SELECT pg_temp.ctx('load'), s.tabular_row_id, 'FOOTLEN_MISMATCH',
       'NUM quoted-recovery footnote length does not equal footlen; recovery kept, not projected (SOURCE_SCHEMAS 4.8)',
       e.id, ${num(projId)}, ${num(runId)}
FROM _footlen s JOIN _footlen_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

CREATE TEMP TABLE _ok ON COMMIT DROP AS
SELECT r.id AS tabular_row_id, r.line_number,
       CASE WHEN r.parse_status = 'OK' THEN r.cells ELSE q.recovered_cells END AS cells
FROM raw.tabular_row r
JOIN raw.table_load tl ON tl.id = r.table_load_id
LEFT JOIN raw.num_quoted_recovery q ON q.tabular_row_id = r.id
WHERE r.table_load_id = pg_temp.ctx('load')
  AND (
    r.parse_status = 'OK'
    OR (r.parse_status = 'QUOTED_RECOVERY' AND raw.num_quoted_footlen_ok(q.recovered_cells, tl.header))
  );
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
`;
}

function afterIdentSql({ width, projId, runId, rowCount, mismatches, carriageReturns, releaseLabel, rules }) {
  return `
CREATE TEMP TABLE _orphan (${LOCATION_COLUMNS}) ON COMMIT DROP;
INSERT INTO _orphan
SELECT pg_temp.ctx('artifact'), 'L1_STRUCTURED_DATASET'::ref.evidence_level, r.tabular_row_id, NULL, NULL, NULL, r.line_number
FROM _ok r
WHERE NOT EXISTS (SELECT 1 FROM registry.filing f WHERE f.accession_number = r.cells[${ADSH}])
ORDER BY r.line_number;
CREATE TEMP TABLE _orphan_ev (id bigint, artifact_id bigint, tabular_row_id bigint, column_position integer, json_path text) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, column_position, column_label, json_path, run_id)
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _orphan s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _orphan_ev SELECT * FROM ins;
INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
SELECT pg_temp.ctx('load'), s.tabular_row_id, 'ORPHAN_ADSH',
       'NUM adsh cell has no registry.filing row; raw line kept, observation not created; accession prefix was not used',
       e.id, ${num(projId)}, ${num(runId)}
FROM _orphan s JOIN _orphan_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

CREATE TEMP TABLE _matched ON COMMIT DROP AS
SELECT r.*, f.id AS filing_id, nullif(i.identifier_member, '') AS identifier_member
FROM _ok r
JOIN registry.filing f ON f.accession_number = r.cells[${ADSH}]
JOIN _ident i ON i.line_number = r.line_number
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
  SELECT s.evidence_level, s.artifact_id, 'TSV_ROW'::ref.locator_type, s.tabular_row_id, s.column_position, s.column_label, s.json_path, ${num(runId)}
  FROM _row_src s ORDER BY s.ord
  RETURNING id, artifact_id, tabular_row_id, column_position, json_path)
INSERT INTO _row_ev SELECT * FROM ins;

INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw, reported_date,
    qtrs_raw, qtrs, duration_kind, uom_raw, segments_raw, identifier_member_raw, value_raw, value_numeric,
    value_state, rule_version_id, evidence_id, run_id)
SELECT s.tabular_row_id, s.filing_id, s.tag, s.tag_version, s.reported_date_raw, s.reported_date,
       s.qtrs_raw, s.qtrs, s.duration_kind, s.uom_raw, s.segments_raw, s.identifier_member_raw,
       s.value_raw, s.value_numeric, s.value_state, ${num(projId)}, e.id, ${num(runId)}
FROM _row_src s JOIN _row_ev e ON e.tabular_row_id = s.tabular_row_id
ORDER BY s.ord;

${memberEvidenceSql(runId)}
INSERT INTO _counts VALUES
  ('num_rows', ${rowCount}),
  ('num_field_count_mismatch_rows', ${mismatches}),
  ('num_rows_with_carriage_return', ${carriageReturns}),
  ('num_header_width', ${width});
INSERT INTO _counts SELECT 'num_ok_rows', count(*) FROM _ok;
INSERT INTO _counts SELECT 'num_quoted_recovery_rows', count(*) FROM raw.tabular_row r
  WHERE r.table_load_id = pg_temp.ctx('load') AND r.parse_status = 'QUOTED_RECOVERY';
INSERT INTO _counts SELECT 'num_footlen_mismatch_rows', count(*) FROM _footlen;
INSERT INTO _counts SELECT 'num_orphan_adsh', count(*) FROM _orphan;
INSERT INTO _counts SELECT 'num_fact_observations', count(*) FROM obs.num_fact_observation o
  JOIN raw.tabular_row r ON r.id = o.tabular_row_id WHERE r.table_load_id = pg_temp.ctx('load');
INSERT INTO _counts SELECT 'num_with_identifier_member', count(*) FROM obs.num_fact_observation o
  JOIN raw.tabular_row r ON r.id = o.tabular_row_id
  WHERE r.table_load_id = pg_temp.ctx('load') AND o.identifier_member_raw IS NOT NULL;
${finish(rules, runId, "LOADED", `Release ${releaseLabel}: NUM loaded`)}`;
}

function unitPrelude(entry, runId, releaseId) {
  return `${prelude()}
${artifactBlock("artifact", entry, runId)}
INSERT INTO _ctx VALUES ('release', ${num(releaseId)});
INSERT INTO _ctx SELECT 'num_member', id FROM raw.artifact_member
 WHERE artifact_id = pg_temp.ctx('artifact') AND member_path = ${lit(NUM_MEMBER_PATH)};
`;
}

export function registryZipStatus(database, entry, registryLoadRuleId) {
  const rows = queryRows(database, `SELECT a.id::text,
       CASE WHEN EXISTS (
         SELECT 1
         FROM ops.artifact_processing p
         JOIN ops.rule_version rv ON rv.id = p.rule_version_id
         JOIN ops.rule_version cur ON cur.id = ${num(registryLoadRuleId)}
         WHERE p.artifact_id = a.id
           AND rv.rule_code = cur.rule_code
           AND p.outcome = 'LOADED'
       ) THEN 'LOADED' ELSE '' END
FROM raw.artifact a
WHERE a.source_url = ${lit(entry.url)} AND a.sha256 = ${lit(entry.sha256)}
LIMIT 1;`);
  if (!rows.length) return { artifactId: null, outcome: null };
  return { artifactId: Number(rows[0][0]), outcome: rows[0][1] || null };
}

function scopeHead(entry, runId) {
  return `${prelude()}
${artifactBlock("artifact", entry, runId)}
`;
}

function identifierRowsFromParsed(rows) {
  const identifierByLine = new Map();
  for (const row of rows) {
    const member = identifierMemberFromRaw(row.raw);
    if (member == null) continue;
    identifierByLine.set(row.lineNumber, member);
  }
  return [...identifierByLine.entries()].map(([lineNumber, member]) => [lineNumber, member]);
}

export function bufferedNumLoadSql({
  entry, runId, rules, releaseId, releaseLabel, parsed,
}) {
  const parserId = rules["parser.sec_num_tsv"];
  const projId = rules["obs.projection.num"];
  const head = unitPrelude(entry, runId, releaseId);
  const mismatches = parsed.rows.filter((r) => r.raw.split("\t").length !== WIDTH).length;
  return `${head}
${createTsvSql()}
${copyBlock("_tsv", ["line_number", "raw_line"], parsed.rows.map((r) => [r.lineNumber, r.raw]))}
${createQuotedSql()}
${copyBlock("_quoted", ["line_number", "recovered_cells"], quotedRecoveryRows(parsed.rows))}
${afterTsvSql({
    width: WIDTH, parserId, projId, runId,
    header: parsed.header, headerSha256: parsed.headerSha256,
    rowCount: parsed.rows.length, mismatches,
  })}
${createIdentSql()}
${copyBlock("_ident", ["line_number", "identifier_member"], identifierRowsFromParsed(parsed.rows))}
${afterIdentSql({
    width: WIDTH, projId, runId, rowCount: parsed.rows.length, mismatches,
    carriageReturns: parsed.carriageReturns, releaseLabel, rules,
  })}`;
}

function sessionLines(body) {
  return String(body ?? "").split("\n").filter((line) => line !== "").map((line) => line.split("\t"));
}

async function drain(iterator) {
  for await (const _event of iterator) {
    // Consume remaining unzip output so a non-zero SIGPIPE is not mistaken for success.
  }
}

async function writeIdentLine(stream, lineNumber, member) {
  const line = `${formatCopyRow([lineNumber, member])}\n`;
  if (stream.write(line)) return;
  await new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.once("drain", () => {
      stream.removeListener("error", reject);
      resolve();
    });
  });
}

async function applyNumStream({
  database, entry, runId, rules, releaseId, releaseLabel, headerEvent, rest,
}) {
  const parserId = rules["parser.sec_num_tsv"];
  const projId = rules["obs.projection.num"];
  const identPath = path.join(tmpdir(), `bdc-num-ident-${process.pid}-${randomBytes(8).toString("hex")}`);
  const quotedPath = path.join(tmpdir(), `bdc-num-quoted-${process.pid}-${randomBytes(8).toString("hex")}`);
  const session = await openPipelineSession(database);
  let identOut;
  let quotedOut;
  let rowCount = 0;
  let mismatches = 0;
  let carriageReturns = 0;
  try {
    identOut = createWriteStream(identPath);
    quotedOut = createWriteStream(quotedPath);
    await session.query(unitPrelude(entry, runId, releaseId));
    await session.query(createTsvSql());
    await session.copyFrom("_tsv", ["line_number", "raw_line"], (async function* () {
      for await (const event of rest) {
        if (event.kind !== "row") continue;
        rowCount += 1;
        if (event.raw.includes("\r")) carriageReturns += 1;
        const cells = event.raw.split("\t");
        if (cells.length !== WIDTH) {
          mismatches += 1;
          const recovered = recoverQuotedNumCells(event.raw, WIDTH);
          if (recovered) {
            await writeIdentLine(identOut, event.lineNumber,
              parseIdentifierMemberFromSegments(recovered.cells[SEGMENTS - 1]) ?? "");
            await writeIdentLine(quotedOut, event.lineNumber, JSON.stringify(recovered.cells));
          }
        } else {
          await writeIdentLine(identOut, event.lineNumber,
            parseIdentifierMemberFromSegments(cells[SEGMENTS - 1]) ?? "");
        }
        yield [event.lineNumber, event.raw];
      }
    })());
    identOut.end();
    quotedOut.end();
    await finished(identOut);
    await finished(quotedOut);
    await session.query(createQuotedSql());
    await session.copyFrom("_quoted", ["line_number", "recovered_cells"], (async function* () {
      const lines = createInterface({ input: createReadStream(quotedPath), crlfDelay: Infinity });
      for await (const line of lines) {
        if (line !== "") yield line;
      }
    })());
    await session.query(afterTsvSql({
      width: WIDTH, parserId, projId, runId,
      header: headerEvent.header, headerSha256: headerEvent.headerSha256,
      rowCount, mismatches,
    }));
    await session.query(createIdentSql());
    await session.copyFrom("_ident", ["line_number", "identifier_member"], (async function* () {
      const lines = createInterface({ input: createReadStream(identPath), crlfDelay: Infinity });
      for await (const line of lines) {
        if (line !== "") yield line;
      }
    })());
    const body = await session.query(afterIdentSql({
      width: WIDTH, projId, runId, rowCount, mismatches, carriageReturns, releaseLabel, rules,
    }));
    return sessionLines(body);
  } finally {
    identOut?.destroy();
    quotedOut?.destroy();
    await session.close().catch(() => undefined);
    rmSync(identPath, { force: true });
    rmSync(quotedPath, { force: true });
  }
}

export async function datasetNumUnit({ database, entry, zipPath, runId, rules }) {
  const release = queryRows(database, `SELECT r.id, r.release_label
FROM registry.dataset_release r
JOIN registry.dataset_release_artifact x ON x.dataset_release_id = r.id
JOIN raw.artifact a ON a.id = x.artifact_id
WHERE a.source_url = ${lit(entry.url)} AND a.sha256 = ${lit(entry.sha256)}
ORDER BY r.id DESC LIMIT 1;`)[0];
  const head = scopeHead(entry, runId);
  if (!release) {
    return { sql: `${head}${finish(rules, runId, "NOT_IN_SCOPE", "ZIP is not attached to a loaded data-set release")}` };
  }
  const [releaseId, releaseLabel] = [Number(release[0]), release[1]];
  const names = listMembers(zipPath);
  const memberCtx = `
INSERT INTO _ctx VALUES ('release', ${num(releaseId)});
INSERT INTO _ctx SELECT 'num_member', id FROM raw.artifact_member
 WHERE artifact_id = pg_temp.ctx('artifact') AND member_path = ${lit(NUM_MEMBER_PATH)};
`;

  if (!names.includes(NUM_MEMBER_PATH)) {
    const sql = `${head}
INSERT INTO _ctx VALUES ('release', ${num(releaseId)});
INSERT INTO _counts VALUES ('num_member_missing', 1);
${finish(rules, runId, "NOT_IN_SCOPE", `Release ${releaseLabel}: ${NUM_MEMBER_PATH} is missing from the archive`)}`;
    return { sql };
  }

  const parserId = rules["parser.sec_num_tsv"];
  const events = streamNumTsv(streamMemberChunks(zipPath, NUM_MEMBER_PATH));
  const first = await events.next();
  if (first.done || first.value.kind === "empty") {
    const sql = `${head}${memberCtx}
${tableLoadSql({ header: [], headerSha256: first.value?.headerSha256 ?? EMPTY_BUFFER_SHA256, rowCount: 0, mismatches: 0, status: "OK", ruleId: parserId, runId })}
${memberEvidenceSql(runId)}
INSERT INTO _counts VALUES ('num_empty_member', 1), ('num_rows', 0);
${finish(rules, runId, "LOADED", `Release ${releaseLabel}: NUM empty member`)}`;
    return { sql };
  }
  if (first.value.kind !== "header") throw new Error("NUM stream did not start with a header");
  if (!first.value.headerMatches) {
    await drain(events);
    const sql = `${head}${memberCtx}
${tableLoadSql({ header: first.value.header, headerSha256: first.value.headerSha256, rowCount: 0, mismatches: 0, status: "SCHEMA_DRIFT", ruleId: parserId, runId })}
${memberEvidenceSql(runId)}
${finish(rules, runId, "SCHEMA_DRIFT", `Release ${releaseLabel}: NUM header differs from the verified layout (SOURCE_SCHEMAS 4.3); not loaded`)}`;
    return { sql, stop: `Release ${releaseLabel}: NUM header differs from the verified layout` };
  }

  const lines = await applyNumStream({
    database, entry, runId, rules, releaseId, releaseLabel,
    headerEvent: first.value, rest: events,
  });
  return { lines };
}

// Buffered reference path used only to prove stream/legacy equivalence. It still
// reads the whole member; production num:load uses datasetNumUnit.
export async function datasetNumUnitLegacy({ database, entry, zipPath, runId, rules }) {
  const release = queryRows(database, `SELECT r.id, r.release_label
FROM registry.dataset_release r
JOIN registry.dataset_release_artifact x ON x.dataset_release_id = r.id
JOIN raw.artifact a ON a.id = x.artifact_id
WHERE a.source_url = ${lit(entry.url)} AND a.sha256 = ${lit(entry.sha256)}
ORDER BY r.id DESC LIMIT 1;`)[0];
  const head = scopeHead(entry, runId);
  if (!release) {
    return { sql: `${head}${finish(rules, runId, "NOT_IN_SCOPE", "ZIP is not attached to a loaded data-set release")}` };
  }
  const [releaseId, releaseLabel] = [Number(release[0]), release[1]];
  const names = listMembers(zipPath);
  const memberCtx = `
INSERT INTO _ctx VALUES ('release', ${num(releaseId)});
INSERT INTO _ctx SELECT 'num_member', id FROM raw.artifact_member
 WHERE artifact_id = pg_temp.ctx('artifact') AND member_path = ${lit(NUM_MEMBER_PATH)};
`;
  if (!names.includes(NUM_MEMBER_PATH)) {
    const sql = `${head}
INSERT INTO _ctx VALUES ('release', ${num(releaseId)});
INSERT INTO _counts VALUES ('num_member_missing', 1);
${finish(rules, runId, "NOT_IN_SCOPE", `Release ${releaseLabel}: ${NUM_MEMBER_PATH} is missing from the archive`)}`;
    return { sql };
  }

  const parsed = parseNumTsv(readMember(zipPath, NUM_MEMBER_PATH));
  const parserId = rules["parser.sec_num_tsv"];
  if (parsed.emptyFile) {
    const sql = `${head}${memberCtx}
${tableLoadSql({ header: [], headerSha256: parsed.headerSha256, rowCount: 0, mismatches: 0, status: "OK", ruleId: parserId, runId })}
${memberEvidenceSql(runId)}
INSERT INTO _counts VALUES ('num_empty_member', 1), ('num_rows', 0);
${finish(rules, runId, "LOADED", `Release ${releaseLabel}: NUM empty member`)}`;
    return { sql };
  }
  if (!parsed.headerMatches) {
    const sql = `${head}${memberCtx}
${tableLoadSql({ header: parsed.header, headerSha256: parsed.headerSha256, rowCount: 0, mismatches: 0, status: "SCHEMA_DRIFT", ruleId: parserId, runId })}
${memberEvidenceSql(runId)}
${finish(rules, runId, "SCHEMA_DRIFT", `Release ${releaseLabel}: NUM header differs from the verified layout (SOURCE_SCHEMAS 4.3); not loaded`)}`;
    return { sql, stop: `Release ${releaseLabel}: NUM header differs from the verified layout` };
  }
  return {
    sql: bufferedNumLoadSql({ entry, runId, rules, releaseId, releaseLabel, parsed }),
  };
}
