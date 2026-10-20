// Synthetic ADR 0021 backfill tests. All values are TEST ONLY fixtures.
// The pre-recovery source load is seeded directly in the shape the pre-0066 num:load wrote:
// quoted extra-tab lines are FIELD_COUNT_MISMATCH rows with exceptions; OK lines have facts.

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { lit, num, queryRows } from "../lib/db.mjs";
import { readFetchLog } from "../lib/fetch-log.mjs";
import { VERIFIED_NUM_HEADER } from "../lib/num-schema.mjs";
import { createStore } from "../lib/store.mjs";
import {
  ALREADY_LOADED_MARKER, BACKFILL_RULE, BackfillHardStop, backfillUnitSql, readLockedSource, recoverLockedRows,
  runNumQuotedRecoveryBackfill,
} from "../load/num-quoted-recovery-backfill.mjs";
import { runNumLoad } from "../load/num-run.mjs";
import { registerRules } from "../load/rules.mjs";
import { alreadyProcessed, runLoad } from "../load/run.mjs";
import {
  FAKE, defaultSources, defaultSubRows, numFactRow, numLine, numTsv, soiTsv, defaultSoiRows, subTsv,
  writeSyntheticTree,
} from "./synthetic.mjs";
import { buildStoredZip } from "./zip-store.mjs";
import { assertIntegrationPipelineIsLocal } from "./local-pipeline-db.mjs";

const DB = `bdc_num_backfill_${process.pid}`;
const STANDARD_DB = `bdc_num_backfill_std_${process.pid}`;
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function quotedRaw({ adsh = FAKE.acc, tag = "InvestmentOwnedAtCost", value = "100", identifier = FAKE.ident, footnote = "", footlen = "0" }) {
  const row = numFactRow({ adsh, tag: tag || "TEST", value, identifier, footnote, footlen });
  return [row.adsh, tag, row.version, row.ddate, row.qtrs, row.uom,
    `"${row.segments}\t"`, row.dimn, row.value, row.footnote, row.footlen].join("\t");
}

const OK_A = numLine(numFactRow({ tag: "InvestmentOwnedBalancePrincipalAmount", value: "100" }));
const OK_B = numLine(numFactRow({ tag: "InvestmentOwnedAtFairValue", value: "80" }));
const Q_PASS = quotedRaw({ identifier: `${FAKE.ident}\t` });
const Q_FAIL = quotedRaw({ value: "90", footlen: "4" });
const Q_ORPHAN = quotedRaw({ adsh: FAKE.accOrphan, value: "7" });
const STANDARD_LINES = [OK_A, OK_B, Q_PASS, Q_FAIL, Q_ORPHAN];

function treeWith(lines) {
  const sources = defaultSources();
  sources.zipFilled = buildStoredZip({
    "datasets/sub.tsv": subTsv(defaultSubRows()),
    "datasets/num.tsv": numTsv(lines),
    "soi.tsv": soiTsv(defaultSoiRows()),
    "readme.htm": "<html>TEST ONLY</html>",
  });
  return sources;
}

function zipEntry(dataDir, release = "2099_12") {
  return readFetchLog(dataDir).entries.find((e) => e.source_type === "SEC_BDC_DATASET_ZIP" && e.context?.release_label === release);
}

function pinFor(entry, lines, { passLines, failLines }) {
  const locks = lines.map((raw, i) => ({ line: i + 2, raw })).filter(({ raw }) => raw.split("\t").length !== VERIFIED_NUM_HEADER.length);
  return {
    label: "TEST ONLY",
    artifactSha256: entry.sha256,
    sourceTypeCode: "SEC_BDC_DATASET_ZIP",
    sourceRowCount: lines.length,
    sourceMismatchCount: locks.length,
    locks: locks.map(({ line, raw }) => ({ line, sha: sha(raw) })),
    d6PassLines: passLines,
    d6FailLines: failLines,
  };
}

