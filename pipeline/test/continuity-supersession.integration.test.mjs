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
import { supersessionCounters } from "../load/continuity-supersession.mjs";
import { ingestExactResearchFields } from "../load/exact-research-field.mjs";
import { applyP4Min } from "../load/p4-min.mjs";
import { registerRules, ruleDefinitionSha, RULES } from "../load/rules.mjs";
import { pipelineCodeVersion, runLoad } from "../load/run.mjs";
import { runSoiLoad } from "../load/soi-run.mjs";
import { queryRows } from "../lib/db.mjs";
import { createStore } from "../lib/store.mjs";
import { FACT_FOOTNOTE_ARCROLE } from "../normalize/instrument-type-footnote-ref.mjs";
import { SUPERSESSION_METHOD, SUPERSESSION_RULE_CODE } from "../normalize/continuity-supersession.mjs";
import { runContinuitySupersession } from "../supersede-approved-continuity.mjs";
import { FAKE, p7Sources, p7UntypedSoiRows, writeSyntheticTree } from "./synthetic.mjs";

const dbName = `bdc_supersede_${process.pid}`;
// TEST ONLY identifiers. PAIR_A/B/C: allowlisted split pairs. OTHER: same shape, not allowlisted.
// DUP: two observations on the earlier date. PRE/POST: different identifier texts in the two periods.
const PAIR_A = "TEST BORROWER M | TEST LOAN 1";
const PAIR_B = "TEST BORROWER M | TEST LOAN 2";
const PAIR_C = "TEST BORROWER N | TEST LOAN 1";
const OTHER = "TEST BORROWER O | TEST LOAN 1";
const DUP = "TEST BORROWER Q | TEST LOAN 1";
const PRE = "TEST BORROWER R | TEST LOAN";
const POST = "TEST BORROWER R | TEST LOAN 1";
const Q1 = "2099-03-31";
const Q3 = "2099-09-30";

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
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-supersede-"));
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
function filingHtml(period, holdings) {
  const contexts = holdings.map(([identifier], i) => context(`c${i}`, identifier, period)).join("");
  const body = holdings.map(([, type], i) => `<tr>${td("TEST COMPANY")}${td("")}${td("")}</tr>`
    + `<tr>${td("TEST INDUSTRY")}${td(type)}${td(`<ix:nonFraction id="f${i}" contextRef="c${i}" name="us-gaap:InvestmentOwnedAtFairValue">11</ix:nonFraction>`)}</tr>`).join("");
  const labels = [...new Set(holdings.flatMap(([, , linked]) => linked))];
  const notes = labels.map((n) => `<p>(${n})</p><ix:footnote id="fn-${n}">TEST ONLY note ${n}</ix:footnote>`).join("");
  const links = holdings.map(([, , linked], i) => (linked.length
    ? `<ix:relationship fromRefs="f${i}" toRefs="${linked.map((n) => `fn-${n}`).join(" ")}" arcrole="${FACT_FOOTNOTE_ARCROLE}"/>`
    : "")).join("");
  return `<html><body><ix:header><ix:resources>${contexts}${links}</ix:resources></ix:header>`
    + `<table><tr>${td("Portfolio Company, Location and Industry(1)")}${td("Type of Investment")}${td("Fair Value")}</tr>`
    + `${body}</table>${notes}</body></html>`;
}

function linkFilingDocument(dataDir, accession, html, runId, ruleId) {
  const stored = createStore(dataDir).put(Buffer.from(html, "utf8"));
  const url = `https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000099/test-only-${accession}.htm`;
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
  SELECT f.id, 'test-only-${accession}.htm', '${url}', 'FILING_INDEX_JSON', ${ruleId}, ${runId}, ev.id
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
  return rows(`SELECT DISTINCT p.id || '|' || p.filing_id || '|' || p.reported_date
      FROM obs.position_observation p WHERE p.holding_descriptor_raw = '${identifier}'`).map((line) => {
    const [id, filingId, reportedDate] = line.split("|");
    return { id: Number(id), filingId: Number(filingId), reportedDate };
  }).sort((a, b) => a.reportedDate.localeCompare(b.reportedDate) || a.id - b.id);
}

