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
import { ingestExactResearchFields } from "../load/exact-research-field.mjs";
import { applyP4Min } from "../load/p4-min.mjs";
import { applyP7Min, goldenInstrumentReport, planP7Min } from "../load/p7-min.mjs";
import { registerRules } from "../load/rules.mjs";
import { pipelineCodeVersion, runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { createStore } from "../lib/store.mjs";
import { FACT_FOOTNOTE_ARCROLE } from "../normalize/instrument-type-footnote-ref.mjs";
import { FAKE, p7Sources, p7UntypedSoiRows, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_fnref_${process.pid}`;
// TEST ONLY identifiers. SERIES: verified markers in two periods of one BDC plus one other BDC.
// UNVERIFIED: one period has a marker with no row-linked footnote. SPLIT: a series split by
// earlier decisions, as stored before this rule existed.
const SERIES = "TEST BORROWER F | TEST LOAN 6";
const UNVERIFIED = "TEST BORROWER G | TEST LOAN 7";
const SPLIT = "TEST BORROWER H | TEST LOAN 8";
const CASE = "TEST BORROWER J | TEST LOAN 9";

function rows(sql) {
  return query(dbName, sql);
}

function scalar(sql) {
  const found = rows(sql);
  assert.equal(found.length, 1, `expected one row from: ${sql}`);
  return found[0];
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline database tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-fnref-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

function td(text) {
  return `<td colspan="3">${text}</td>`;
}

function context(id, domain, period) {
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:segment>`
    + `<xbrldi:typedMember dimension="us-gaap:InvestmentIdentifierAxis">`
    + `<us-gaap:InvestmentIdentifierAxis.domain>${domain}</us-gaap:InvestmentIdentifierAxis.domain>`
    + `</xbrldi:typedMember></xbrli:segment></xbrli:entity>`
    + `<xbrli:period><xbrli:instant>${period}</xbrli:instant></xbrli:period></xbrli:context>`;
}

// One TEST ONLY filing document. Each holding is [identifier, type text, row-linked footnote labels].
// Every document also carries an unlinked footnote "(9)" and repeats label (2) on an unlinked note.
function filingHtml(period, holdings) {
  const contexts = holdings.map(([identifier], i) => context(`c${i}`, identifier, period)).join("");
  const body = holdings.map(([, type], i) => `<tr>${td("TEST COMPANY")}${td("")}${td("")}</tr>`
    + `<tr>${td("TEST INDUSTRY")}${td(type)}${td(`<ix:nonFraction id="f${i}" contextRef="c${i}" name="us-gaap:InvestmentOwnedAtFairValue">11</ix:nonFraction>`)}</tr>`).join("");
  const labels = [...new Set(holdings.flatMap(([, , linked]) => linked)), 9];
  const notes = labels.map((n) => `<p>(${n})</p><ix:footnote id="fn-${n}">TEST ONLY note ${n}</ix:footnote>`).join("")
    + `<p>(2)</p><ix:footnote id="fn-other-2">TEST ONLY other note</ix:footnote>`;
  const links = holdings.map(([, , linked], i) => {
    const arcrole = i % 2 === 0 ? ` arcrole="${FACT_FOOTNOTE_ARCROLE}"` : "";
    return linked.length ? `<ix:relationship fromRefs="f${i}" toRefs="${linked.map((n) => `fn-${n}`).join(" ")}"${arcrole}/>` : "";
  }).join("");
  return `<html><body><ix:header><ix:resources>${contexts}${links}</ix:resources></ix:header>`
    + `<table><tr>${td("Portfolio Company, Location and Industry(1)")}${td("Type of Investment")}${td("Fair Value")}</tr>`
    + `${body}</table>${notes}</body></html>`;
}

function linkFilingDocument(dataDir, accession, tag, html, runId, ruleId) {
  const stored = createStore(dataDir).put(Buffer.from(html, "utf8"));
  const url = `https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000099/test-only-${tag}.htm`;
  return Number(queryRows(dbName, `
WITH art AS (
  INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256,
      retrieved_at, storage_key, run_id)
  VALUES ('${url}', '${url}', 'SEC_FILING_DOCUMENT', 200, ${stored.byteSize}, '${stored.sha256}',
          '2099-01-02T00:00:00Z', '${stored.storageKey}', ${runId})
  RETURNING id
), ev AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  SELECT 'L2_ORIGINAL_FILING'::ref.evidence_level, art.id, 'DOCUMENT'::ref.locator_type, ${runId} FROM art
  RETURNING id, artifact_id
), doc AS (
  INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
  SELECT f.id, 'test-only-${tag}.htm', '${url}', 'FILING_INDEX_JSON', ${ruleId}, ${runId}, ev.id
  FROM registry.filing f CROSS JOIN ev
  WHERE f.accession_number = '${accession}'
  RETURNING id
), link AS (
  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  SELECT doc.id, ev.artifact_id, ${runId} FROM doc CROSS JOIN ev
  RETURNING artifact_id
)
SELECT artifact_id FROM link;`)[0][0]);
}

function observations(identifier) {
  return rows(`SELECT line FROM (
      SELECT DISTINCT p.id, p.reported_date, r.cik,
             p.id || '|' || p.filing_id || '|' || p.reported_date || '|' || r.cik AS line
      FROM obs.position_observation p
      JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
      JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED'
      JOIN registry.registrant r ON r.id = fr.registrant_id
      WHERE s.identifier_raw = '${identifier}') x
    ORDER BY reported_date, cik, id`).map((line) => {
    const [id, filingId, reportedDate, cik] = line.split("|");
    return { id: Number(id), filingId: Number(filingId), reportedDate, cik: Number(cik) };
  });
}

function continuityRows() {
  return rows(`SELECT d.id, d.position_observation_id, coalesce(d.position_id::text, ''), d.state, d.method,
      d.rationale, d.rule_version_id, d.run_id, coalesce(d.supersedes_id::text, ''), d.decided_at
    FROM resolution.position_continuity_decision d ORDER BY d.id`);
}

function instrumentRows() {
  return rows(`SELECT d.id, d.position_observation_id, coalesce(d.instrument_id::text, ''), d.state, d.method,
      d.rationale, d.rule_version_id, d.run_id, coalesce(d.supersedes_id::text, ''), d.decided_at
    FROM resolution.instrument_resolution_decision d ORDER BY d.id`);
}

function current(id) {
  const [state, method, positionId, rationale] = scalar(`SELECT d.state || '|' || d.method || '|'
      || coalesce(d.position_id::text, '') || '|' || d.rationale
    FROM resolution.current_position_continuity d WHERE d.position_observation_id = ${id}`).split("|");
  const instrument = scalar(`SELECT coalesce(instrument_id::text, '') FROM resolution.current_instrument_resolution
    WHERE position_observation_id = ${id}`);
  return { state, method, positionId, rationale, instrument };
}

// Stores split continuity for two observations exactly as decisions made before this rule look.
function storePriorSplit(ids, typeTexts) {
  queryRows(dbName, `
BEGIN;
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST', 'test', '{"prior_split":true}'::jsonb, now());
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES ('test.prior_p7', 'RESOLUTION', 'test-1', repeat('a', 64), 'pipeline/test (test only)', 'TEST ONLY prior rule', 'db tests');
${ids.map((id, i) => `
WITH inst AS (
  INSERT INTO identity.instrument (id, creation_reason, run_id)
  VALUES (gen_random_uuid(), 'TEST ONLY prior instrument ${typeTexts[i]}', (SELECT max(id) FROM ops.run))
  RETURNING id
), pos AS (
  INSERT INTO identity.position (id, registrant_id, creation_reason, run_id)
  SELECT gen_random_uuid(), x.registrant_id, 'TEST ONLY prior series', (SELECT max(id) FROM ops.run)
  FROM (SELECT DISTINCT fr.registrant_id
        FROM obs.position_observation p
        JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id
        WHERE p.id = ${id} AND fr.registrant_link_status = 'LINKED') x
  RETURNING id
), di AS (
  INSERT INTO resolution.instrument_resolution_decision (position_observation_id, instrument_id, state, method,
      rationale, actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT ${id}, inst.id, 'MATCHED', 'EXACT_IDENTIFIER_AND_TYPE', 'TEST ONLY prior decision', 'SYSTEM_RULE',
         'test', now(), (SELECT id FROM ops.rule_version WHERE rule_code = 'test.prior_p7'),
         (SELECT evidence_id FROM obs.position_observation WHERE id = ${id}), (SELECT max(id) FROM ops.run)
  FROM inst
)
INSERT INTO resolution.position_continuity_decision (position_observation_id, position_id, state, method,
    rationale, actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id)
SELECT ${id}, pos.id, 'MATCHED', 'SAME_REGISTRANT_AND_INSTRUMENT', 'TEST ONLY prior decision', 'SYSTEM_RULE',
       'test', now(), (SELECT id FROM ops.rule_version WHERE rule_code = 'test.prior_p7'),
       (SELECT evidence_id FROM obs.position_observation WHERE id = ${id}), (SELECT max(id) FROM ops.run)
FROM pos;`).join("\n")}
COMMIT;`);
}

test("footnote-verified type joins one same-BDC series; unverified, other-BDC, and prior split stay separate", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir, p7Sources({
    extraSoi: [
      ...p7UntypedSoiRows(SERIES, { cik1Q1: 1, cik1Q3: 1, cik2Q1: 1 }),
      ...p7UntypedSoiRows(UNVERIFIED, { cik1Q1: 1, cik1Q3: 1 }),
      ...p7UntypedSoiRows(SPLIT, { cik1Q1: 2, cik1Q3: 1 }),
      ...p7UntypedSoiRows(CASE, { cik1Q1: 1, cik2Q1: 1 }),
    ],
  }));
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const series = observations(SERIES);
  const unverified = observations(UNVERIFIED);
  const split = observations(SPLIT);
  const caseRows = observations(CASE);
  assert.equal(series.length, 3);
  assert.equal(unverified.length, 2);
  assert.equal(split.length, 3);
  assert.equal(caseRows.length, 2);

  const runId = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('ELIGIBLE_INSTRUMENT_RESOLUTION', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, runId);
  assert.ok(rules["norm.instrument_type_footnote_ref"]);

  // Geo-shaped TEST ONLY types: (2)(6)(8) and (2)(5) in one BDC; (2) in another BDC.
  const documents = {
    [`${FAKE.accP7q1}`]: filingHtml("2099-03-31", [
      [SERIES, "First Lien(2)(6)(8)", [2, 6, 8]],
      [UNVERIFIED, "First Lien(2)(9)", [2]],
      [SPLIT, "First Lien(2)(4)", [2, 4]],
      [CASE, "First Lien(2)(4)", [2, 4]],
    ]),
    [`${FAKE.accP7q3}`]: filingHtml("2099-09-30", [
      [SERIES, "First Lien(2)(5)", [2, 5]],
      [UNVERIFIED, "First Lien(2)", [2]],
      [SPLIT, "First Lien(2)(3)", [2, 3]],
    ]),
    [`${FAKE.accP7cik2}`]: filingHtml("2099-03-31", [
      [SERIES, "First Lien(2)", [2]],
      [CASE, "First lien (2)(3)", [2, 3]],
    ]),
  };
  const artifacts = {};
  for (const [accession, html] of Object.entries(documents)) {
    artifacts[accession] = { id: linkFilingDocument(dataDir, accession, accession, html, runId, rules["norm.borrower_name"]), html };
  }
  const accessionOf = (filingId) => scalar(`SELECT accession_number FROM registry.filing WHERE id = ${filingId}`);
  const soiFieldValues = () => rows(`SELECT fv.id || '|' || coalesce(fv.raw_value, '') || '|' || fv.value_state
    FROM obs.position_field_value fv
    JOIN ops.rule_version rv ON rv.id = fv.normalization_rule_version_id
    WHERE rv.rule_code = 'obs.projection.soi' ORDER BY fv.id`);
  const soiBefore = soiFieldValues();

  for (const [identifier, group] of [[SERIES, series], [UNVERIFIED, unverified], [SPLIT, split], [CASE, caseRows]]) {
    applyP4Min({
      database: dbName, positionObservationIds: group.map((row) => row.id), runId, rules,
      identifierSha256: createHash("sha256").update(identifier, "utf8").digest("hex"),
    });
    for (const row of group) {
      const artifact = artifacts[accessionOf(row.filingId)];
      const out = ingestExactResearchFields({
        database: dbName,
        runId,
        html: artifact.html,
        artifact: { id: artifact.id, sourceType: "SEC_FILING_DOCUMENT" },
        filingLink: { artifactId: artifact.id, filingId: row.filingId },
        positionFilingId: row.filingId,
        positionObservationId: row.id,
        holdingDescriptorRaw: identifier,
        reportedDate: row.reportedDate,
      });
      assert.ok(out.fields.some((field) => field.fieldCode === "INSTRUMENT_TYPE"), `${identifier} ${row.id} has a type cell`);
    }
  }

  // SPLIT: the first Q1 observation and the Q3 observation already have split continuity.
  const [splitQ1a, splitQ1b] = split.filter((row) => row.reportedDate === "2099-03-31");
  const splitQ3 = split.find((row) => row.reportedDate === "2099-09-30");
  storePriorSplit([splitQ1a.id, splitQ3.id], ["First Lien(2)(4)", "First Lien(2)(3)"]);
  const priorContinuity = continuityRows();
  const priorInstruments = instrumentRows();

  const all = [...series, ...unverified, ...split, ...caseRows].map((row) => row.id);
  const plan = planP7Min({ database: dbName, positionObservationIds: all, dataDir });
  const planned = new Map(plan.observations.map((row) => [row.position_observation_id, row]));
  assert.equal(planned.get(series[0].id).type.state, "VERIFIED");
  assert.deepEqual(planned.get(series[0].id).type.removed_markers, ["2", "6", "8"]);
  assert.deepEqual(planned.get(series[0].id).type.footnote_ids, ["fn-2", "fn-6", "fn-8"]);
  assert.equal(planned.get(unverified[0].id).type.state, "UNVERIFIED");
  assert.equal(planned.get(unverified[0].id).type.failed_marker, "9");
  assert.equal(planned.get(splitQ1b.id).continuity.method, "AMBIGUOUS_EXISTING_SERIES");

  const fieldValuesBefore = scalar("SELECT count(*) FROM obs.position_field_value");
  const result = applyP7Min({ database: dbName, positionObservationIds: all, runId, rules, dataDir });
  assert.equal(scalar("SELECT count(*) FROM obs.position_field_value"), fieldValuesBefore);
  assert.deepEqual(soiFieldValues(), soiBefore);

  // Same BDC, exact identifier, verified markers across two periods: one series, two instruments.
  const cik1Series = series.filter((row) => row.cik === FAKE.cik1).map((row) => current(row.id));
  const cik2Series = current(series.find((row) => row.cik === FAKE.cik2).id);
  assert.equal(cik1Series.length, 2);
  assert.equal(cik1Series[0].positionId, cik1Series[1].positionId);
  assert.notEqual(cik1Series[0].instrument, cik1Series[1].instrument);
  for (const decision of cik1Series) {
    assert.equal(decision.state, "MATCHED");
    assert.equal(decision.method, "SAME_REGISTRANT_IDENTIFIER_AND_FOOTNOTE_VERIFIED_TYPE");
    assert.match(decision.rationale, /norm\.instrument_type_footnote_ref v1 VERIFIED \(ALL_MARKERS_ROW_LINKED\)/);
    assert.match(decision.rationale, /continuity type "First Lien"/);
  }
  assert.match(cik1Series[0].rationale, /raw type "First Lien\(2\)\(6\)\(8\)".*removed markers \(2\)\(6\)\(8\), footnotes fn-2,fn-6,fn-8/);
  assert.match(cik1Series[1].rationale, /raw type "First Lien\(2\)\(5\)".*removed markers \(2\)\(5\), footnotes fn-2,fn-5/);

  // A different BDC never merges.
  assert.equal(cik2Series.state, "MATCHED");
  assert.notEqual(cik2Series.positionId, cik1Series[0].positionId);

  // An unverified marker keeps the raw type and its own series.
  const unverifiedQ1 = current(unverified.find((row) => row.reportedDate === "2099-03-31").id);
  const unverifiedQ3 = current(unverified.find((row) => row.reportedDate === "2099-09-30").id);
  assert.equal(unverifiedQ1.method, "SAME_REGISTRANT_AND_INSTRUMENT");
  assert.match(unverifiedQ1.rationale, /UNVERIFIED \(MARKER_NOT_LINKED, marker \(9\)\): type kept as raw "First Lien\(2\)\(9\)"/);
  assert.notEqual(unverifiedQ1.positionId, unverifiedQ3.positionId);

  // Case differences across BDCs stay separate.
  assert.notEqual(current(caseRows[0].id).positionId, current(caseRows[1].id).positionId);

  // Stored split decisions are not updated; a new observation on that key fails closed.
  const ambiguous = current(splitQ1b.id);
  assert.equal(ambiguous.state, "UNRESOLVED");
  assert.equal(ambiguous.method, "AMBIGUOUS_EXISTING_SERIES");
  assert.equal(ambiguous.positionId, "");
  assert.equal(priorContinuity.length, 2);
  assert.equal(priorInstruments.length, 2);
  for (const prior of priorContinuity) assert.ok(continuityRows().includes(prior));
  for (const prior of priorInstruments) assert.ok(instrumentRows().includes(prior));
  assert.equal(scalar(`SELECT count(*) FROM resolution.position_continuity_decision WHERE supersedes_id IS NOT NULL`), "0");
  assert.equal(scalar(`SELECT count(*) FROM resolution.instrument_resolution_decision WHERE supersedes_id IS NOT NULL`), "0");

  const gate = goldenInstrumentReport(dbName, all);
  assert.equal(gate.cross_bdc_series_merge, 0);
  assert.equal(gate.continuity_decision_problems, 0);
  assert.equal(gate.continuity_head_forks, 0);
  assert.equal(result.continuity_matched_inserted, all.length - 3);
  assert.equal(result.continuity_unresolved_inserted, 1);

  // Rerun is idempotent and still does not update any decision.
  const before = continuityRows();
  const beforeInstruments = instrumentRows();
  const again = applyP7Min({ database: dbName, positionObservationIds: all, runId, rules, dataDir });
  assert.equal(again.instruments_created, 0);
  assert.equal(again.positions_created, 0);
  assert.equal(again.instrument_matched_inserted, 0);
  assert.equal(again.continuity_matched_inserted, 0);
  assert.equal(again.continuity_unresolved_inserted, 0);
  assert.deepEqual(continuityRows(), before);
  assert.deepEqual(instrumentRows(), beforeInstruments);

  // Without the stored document the markers fail closed and nothing is removed.
  const blind = planP7Min({ database: dbName, positionObservationIds: all, dataDir: path.join(dataDir, "TEST-ONLY-empty") });
  assert.ok(blind.observations.every((row) => row.type.state === "UNVERIFIED" && row.type.reason === "DOCUMENT_UNAVAILABLE"));
}));