// The pre-0066 num:load output for one ZIP: one NUM load, extra-tab lines as
// FIELD_COUNT_MISMATCH with exceptions, OK lines projected, pipeline.num_load LOADED.
function seedPreRecoveryLoad(database, entry, lines, { sourceParser = "prior" } = {}) {
  const runId = Number(queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('NUM_LOAD', 'test-only', '{}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(database, runId);
  // Run 72 wrote the source load with an earlier parser version; the backfill uses v3.
  const priorParserId = Number(queryRows(database, `INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES ('parser.sec_num_tsv', 'PARSER', '2', ${lit("e".repeat(64))}, 'TEST ONLY', 'TEST ONLY stored prior parser version', 'test')
RETURNING id;`)[0][0]);
  const sourceParserId = sourceParser === "prior" ? priorParserId : rules["parser.sec_num_tsv"];
  const values = lines.map((raw, i) => `(${i + 2}, ${lit(raw)})`).join(",\n  ");
  const header = `ARRAY[${VERIFIED_NUM_HEADER.map(lit).join(", ")}]::text[]`;
  const mismatches = lines.filter((raw) => raw.split("\t").length !== VERIFIED_NUM_HEADER.length).length;
  queryRows(database, `
BEGIN;
CREATE TEMP TABLE _src (line_number bigint, raw_line text) ON COMMIT DROP;
INSERT INTO _src VALUES
  ${values};
DO $seed$
DECLARE
  art bigint;
  member bigint;
  load bigint;
  r record;
  ev bigint;
  fil bigint;
BEGIN
  SELECT id INTO art FROM raw.artifact WHERE source_url = ${lit(entry.url)} AND sha256 = ${lit(entry.sha256)};
  SELECT id INTO member FROM raw.artifact_member WHERE artifact_id = art AND member_path = 'datasets/num.tsv';
  INSERT INTO raw.table_load (artifact_id, artifact_member_id, table_code, delimiter, header, header_sha256,
      parser_rule_version_id, row_count, field_count_mismatch_count, parse_status, run_id)
  VALUES (art, member, 'NUM', E'\\t', ${header}, ${lit(sha(VERIFIED_NUM_HEADER.join("\t")))},
          ${num(sourceParserId)}, ${num(lines.length)}, ${num(mismatches)}, 'OK', ${num(runId)})
  RETURNING id INTO load;
  INSERT INTO raw.tabular_row (table_load_id, line_number, raw_line, raw_line_sha256, cells, field_count, parse_status, run_id)
  SELECT load, s.line_number, s.raw_line, encode(sha256(convert_to(s.raw_line, 'UTF8')), 'hex'),
         string_to_array(s.raw_line, E'\\t'), cardinality(string_to_array(s.raw_line, E'\\t')),
         (CASE WHEN cardinality(string_to_array(s.raw_line, E'\\t')) = 11 THEN 'OK' ELSE 'FIELD_COUNT_MISMATCH' END)::ref.parse_status,
         ${num(runId)}
  FROM _src s ORDER BY s.line_number;
  FOR r IN SELECT * FROM raw.tabular_row WHERE table_load_id = load ORDER BY line_number LOOP
    INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id, run_id)
    VALUES ('L1_STRUCTURED_DATASET', art, 'TSV_ROW', r.id, ${num(runId)}) RETURNING id INTO ev;
    IF r.parse_status = 'FIELD_COUNT_MISMATCH' THEN
      INSERT INTO ops.projection_exception (table_load_id, tabular_row_id, kind, detail, evidence_id, rule_version_id, run_id)
      VALUES (load, r.id, 'FIELD_COUNT_MISMATCH', 'TEST ONLY pre-recovery seed', ev, ${num(rules["obs.projection.num"])}, ${num(runId)});
    ELSE
      SELECT id INTO fil FROM registry.filing WHERE accession_number = r.cells[1];
      IF fil IS NOT NULL THEN
        INSERT INTO obs.num_fact_observation (tabular_row_id, filing_id, tag, tag_version, reported_date_raw, reported_date,
            qtrs_raw, qtrs, duration_kind, uom_raw, segments_raw, identifier_member_raw, value_raw, value_numeric,
            value_state, rule_version_id, evidence_id, run_id)
        VALUES (r.id, fil, r.cells[2], r.cells[3], r.cells[4], to_date(r.cells[4], 'YYYYMMDD'), r.cells[5], r.cells[5]::integer,
                'POINT_IN_TIME', r.cells[6], nullif(r.cells[7], ''), NULL, r.cells[9], r.cells[9]::numeric,
                'REPORTED', ${num(rules["obs.projection.num"])}, ev, ${num(runId)});
      END IF;
    END IF;
  END LOOP;
  INSERT INTO ops.artifact_processing (artifact_id, rule_version_id, outcome, detail, counts, run_id)
  VALUES (art, ${num(rules["pipeline.num_load"])}, 'LOADED', 'TEST ONLY pre-recovery seed', '{}'::jsonb, ${num(runId)});
END
$seed$;
COMMIT;`);
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts) VALUES (${num(runId)}, 'SUCCEEDED', now(), '{}'::jsonb);`);
  const loadId = Number(query(database, "SELECT id FROM raw.table_load WHERE table_code = 'NUM' ORDER BY id")[0]);
  return { loadId, rules };
}

function sourceSnapshot(database, loadId) {
  return {
    load: query(database, `SELECT row_to_json(t)::text FROM raw.table_load t WHERE id = ${loadId}`),
    rows: query(database, `SELECT row_to_json(r)::text FROM raw.tabular_row r WHERE table_load_id = ${loadId} ORDER BY id`),
    exceptions: query(database, `SELECT row_to_json(e)::text FROM ops.projection_exception e WHERE table_load_id = ${loadId} ORDER BY id`),
    facts: query(database, `SELECT row_to_json(n)::text FROM obs.num_fact_observation n
JOIN raw.tabular_row r ON r.id = n.tabular_row_id WHERE r.table_load_id = ${loadId} ORDER BY n.id`),
    numLoadProcessing: query(database, `SELECT row_to_json(p)::text FROM ops.artifact_processing p
JOIN ops.rule_version rv ON rv.id = p.rule_version_id WHERE rv.rule_code = 'pipeline.num_load' ORDER BY p.id`),
  };
}

function backfillCounts(database) {
  const one = (sql) => query(database, sql).join();
  return {
    numLoads: one("SELECT count(*) FROM raw.table_load WHERE table_code = 'NUM'"),
    quoted: one("SELECT count(*) FROM raw.tabular_row WHERE parse_status = 'QUOTED_RECOVERY'"),
    sidecars: one("SELECT count(*) FROM raw.num_quoted_recovery"),
    footlen: one("SELECT count(*) FROM ops.projection_exception WHERE kind = 'FOOTLEN_MISMATCH'"),
    orphan: one("SELECT count(*) FROM ops.projection_exception WHERE kind = 'ORPHAN_ADSH'"),
    facts: one("SELECT count(*) FROM obs.num_fact_observation"),
    loaded: one(`SELECT count(*) FROM ops.artifact_processing p JOIN ops.rule_version rv ON rv.id = p.rule_version_id
WHERE rv.rule_code = ${lit(BACKFILL_RULE.code)} AND p.outcome = 'LOADED'`),
  };
}

// Per-line projection outputs of QUOTED_RECOVERY rows, comparable across databases.
function quotedOutputs(database) {
  return {
    sidecars: query(database, `SELECT r.line_number, array_to_json(q.recovered_cells)::text, q.recovered_field_count
FROM raw.num_quoted_recovery q JOIN raw.tabular_row r ON r.id = q.tabular_row_id ORDER BY r.line_number`),
    exceptions: query(database, `SELECT r.line_number, e.kind, e.detail FROM ops.projection_exception e
JOIN raw.tabular_row r ON r.id = e.tabular_row_id WHERE r.parse_status = 'QUOTED_RECOVERY' ORDER BY r.line_number, e.kind`),
    facts: query(database, `SELECT r.line_number, f.accession_number, n.tag, n.tag_version, n.reported_date_raw, n.reported_date,
       n.qtrs_raw, n.qtrs, n.duration_kind, n.uom_raw, coalesce(n.segments_raw, '<null>'), coalesce(n.identifier_member_raw, '<null>'),
       n.value_raw, coalesce(n.value_numeric::text, '<null>'), n.value_state, rv.rule_code, rv.version
FROM obs.num_fact_observation n
JOIN raw.tabular_row r ON r.id = n.tabular_row_id
JOIN registry.filing f ON f.id = n.filing_id
JOIN ops.rule_version rv ON rv.id = n.rule_version_id
WHERE r.parse_status = 'QUOTED_RECOVERY' ORDER BY r.line_number`),
  };
}

function withDbs(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline integration tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    assertIntegrationPipelineIsLocal();
    const previousPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-num-backfill-"));
    try {
      for (const db of [DB, STANDARD_DB]) {
        dropDatabase(db);
        createDatabase(db);
        migrate(db);
      }
      await fn(dataDir);
    } finally {
      try { dropDatabase(DB); } catch { /* keep going */ }
      try { dropDatabase(STANDARD_DB); } catch { /* keep going */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
      if (previousPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = previousPipelineUrl;
    }
  };
}

const silent = () => {};

test("backfill applies once, preserves source rows, and matches the standard projection", withDbs(async (dataDir) => {
  const { store } = writeSyntheticTree(dataDir, treeWith(STANDARD_LINES));
  const entry = zipEntry(dataDir);
  await runLoad({ dataDir, database: DB, log: silent });
  assert.equal(query(DB, `SELECT count(*) FROM ops.rule_version WHERE rule_code = ${lit(BACKFILL_RULE.code)}`).join(), "0",
    "registerRules must not register the ensure-only backfill rule");
  const { loadId, rules } = seedPreRecoveryLoad(DB, entry, STANDARD_LINES);
  const pin = pinFor(entry, STANDARD_LINES, { passLines: [4, 6], failLines: [5] });
  const before = sourceSnapshot(DB, loadId);
  assert.deepEqual(backfillCounts(DB), {
    numLoads: "1", quoted: "0", sidecars: "0", footlen: "0", orphan: "0", facts: "2", loaded: "0",
  });

  const first = await runNumQuotedRecoveryBackfill({
    database: DB, pin, sourceTableLoadId: loadId, zipPath: store.pathFor(entry.storage_key), log: silent,
  });
  assert.equal(first.skipped, false);
  assert.equal(first.totals.num_quoted_recovery_rows, 3);
  assert.equal(first.totals.num_footlen_mismatch_rows, 1);
  assert.equal(first.totals.num_orphan_adsh, 1);
  assert.equal(first.totals.num_fact_observations, 1);
  const after = backfillCounts(DB);
  assert.deepEqual(after, { numLoads: "2", quoted: "3", sidecars: "3", footlen: "1", orphan: "1", facts: "3", loaded: "1" });
  assert.deepEqual(sourceSnapshot(DB, loadId), before);

  const newLoad = query(DB, `SELECT row_count, field_count_mismatch_count, parse_status, parser_rule_version_id = ${first.ruleIds.parser}
FROM raw.table_load WHERE table_code = 'NUM' AND id <> ${loadId}`);
  assert.deepEqual(newLoad, ["3\t3\tOK\tt"]);
  assert.equal(query(DB, `SELECT count(*) FROM raw.tabular_row WHERE table_load_id = ${loadId} AND parse_status = 'FIELD_COUNT_MISMATCH'`).join(), "3");
  assert.deepEqual(query(DB, `SELECT r.line_number, e.kind FROM ops.projection_exception e
JOIN raw.tabular_row r ON r.id = e.tabular_row_id WHERE e.table_load_id <> ${loadId} ORDER BY r.line_number`),
  ["5\tFOOTLEN_MISMATCH", "6\tORPHAN_ADSH"]);
  assert.deepEqual(query(DB, `SELECT r.line_number, n.identifier_member_raw FROM obs.num_fact_observation n
JOIN raw.tabular_row r ON r.id = n.tabular_row_id WHERE r.table_load_id <> ${loadId}`), [`4\t${FAKE.ident}\t`]);
  assert.deepEqual(query(DB, `SELECT rv.rule_code FROM ops.run_rule_version x JOIN ops.rule_version rv ON rv.id = x.rule_version_id
WHERE x.run_id = ${first.runId} ORDER BY rv.rule_code`), ["obs.projection.num", "parser.sec_num_tsv", BACKFILL_RULE.code]);
  assert.deepEqual(query(DB, `SELECT r.run_kind, o.status FROM ops.run r JOIN ops.run_outcome o ON o.run_id = r.id WHERE r.id = ${first.runId}`),
    ["NUM_QUOTED_RECOVERY_BACKFILL\tSUCCEEDED"]);
  assert.equal(alreadyProcessed(DB, entry, rules["pipeline.num_load"]), true, "num:load still skips the artifact");

  writeSyntheticTree(path.join(dataDir, "standard"), treeWith(STANDARD_LINES));
  await runLoad({ dataDir: path.join(dataDir, "standard"), database: STANDARD_DB, log: silent });
  await runNumLoad({ dataDir: path.join(dataDir, "standard"), database: STANDARD_DB, log: silent });
  assert.deepEqual(quotedOutputs(DB), quotedOutputs(STANDARD_DB));

  const rerun = await runNumQuotedRecoveryBackfill({ database: DB, pin, sourceTableLoadId: loadId, log: silent });
  assert.equal(rerun.skipped, true);
  assert.deepEqual(rerun.totals, { units: 0, skipped: 1 });
  assert.deepEqual(backfillCounts(DB), after);
  assert.deepEqual(sourceSnapshot(DB, loadId), before);
}));

test("the in-transaction skip holds across a backfill rule version bump", withDbs(async (dataDir) => {
  writeSyntheticTree(dataDir, treeWith(STANDARD_LINES));
  const entry = zipEntry(dataDir);
  await runLoad({ dataDir, database: DB, log: silent });
  const { loadId } = seedPreRecoveryLoad(DB, entry, STANDARD_LINES);
  const pin = pinFor(entry, STANDARD_LINES, { passLines: [4, 6], failLines: [5] });
  const recovered = recoverLockedRows(pin, readLockedSource(DB, pin, loadId).rows);
  const first = await runNumQuotedRecoveryBackfill({ database: DB, pin, sourceTableLoadId: loadId, log: silent });
  const after = backfillCounts(DB);

  const bumped = Number(query(DB, `INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES (${lit(BACKFILL_RULE.code)}, 'EXTRACTION', '999', ${lit("f".repeat(64))}, 'TEST ONLY', 'TEST ONLY bumped version', 'test')
RETURNING id`)[0]);
  const runId = Number(query(DB, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('NUM_QUOTED_RECOVERY_BACKFILL', 'test-only', '{}'::jsonb, now()) RETURNING id`)[0]);
  assert.throws(
    () => queryRows(DB, backfillUnitSql({
      pin, sourceTableLoadId: loadId, recovered, runId,
      ruleIds: { ...first.ruleIds, backfill: bumped },
    })),
    new RegExp(ALREADY_LOADED_MARKER),
  );
  assert.deepEqual(backfillCounts(DB), after);
}));