// Run-49-style history: every observation gets its own instrument and its own position.
function storePriorSplit(ids) {
  queryRows(dbName, `
BEGIN;
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST', 'test', '{"prior_split":true}'::jsonb, now());
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES ('test.prior_p7', 'RESOLUTION', 'test-1', repeat('a', 64), 'pipeline/test (test only)', 'TEST ONLY prior rule', 'db tests');
${ids.map((id) => `
WITH inst AS (
  INSERT INTO identity.instrument (id, creation_reason, run_id)
  VALUES (gen_random_uuid(), 'TEST ONLY prior instrument', (SELECT max(id) FROM ops.run))
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
  return Number(scalar("SELECT max(id) FROM ops.run"));
}

function allDecisionRows() {
  return {
    continuity: rows(`SELECT d.id || '|' || d.position_observation_id || '|' || coalesce(d.position_id::text, '') || '|'
        || d.state || '|' || d.method || '|' || d.rationale || '|' || d.rule_version_id || '|' || d.run_id || '|'
        || coalesce(d.supersedes_id::text, '') || '|' || d.decided_at
      FROM resolution.position_continuity_decision d ORDER BY d.id`),
    instrument: rows(`SELECT d.id || '|' || d.position_observation_id || '|' || coalesce(d.instrument_id::text, '') || '|'
        || d.state || '|' || d.method || '|' || d.run_id || '|' || coalesce(d.supersedes_id::text, '') || '|' || d.decided_at
      FROM resolution.instrument_resolution_decision d ORDER BY d.id`),
    entity: rows(`SELECT d.id || '|' || d.state || '|' || d.method FROM resolution.entity_resolution_decision d ORDER BY d.id`),
    positions: rows(`SELECT id || '|' || registrant_id || '|' || creation_reason || '|' || run_id FROM identity.position ORDER BY id`),
    instruments: rows(`SELECT id || '|' || creation_reason || '|' || run_id FROM identity.instrument ORDER BY id`),
  };
}

function currentContinuity(id) {
  const [decisionId, positionId, method, supersedesId, runId] = scalar(`SELECT d.id || '|' || coalesce(d.position_id::text, '')
      || '|' || d.method || '|' || coalesce(d.supersedes_id::text, '') || '|' || d.run_id
    FROM resolution.current_position_continuity d WHERE d.position_observation_id = ${id}`).split("|");
  return { decisionId: Number(decisionId), positionId, method, supersedesId: supersedesId ? Number(supersedesId) : null, runId: Number(runId) };
}

function currentInstrument(id) {
  return scalar(`SELECT instrument_id::text FROM resolution.current_instrument_resolution WHERE position_observation_id = ${id}`);
}

test("approved supersession appends three decisions, joins the series, and is idempotent", withDb(async (dataDir) => {
  writeSyntheticTree(dataDir, p7Sources({
    extraSoi: [
      ...p7UntypedSoiRows(PAIR_A, { cik1Q1: 1, cik1Q3: 1 }),
      ...p7UntypedSoiRows(PAIR_B, { cik1Q1: 1, cik1Q3: 1 }),
      ...p7UntypedSoiRows(PAIR_C, { cik1Q1: 1, cik1Q3: 1 }),
      ...p7UntypedSoiRows(OTHER, { cik1Q1: 1, cik1Q3: 1 }),
      ...p7UntypedSoiRows(DUP, { cik1Q1: 2, cik1Q3: 1 }),
      ...p7UntypedSoiRows(PRE, { cik1Q1: 1 }),
      ...p7UntypedSoiRows(POST, { cik1Q3: 1 }),
    ],
  }));
  await runLoad({ dataDir, database: dbName, log: () => {} });
  await runSoiLoad({ dataDir, database: dbName, log: () => {} });

  const groups = Object.fromEntries([PAIR_A, PAIR_B, PAIR_C, OTHER, DUP, PRE, POST].map((id) => [id, observations(id)]));
  const setupRun = Number(queryRows(dbName, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST', '${pipelineCodeVersion()}', '{"test":true}'::jsonb, now()) RETURNING id;`)[0][0]);
  const rules = registerRules(dbName, setupRun);

  // TEST ONLY Geo-shaped types: markers change between periods; every marker is a row-linked footnote.
  const documents = {
    [FAKE.accP7q1]: filingHtml(Q1, [
      [PAIR_A, "First Lien(2)(5)", [2, 5]],
      [PAIR_B, "First Lien(4)(5)", [4, 5]],
      [PAIR_C, "First Lien(2)(3)", [2, 3]],
      [OTHER, "First Lien(2)(5)", [2, 5]],
      [DUP, "First Lien(2)(5)", [2, 5]],
      [PRE, "First Lien(2)(5)", [2, 5]],
    ]),
    [FAKE.accP7q3]: filingHtml(Q3, [
      [PAIR_A, "First Lien(2)(6)(8)", [2, 6, 8]],
      [PAIR_B, "First Lien(4)(7)(8)", [4, 7, 8]],
      [PAIR_C, "First Lien(2)(3)(6)", [2, 3, 6]],
      [OTHER, "First Lien(2)(6)(8)", [2, 6, 8]],
      [DUP, "First Lien(2)(6)(8)", [2, 6, 8]],
      [POST, "First Lien(2)(6)(8)", [2, 6, 8]],
    ]),
  };
  const artifacts = {};
  for (const [accession, html] of Object.entries(documents)) {
    artifacts[accession] = { id: linkFilingDocument(dataDir, accession, html, setupRun, rules["norm.borrower_name"]), html };
  }
  const accessionOf = (filingId) => scalar(`SELECT accession_number FROM registry.filing WHERE id = ${filingId}`);
  for (const [identifier, group] of Object.entries(groups)) {
    applyP4Min({
      database: dbName, positionObservationIds: group.map((row) => row.id), runId: setupRun, rules,
      identifierSha256: createHash("sha256").update(identifier, "utf8").digest("hex"),
    });
    for (const row of group) {
      const artifact = artifacts[accessionOf(row.filingId)];
      const out = ingestExactResearchFields({
        database: dbName, runId: setupRun, html: artifact.html,
        artifact: { id: artifact.id, sourceType: "SEC_FILING_DOCUMENT" },
        filingLink: { artifactId: artifact.id, filingId: row.filingId },
        positionFilingId: row.filingId, positionObservationId: row.id,
        holdingDescriptorRaw: identifier, reportedDate: row.reportedDate,
      });
      assert.ok(out.fields.some((field) => field.fieldCode === "INSTRUMENT_TYPE"), `${identifier} ${row.id} has a type cell`);
    }
  }

  const allIds = Object.values(groups).flat().map((row) => row.id);
  const priorRun = storePriorSplit(allIds);
  const entryFor = (identifier, { earlier, later } = {}) => {
    const group = groups[identifier] ?? [];
    const e = earlier ?? group.find((row) => row.reportedDate === Q1);
    const l = later ?? group.find((row) => row.reportedDate === Q3);
    return {
      laterObservationId: l.id,
      earlierObservationId: e.id,
      identifier,
      cik: FAKE.cik1,
      laterReportedDate: Q3,
      earlierReportedDate: Q1,
      priorDecisionId: currentContinuity(l.id).decisionId,
      priorRunId: priorRun,
      targetPositionId: currentContinuity(e.id).positionId,
    };
  };
  const allowlist = [entryFor(PAIR_A), entryFor(PAIR_B), entryFor(PAIR_C)];
  const before = allDecisionRows();
  const counters = supersessionCounters(dbName);
  const priorPositionOf = Object.fromEntries(allowlist.map((e) => [e.laterObservationId, currentContinuity(e.laterObservationId).positionId]));
  for (const entry of allowlist) assert.notEqual(priorPositionOf[entry.laterObservationId], entry.targetPositionId);

  // Dry-run writes nothing and plans exactly the three pairs.
  const logs = [];
  const dry = runContinuitySupersession({ database: dbName, dryRun: true, dataDir, log: (line) => logs.push(line), allowlist });
  assert.equal(dry.mode, "dry-run");
  assert.equal(dry.n_planned, 3);
  assert.equal(dry.n_blocked, 0);
  assert.deepEqual(dry.planned_supersessions.map((d) => [d.position_observation_id, d.prior_continuity_decision_id, d.target_position_id]),
    allowlist.map((e) => [e.laterObservationId, e.priorDecisionId, e.targetPositionId]));
  assert.equal(JSON.parse(logs[0]).planned_supersessions.length, 3);
  assert.deepEqual(supersessionCounters(dbName), counters);
  assert.deepEqual(allDecisionRows(), before);

  // Blocked pairs refuse the whole operation and write nothing.
  for (const [entry, code] of [
    [entryFor(DUP, { earlier: groups[DUP][0] }), "SAME_DATE_DUPLICATE"],
    [{ ...entryFor(POST, { earlier: groups[PRE][0] }), identifier: POST }, "IDENTIFIER_MISMATCH"],
  ]) {
    const blockedLogs = [];
    assert.throws(() => runContinuitySupersession({ database: dbName, dryRun: false, dataDir, log: (l) => blockedLogs.push(l), allowlist: [...allowlist, entry] }),
      /refused: 1 pair\(s\) blocked/);
    assert.ok(JSON.parse(blockedLogs[0]).blocked[0].blocking.some((b) => b.code === code), code);
    assert.deepEqual(supersessionCounters(dbName), counters);
  }
  // Without the stored documents the footnote markers cannot be verified, so nothing is planned.
  assert.throws(() => runContinuitySupersession({ database: dbName, dryRun: true, dataDir: path.join(dataDir, "TEST-ONLY-empty"), log() {}, allowlist }),
    /dry-run: 3 pair\(s\) blocked/);

  // Apply.
  const applied = runContinuitySupersession({ database: dbName, dryRun: false, dataDir, log() {}, allowlist });
  assert.equal(applied.mode, "applied");
  assert.equal(applied.applied.decisions.length, 3);
  assert.equal(applied.applied.candidates, 3);
  assert.equal(applied.applied.comparisons, 9);
  const rule = RULES.find((r) => r.code === SUPERSESSION_RULE_CODE);
  assert.equal(scalar(`SELECT rule_code || '|' || version || '|' || definition_sha256 FROM ops.rule_version WHERE id = ${applied.rule_version_id}`),
    `${SUPERSESSION_RULE_CODE}|1|${ruleDefinitionSha(rule)}`);
  assert.equal(scalar(`SELECT run_kind FROM ops.run WHERE id = ${applied.run_id}`), "APPROVED_CONTINUITY_SUPERSESSION");
  assert.equal(scalar(`SELECT status FROM ops.run_outcome WHERE run_id = ${applied.run_id}`), "SUCCEEDED");
  assert.equal(scalar(`SELECT count(*) FROM ops.run_rule_version WHERE run_id = ${applied.run_id}`), "2");

  for (const entry of allowlist) {
    const now = currentContinuity(entry.laterObservationId);
    assert.equal(now.positionId, entry.targetPositionId);
    assert.equal(now.method, SUPERSESSION_METHOD);
    assert.equal(now.supersedesId, entry.priorDecisionId);
    assert.equal(now.runId, applied.run_id);
    const [reason, evidenceId, candidateId, ruleId, actor] = scalar(`SELECT supersede_reason || '|' || evidence_id || '|'
        || match_candidate_id || '|' || rule_version_id || '|' || actor_kind
      FROM resolution.position_continuity_decision WHERE id = ${now.decisionId}`).split("|");
    assert.match(reason, new RegExp(`decision ${entry.priorDecisionId} .*stays in history`));
    assert.equal(Number(evidenceId), Number(scalar(`SELECT evidence_id FROM obs.position_observation WHERE id = ${entry.laterObservationId}`)));
    assert.equal(Number(ruleId), applied.rule_version_id);
    assert.equal(actor, "SYSTEM_RULE");
    assert.equal(scalar(`SELECT candidate_kind || '|' || position_observation_id || '|' || position_id FROM resolution.match_candidate WHERE id = ${candidateId}`),
      `POSITION|${entry.laterObservationId}|${entry.targetPositionId}`);
    assert.deepEqual(rows(`SELECT attribute_code || '|' || outcome || '|' || (left_evidence_id IS NOT NULL) || '|' || (right_evidence_id IS NOT NULL)
      FROM resolution.match_candidate_comparison WHERE match_candidate_id = ${candidateId} ORDER BY attribute_code`),
    ["FOOTNOTE_VERIFIED_TYPE|AGREE|true|true", "IDENTIFIER|AGREE|true|true", "REGISTRANT_OBSERVATION|AGREE|true|true"]);
    // The intended series: earlier then later, consecutive, on the earlier position.
    assert.deepEqual(rows(`SELECT earlier_position_observation_id || '|' || later_position_observation_id
      FROM registry.position_period_comparison WHERE position_id = '${entry.targetPositionId}'`),
    [`${entry.earlierObservationId}|${entry.laterObservationId}`]);
    // Instruments stay separate.
    assert.notEqual(currentInstrument(entry.laterObservationId), currentInstrument(entry.earlierObservationId));
    // The old position is not changed; it simply has no current members.
    assert.equal(scalar(`SELECT count(*) FROM resolution.current_position_continuity WHERE position_id = '${priorPositionOf[entry.laterObservationId]}'`), "0");
  }

  // Old decisions stay in history unchanged; instruments, positions, entity decisions, and unrelated pairs are unchanged.
  const after = allDecisionRows();
  for (const row of before.continuity) assert.ok(after.continuity.includes(row));
  assert.equal(after.continuity.length, before.continuity.length + 3);
  assert.deepEqual(after.instrument, before.instrument);
  assert.deepEqual(after.entity, before.entity);
  assert.deepEqual(after.positions, before.positions);
  assert.deepEqual(after.instruments, before.instruments);
  const touched = new Set(allowlist.map((e) => e.laterObservationId));
  for (const id of allIds.filter((x) => !touched.has(x))) {
    assert.equal(currentContinuity(id).runId, priorRun, `observation ${id} keeps its prior decision`);
  }
  const otherQ1 = currentContinuity(groups[OTHER][0].id);
  const otherQ3 = currentContinuity(groups[OTHER][1].id);
  assert.notEqual(otherQ1.positionId, otherQ3.positionId);
  assert.equal(scalar(`SELECT count(*) FROM (SELECT position_observation_id FROM resolution.position_continuity_decision d
    WHERE NOT EXISTS (SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = d.id)
    GROUP BY 1 HAVING count(*) > 1) x`), "0");

  // Rerun: nothing to do, no run, no rows.
  const afterCounters = supersessionCounters(dbName);
  const again = runContinuitySupersession({ database: dbName, dryRun: false, dataDir, log() {}, allowlist });
  assert.equal(again.mode, "nothing-to-do");
  assert.equal(again.n_planned, 0);
  assert.equal(again.n_already_applied, 3);
  assert.deepEqual(supersessionCounters(dbName), afterCounters);
  assert.deepEqual(allDecisionRows(), after);

  // The database itself refuses a second superseding row for the same prior decision.
  assert.throws(() => queryRows(dbName, `INSERT INTO resolution.position_continuity_decision (position_observation_id, position_id,
      state, method, rationale, actor_kind, decided_by, decided_at, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
    SELECT position_observation_id, position_id, state, method, 'TEST ONLY duplicate', actor_kind, 'test', now(), rule_version_id,
      evidence_id, run_id, supersedes_id, 'TEST ONLY duplicate'
    FROM resolution.position_continuity_decision WHERE id = ${currentContinuity(allowlist[0].laterObservationId).decisionId};`));
  assert.deepEqual(supersessionCounters(dbName), afterCounters);
}));