test("hard stops before and inside the transaction leave no backfill data", withDbs(async (dataDir) => {
  const badTag = quotedRaw({ tag: "", value: "5" });
  const lines = [OK_A, Q_PASS, badTag, Q_FAIL];
  const { store } = writeSyntheticTree(dataDir, treeWith(lines));
  const entry = zipEntry(dataDir);
  await runLoad({ dataDir, database: DB, log: silent });
  const { loadId } = seedPreRecoveryLoad(DB, entry, lines);
  const pin = pinFor(entry, lines, { passLines: [3, 4], failLines: [5] });
  const before = sourceSnapshot(DB, loadId);
  const empty = backfillCounts(DB);
  const runsBefore = query(DB, "SELECT count(*) FROM ops.run WHERE run_kind = 'NUM_QUOTED_RECOVERY_BACKFILL'").join();

  const wrongSha = { ...pin, locks: pin.locks.map((lock, i) => (i === 0 ? { ...lock, sha: "a".repeat(64) } : lock)) };
  await assert.rejects(runNumQuotedRecoveryBackfill({ database: DB, pin: wrongSha, sourceTableLoadId: loadId, log: silent }),
    (error) => error instanceof BackfillHardStop && /SHA-256 differs/.test(error.message));
  await assert.rejects(runNumQuotedRecoveryBackfill({ database: DB, pin, sourceTableLoadId: loadId + 1000, log: silent }),
    /not \d+/);
  const otherZip = zipEntry(dataDir, "2099_11");
  await assert.rejects(runNumQuotedRecoveryBackfill({
    database: DB, pin, sourceTableLoadId: loadId, zipPath: store.pathFor(otherZip.storage_key), log: silent,
  }), /ZIP file SHA-256 differs/);
  assert.equal(query(DB, "SELECT count(*) FROM ops.run WHERE run_kind = 'NUM_QUOTED_RECOVERY_BACKFILL'").join(), runsBefore,
    "read-only hard stops write no run row");
  assert.equal(query(DB, `SELECT count(*) FROM ops.rule_version WHERE rule_code = ${lit(BACKFILL_RULE.code)}`).join(), "0",
    "read-only hard stops register no rule");

  await assert.rejects(runNumQuotedRecoveryBackfill({ database: DB, pin, sourceTableLoadId: loadId, log: silent }),
    /NUM tag cell is empty/);
  assert.deepEqual(backfillCounts(DB), empty);
  assert.deepEqual(sourceSnapshot(DB, loadId), before);
  assert.equal(query(DB, `SELECT count(*) FROM evidence.evidence e JOIN ops.run r ON r.id = e.run_id
WHERE r.run_kind = 'NUM_QUOTED_RECOVERY_BACKFILL'`).join(), "0");
  const runs = query(DB, `SELECT count(*) FILTER (WHERE o.run_id IS NULL) FROM ops.run r
LEFT JOIN ops.run_outcome o ON o.run_id = r.id WHERE r.run_kind = 'NUM_QUOTED_RECOVERY_BACKFILL'`).join();
  assert.equal(Number(runs), 1 + Number(runsBefore), "the rolled-back run stays STARTED with no outcome");
  assert.equal(query(DB, `SELECT count(*) FROM ops.artifact_processing p JOIN ops.rule_version rv ON rv.id = p.rule_version_id
WHERE rv.rule_code = ${lit(BACKFILL_RULE.code)}`).join(), "0");
}));

test("a source load on the pinned parser version stops before any write", withDbs(async (dataDir) => {
  writeSyntheticTree(dataDir, treeWith(STANDARD_LINES));
  const entry = zipEntry(dataDir);
  await runLoad({ dataDir, database: DB, log: silent });
  const { loadId } = seedPreRecoveryLoad(DB, entry, STANDARD_LINES, { sourceParser: "current" });
  const pin = pinFor(entry, STANDARD_LINES, { passLines: [4, 6], failLines: [5] });
  const before = sourceSnapshot(DB, loadId);
  const empty = backfillCounts(DB);
  await assert.rejects(runNumQuotedRecoveryBackfill({ database: DB, pin, sourceTableLoadId: loadId, log: silent }),
    (error) => error instanceof BackfillHardStop && /parser\.sec_num_tsv v3/.test(error.message));
  assert.deepEqual(backfillCounts(DB), empty);
  assert.deepEqual(sourceSnapshot(DB, loadId), before);
  assert.equal(query(DB, "SELECT count(*) FROM ops.run WHERE run_kind = 'NUM_QUOTED_RECOVERY_BACKFILL'").join(), "0");
}));

test("D6 failures store recovery and FOOTLEN_MISMATCH without facts; a D6 pin mismatch stops", withDbs(async (dataDir) => {
  const failOnly = [OK_A, Q_FAIL, quotedRaw({ value: "3", footnote: "TEST ONLY", footlen: "1" })];
  writeSyntheticTree(dataDir, treeWith(failOnly));
  const entry = zipEntry(dataDir);
  await runLoad({ dataDir, database: DB, log: silent });
  const { loadId } = seedPreRecoveryLoad(DB, entry, failOnly);

  const misclassified = pinFor(entry, failOnly, { passLines: [3], failLines: [4] });
  await assert.rejects(runNumQuotedRecoveryBackfill({ database: DB, pin: misclassified, sourceTableLoadId: loadId, log: silent }),
    /D6 result differs/);
  assert.equal(backfillCounts(DB).numLoads, "1");

  const pin = pinFor(entry, failOnly, { passLines: [], failLines: [3, 4] });
  const result = await runNumQuotedRecoveryBackfill({ database: DB, pin, sourceTableLoadId: loadId, log: silent });
  assert.equal(result.totals.num_footlen_mismatch_rows, 2);
  assert.equal(result.totals.num_fact_observations, 0);
  assert.deepEqual(backfillCounts(DB), {
    numLoads: "2", quoted: "2", sidecars: "2", footlen: "2", orphan: "0", facts: "1", loaded: "1",
  });
  assert.equal(query(DB, `SELECT count(*) FROM obs.num_fact_observation n JOIN raw.tabular_row r ON r.id = n.tabular_row_id
WHERE r.parse_status = 'QUOTED_RECOVERY'`).join(), "0");
}));
