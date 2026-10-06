// Bounded maturity inspection for the 17-position validation batch.
// HTML is fetched only for a batch filing that has no stored artifact.
// A position whose filing HTML was inspected but not bound gets a NOT_BOUND row with its
// no-bind reason; its maturity provenance stays UNKNOWN unless a structured date exists.

import { createHash } from "node:crypto";
import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { lit, num, queryRows } from "../lib/db.mjs";
import { createStore } from "../lib/store.mjs";
import { fetchAndLinkFilingDocument } from "./filing-document-artifact.mjs";
import { pipelineCodeVersion } from "./run.mjs";
import {
  NO_BIND_REASON, bindMaturityContextRows, rejectSharedContextBinds,
} from "../normalize/maturity-context-bind.mjs";
import { listIxContextRows } from "../normalize/ix-context-row.mjs";

export const MATURITY_BATCH = [
  { positionId: 592, lineNumber: 30132, accession: "0000017313-26-000095" },
  { positionId: 593, lineNumber: 30133, accession: "0000017313-26-000095" },
  { positionId: 606, lineNumber: 30146, accession: "0000017313-26-000095" },
  { positionId: 137927, lineNumber: 167716, accession: "0000017313-26-000095" },
  { positionId: 137928, lineNumber: 167717, accession: "0000017313-26-000095" },
  { positionId: 1120957, lineNumber: 19602, accession: "0000950170-24-020118" },
  { positionId: 1120959, lineNumber: 19604, accession: "0000950170-24-020118" },
  { positionId: 1122310, lineNumber: 20956, accession: "0000950170-24-020118" },
  { positionId: 1122311, lineNumber: 20957, accession: "0000950170-24-020118" },
  { positionId: 667511, lineNumber: 36714, accession: "0000950170-25-071368" },
  { positionId: 667512, lineNumber: 36715, accession: "0000950170-25-071368" },
  { positionId: 706056, lineNumber: 75263, accession: "0000950170-25-071368" },
  { positionId: 706057, lineNumber: 75264, accession: "0000950170-25-071368" },
  { positionId: 110271, lineNumber: 140060, accession: "0001193125-26-348682" },
  { positionId: 110272, lineNumber: 140061, accession: "0001193125-26-348682" },
  { positionId: 53297, lineNumber: 83082, accession: "0001193125-26-348682" },
  { positionId: 53298, lineNumber: 83083, accession: "0001193125-26-348682" },
];

const FETCH_ACCESSIONS = new Set([
  "0000017313-26-000095",
  "0001193125-26-348682",
]);

export const RULE_VERSION = "2";

const RULE_TEXT = [
  `pipeline.maturity_context_bind version ${RULE_VERSION}`,
  "Bind a position only when every comparable stored field equals a tagged fact on one context row.",
  "A context row is eligible only when its context period end (instant, or endDate of a duration) equals the position reported date as the same yyyy-mm-dd; no rounding.",
  "A fact with format ixt:fixed-zero displayed as an em dash is the number 0; any other fixed-zero display is not compared.",
  "FILING_DISPLAYED stores one month/day/four-digit-year date.",
  "A two-digit year stays raw on an UNRESOLVED candidate and is not normalized.",
  "No context bind leaves the position UNKNOWN.",
].join("\n");

function factId(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`unexpected ix fact id: ${value}`);
  return value;
}

function contextId(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`unexpected context id: ${value}`);
  return value;
}

export function batchCounts(database) {
  const [row] = queryRows(database, `SELECT
    (SELECT count(*) FROM obs.position_observation),
    (SELECT count(*) FROM obs.position_field_value),
    (SELECT count(*) FROM obs.position_field_value WHERE field_code = 'MATURITY_DATE'),
    (SELECT count(*) FROM obs.position_field_value
      WHERE field_code = 'MATURITY_DATE' AND value_state = 'REPORTED' AND normalized_date IS NOT NULL),
    (SELECT coalesce(sum(disclosed_line_count), 0) FROM registry.maturity_year),
    (SELECT count(*) FROM obs.maturity_inspection),
    (SELECT count(*) FROM obs.soi_row_classification)`);
  return {
    positions: Number(row[0]),
    field_values: Number(row[1]),
    maturity_rows: Number(row[2]),
    maturity_reported: Number(row[3]),
    maturity_year_lines: Number(row[4]),
    inspections: Number(row[5]),
    classifications: Number(row[6]),
  };
}

function loadPositions(database) {
  const ids = MATURITY_BATCH.map((row) => num(row.positionId)).join(",");
  const located = queryRows(database, `SELECT p.id, r.line_number, f.accession_number, o.id,
      fd.id, a.storage_key, a.sha256, p.reported_date::text
    FROM obs.position_observation p
    JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
    JOIN raw.tabular_row r ON r.id = o.tabular_row_id
    JOIN registry.filing f ON f.id = p.filing_id
    JOIN registry.filing_document fd
      ON fd.filing_id = f.id AND fd.named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT'
    LEFT JOIN registry.filing_document_artifact fda ON fda.filing_document_id = fd.id
    LEFT JOIN raw.artifact a ON a.id = fda.artifact_id
    WHERE p.id IN (${ids})`);
  const fields = queryRows(database, `SELECT position_observation_id, field_code, raw_value,
      normalized_numeric::text
    FROM obs.current_position_field_value
    WHERE position_observation_id IN (${ids})
    ORDER BY position_observation_id, field_code, source_column_label`);
  const byId = new Map();
  for (const expected of MATURITY_BATCH) {
    const hits = located.filter((row) => Number(row[0]) === expected.positionId);
    if (hits.length !== 1) throw new Error(`position ${expected.positionId} matched ${hits.length} filing documents`);
    const [id, lineNumber, accession, originId, filingDocumentId, storageKey, sha256, reportedDate] = hits[0];
    if (Number(lineNumber) !== expected.lineNumber || accession !== expected.accession) {
      throw new Error(`position ${expected.positionId} is line ${lineNumber} ${accession}`);
    }
    byId.set(expected.positionId, {
      ...expected,
      reportedDate: reportedDate || null,
      originId: Number(originId),
      filingDocumentId: Number(filingDocumentId),
      storageKey: storageKey || null,
      sha256: sha256 || null,
      fields: [],
    });
  }
  for (const row of fields) {
    const position = byId.get(Number(row[0]));
    position.fields.push({
      field_code: row[1],
      raw_value: row[2],
      normalized_numeric: row[3] === "" ? null : row[3],
    });
  }
  return [...byId.values()];
}

export function ensureRule(database, runId) {
  const sha = createHash("sha256").update(RULE_TEXT).digest("hex");
  queryRows(database, `INSERT INTO ops.rule_version
      (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
    VALUES ('pipeline.maturity_context_bind', 'VALIDATION', ${lit(RULE_VERSION)}, ${lit(sha)},
      'db/migrations/0023_maturity_inspection.sql', ${lit(RULE_TEXT)}, 'pipeline.maturity-inspection-batch')
    ON CONFLICT (rule_code, version) DO NOTHING`);
  const [row] = queryRows(database, `SELECT id, definition_sha256 FROM ops.rule_version
    WHERE rule_code = 'pipeline.maturity_context_bind' AND version = ${lit(RULE_VERSION)}`);
  if (row[1] !== sha) throw new Error(`maturity bind rule version ${RULE_VERSION} is stored with a different definition`);
  const ruleId = Number(row[0]);
  queryRows(database, `INSERT INTO ops.run_rule_version (run_id, rule_version_id)
    VALUES (${num(runId)}, ${num(ruleId)})`);
  return ruleId;
}

function supersedeColumns(plan) {
  if (plan.supersedesId === null) return "NULL::bigint, NULL::text";
  return `${num(plan.supersedesId)}, ${lit(plan.supersedeReason)}`;
}

function scratch(prefix, positionId) {
  return `${prefix}_${num(positionId)}`;
}

// Statements for one position. They contain no BEGIN or COMMIT. Temp names include the
// position id so every position in one publication transaction can use them together.
function inspectionStatements({ position, bound, plan, artifactId, ruleId, runId }) {
  const context = contextId(bound.contextId);
  const facts = bound.facts.map((fact) => factId(fact.id));
  if (facts.length === 0) throw new Error(`position ${position.positionId} has no corroborating fact`);
  const factValues = facts.map((id) => `(${lit(id)})`).join(",");
  const candidateValues = (bound.candidates ?? []).map((candidate) => `(${lit(candidate.raw)}, ${
    candidate.normalized ? `DATE ${lit(candidate.normalized)}` : "NULL::date"
  }, ${candidate.factId ? lit(factId(candidate.factId)) : "NULL::text"})`).join(",");
  const displayedRaw = plan.state === "FILING_DISPLAYED" ? lit(bound.rawValue) : "NULL";
  const displayedDate = plan.state === "FILING_DISPLAYED" ? `DATE ${lit(bound.normalizedDate)}` : "NULL";
  const anchor = scratch("anchor", position.positionId);
  const fact = scratch("fact", position.positionId);
  const inspection = scratch("inspection", position.positionId);
  return `
CREATE TEMP TABLE ${anchor} (id bigint) ON COMMIT DROP;
CREATE TEMP TABLE ${fact} (fact_id text PRIMARY KEY, evidence_id bigint) ON COMMIT DROP;
CREATE TEMP TABLE ${inspection} (id bigint) ON COMMIT DROP;
WITH anchor AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, html_anchor, run_id)
  VALUES ('L2_ORIGINAL_FILING', ${num(artifactId)}, 'HTML_ANCHOR', ${lit(`ix-context-row:${context}`)}, ${num(runId)})
  RETURNING id
)
INSERT INTO ${anchor} SELECT id FROM anchor;
WITH facts AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
  SELECT 'L2_ORIGINAL_FILING', ${num(artifactId)}, 'IXBRL_FACT', v.fact_id, ${num(runId)}
  FROM (VALUES ${factValues}) AS v(fact_id)
  RETURNING id, ixbrl_fact_id
)
INSERT INTO ${fact} SELECT ixbrl_fact_id, id FROM facts;
INSERT INTO validation.validation_result
  (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
SELECT 'obs.position_observation', ${num(position.positionId)}, ${num(ruleId)}, 'PASS', ${lit(context)}, evidence_id, ${num(runId)}
FROM ${fact};
WITH ins AS (
  INSERT INTO obs.maturity_inspection
    (position_observation_id, soi_row_observation_id, inspection_state, filing_context_id,
     raw_value, normalized_date, evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
  SELECT ${num(position.positionId)}, ${num(position.originId)}, ${lit(plan.state)}, ${lit(context)},
         ${displayedRaw}, ${displayedDate}, ${anchor}.id, ${num(ruleId)}, ${num(runId)}, ${supersedeColumns(plan)}
  FROM ${anchor}
  RETURNING id
)
INSERT INTO ${inspection} SELECT id FROM ins;
INSERT INTO evidence.supplementary_evidence (subject_table, subject_id, evidence_id, role, run_id)
SELECT 'obs.maturity_inspection', ${inspection}.id, ${fact}.evidence_id, 'CORROBORATES', ${num(runId)}
FROM ${inspection} CROSS JOIN ${fact};
INSERT INTO obs.maturity_inspection_candidate
  (maturity_inspection_id, raw_value, normalized_date, evidence_id, run_id)
SELECT ${inspection}.id, c.raw_value, c.normalized_date, COALESCE(${fact}.evidence_id, ${anchor}.id), ${num(runId)}
FROM ${inspection}
CROSS JOIN ${anchor}
CROSS JOIN (VALUES ${candidateValues || "(NULL::text, NULL::date, NULL::text)"}) AS c(raw_value, normalized_date, fact_id)
LEFT JOIN ${fact} ON ${fact}.fact_id = c.fact_id
WHERE c.raw_value IS NOT NULL;`;
}

function notBoundStatements({ position, plan, artifactId, ruleId, runId }) {
  const document = scratch("document", position.positionId);
  return `
CREATE TEMP TABLE ${document} (id bigint) ON COMMIT DROP;
WITH document AS (
  INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
  VALUES ('L2_ORIGINAL_FILING', ${num(artifactId)}, 'DOCUMENT', ${num(runId)})
  RETURNING id
)
INSERT INTO ${document} SELECT id FROM document;
INSERT INTO validation.validation_result
  (subject_table, subject_id, rule_version_id, outcome, detail, evidence_id, run_id)
SELECT 'obs.position_observation', ${num(position.positionId)}, ${num(ruleId)}, 'FAIL', ${lit(plan.noBindReason)}, id, ${num(runId)}
FROM ${document};
INSERT INTO obs.maturity_inspection
  (position_observation_id, soi_row_observation_id, inspection_state, no_bind_reason,
   evidence_id, rule_version_id, run_id, supersedes_id, supersede_reason)
SELECT ${num(position.positionId)}, ${num(position.originId)}, 'NOT_BOUND', ${lit(plan.noBindReason)},
       id, ${num(ruleId)}, ${num(runId)}, ${supersedeColumns(plan)}
FROM ${document};`;
}

const NO_BIND_REASONS = new Set(Object.values(NO_BIND_REASON));

export function noBindReasonOf(bound) {
  if (bound.outcome !== "UNKNOWN") throw new Error(`a ${bound.outcome} bind has no no-bind reason`);
  if (!NO_BIND_REASONS.has(bound.noBindReason)) {
    throw new Error(`unbound result has no recognised no-bind reason: ${bound.noBindReason ?? bound.reason}`);
  }
  return bound.noBindReason;
}

function sameOutcome(current, outcome) {
  return current.state === outcome.state
    && (current.contextId ?? null) === outcome.contextId
    && (current.rawValue ?? null) === outcome.rawValue
    && (current.noBindReason ?? null) === outcome.noBindReason;
}

// Decides what one inspected position writes, given its current (unsuperseded) inspection.
// A different outcome supersedes the current row; a first inspection supersedes nothing.
// When the current row was written under the same rule version and records the same
// outcome (state, filing context, displayed value, no-bind reason), nothing is written,
// so rerunning a rule version does not stack identical rows on the chain.
export function planInspection(bound, current, { ruleId, ruleVersion }) {
  const state = bound.outcome === "UNKNOWN" ? "NOT_BOUND" : bound.outcome;
  const outcome = {
    state,
    contextId: state === "NOT_BOUND" ? null : bound.contextId,
    rawValue: state === "FILING_DISPLAYED" ? bound.rawValue : null,
    noBindReason: state === "NOT_BOUND" ? noBindReasonOf(bound) : null,
  };
  if (current && current.ruleId === ruleId && sameOutcome(current, outcome)) {
    return { action: "skip", ...outcome, currentId: current.id };
  }
  return {
    action: "insert",
    ...outcome,
    supersedesId: current ? current.id : null,
    supersedeReason: current ? `superseded by binder rule v${ruleVersion}: ${outcome.noBindReason ?? state}` : null,
  };
}

export function formatInspectionErrors(errors) {
  return errors.map((error) => `position ${error.positionId}: ${error.message}`).join("\n");
}

// Plans one filing. Nothing is written. A planning error is collected and does not
// become a NOT_BOUND row. Callers must refuse publication when errors is not empty.
export function planFilingInspections({ positions, binds, currentById, rule }) {
  if (!Array.isArray(binds) || binds.length !== positions.length) {
    throw new Error("maturity inspection binds do not match the positions");
  }
  const results = [];
  const errors = [];
  positions.forEach((position, index) => {
    const bound = binds[index];
    try {
      results.push({
        position,
        bound,
        plan: planInspection(bound, currentById.get(position.positionId) ?? null, rule),
      });
    } catch (caught) {
      errors.push({
        positionId: position.positionId,
        message: caught instanceof Error ? caught.message : String(caught),
      });
    }
  });
  return { results, errors };
}

export function publishedInspectionCount(database, runId) {
  const [row] = queryRows(database, `SELECT count(*)::text FROM obs.maturity_inspection WHERE run_id = ${num(runId)}`);
  return Number(row[0]);
}

// The publication transaction has ended. The count is measured, not assumed: a rollback
// reports 0, and any row that remained is reported with that count.
export function recordMaturityRunFailure(database, runId, error) {
  const [existing] = queryRows(database, `SELECT 1 FROM ops.run_outcome WHERE run_id = ${num(runId)}`);
  if (existing) return;
  const published = publishedInspectionCount(database, runId);
  const detail = error instanceof Error ? error.message : String(error);
  const summary = `maturity inspection published ${published} inspection rows. ${detail}`
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
    VALUES (${num(runId)}, 'FAILED', now(), ${lit(JSON.stringify({ maturity_inspection: published }))}::jsonb, ${lit(summary)})`);
}

function outcomeStatement(runId, counts) {
  return `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
    VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(counts))}::jsonb, NULL)`;
}

// Inserts every planned row and the SUCCEEDED outcome in one transaction.
// A statement failure aborts that transaction, so an earlier position in the same
// publication does not remain committed.
export function commitInspectionPublication(database, { runId, ruleId, filings, counts }) {
  const errors = filings.flatMap((filing) => filing.errors ?? []);
  if (errors.length) throw new Error(formatInspectionErrors(errors));
  const statements = [];
  for (const filing of filings) {
    if (!filing.artifactId) throw new Error("an inspected filing needs its stored HTML artifact");
    for (const item of filing.results ?? []) {
      if (item.plan.action !== "insert") continue;
      const args = {
        position: item.position,
        bound: item.bound,
        plan: item.plan,
        artifactId: filing.artifactId,
        ruleId,
        runId,
      };
      statements.push(item.plan.state === "NOT_BOUND" ? notBoundStatements(args) : inspectionStatements(args));
    }
  }
  queryRows(database, `BEGIN;\n${statements.join("\n")}\n${outcomeStatement(runId, counts)};\nCOMMIT;`);
}

export function loadCurrentInspections(database, positionIds) {
  const current = new Map();
  if (positionIds.length === 0) return current;
  const rows = queryRows(database, `SELECT i.position_observation_id, i.id, i.inspection_state::text,
      i.filing_context_id, i.raw_value, i.no_bind_reason::text, i.rule_version_id
    FROM obs.maturity_inspection i
    WHERE i.position_observation_id IN (${positionIds.map(num).join(",")})
      AND NOT EXISTS (SELECT 1 FROM obs.maturity_inspection s WHERE s.supersedes_id = i.id)`);
  for (const [positionId, id, state, context, raw, reason, ruleId] of rows) {
    if (current.has(Number(positionId))) throw new Error(`position ${positionId} has more than one current inspection`);
    current.set(Number(positionId), {
      id: Number(id),
      state,
      contextId: context || null,
      rawValue: raw || null,
      noBindReason: reason || null,
      ruleId: Number(ruleId),
    });
  }
  return current;
}

// Positions must all belong to the filing whose stored HTML (artifactId) produced `binds`.
// This plans only. Publication is commitInspectionPublication.
export function inspectFilingPositions(database, { positions, binds, artifactId, ruleId }) {
  if (!artifactId) throw new Error("an inspected filing needs its stored HTML artifact");
  const currentById = loadCurrentInspections(database, positions.map((position) => position.positionId));
  return planFilingInspections({
    positions,
    binds,
    currentById,
    rule: { ruleId, ruleVersion: RULE_VERSION },
  });
}

// Binds every position of one filing against that filing's rows, each on its own
// reported date, then rejects any context claimed by more than one position.
export function bindFilingPositions(rows, positions) {
  return rejectSharedContextBinds(positions.map((position) => (
    bindMaturityContextRows(rows, position.fields, position.reportedDate)
  )));
}

export async function runMaturityInspectionBatch({
  database,
  dataDir = DEFAULT_DATA_DIR,
  client,
  sessionId,
  log = () => {},
}) {
  if (!sessionId) throw new Error("maturity batch requires a session_id");
  let runId;
  try {
  const before = batchCounts(database);
  const positions = loadPositions(database);
  const store = createStore(dataDir);
  const byAccession = new Map();
  for (const position of positions) {
    if (!byAccession.has(position.accession)) byAccession.set(position.accession, []);
    byAccession.get(position.accession).push(position);
  }

  for (const [accession, group] of byAccession) {
    if (group[0].storageKey) continue;
    if (!FETCH_ACCESSIONS.has(accession)) {
      throw new Error(`${accession} has no stored HTML and is outside the two-filing fetch list`);
    }
    const linked = await fetchAndLinkFilingDocument({
      database,
      filingDocumentId: group[0].filingDocumentId,
      dataDir,
      client,
      sessionId,
      log,
    });
    if (linked.http_status !== 200 || !linked.storage_key || !linked.sha256) {
      throw new Error(`${accession} filing HTML was not stored`);
    }
    for (const position of group) {
      position.storageKey = linked.storage_key;
      position.sha256 = linked.sha256;
      position.artifactId = linked.artifact_id;
    }
    log(JSON.stringify({ accession, http_status: linked.http_status, link_inserted: linked.link_inserted }));
  }

  const htmlByAccession = new Map();
  const artifactByAccession = new Map();
  for (const [accession, group] of byAccession) {
    const sample = group[0];
    if (!sample.artifactId) {
      const [row] = queryRows(database, `SELECT a.id, a.storage_key, a.sha256
        FROM registry.filing_document_artifact fda
        JOIN raw.artifact a ON a.id = fda.artifact_id
        WHERE fda.filing_document_id = ${num(sample.filingDocumentId)}`);
      sample.artifactId = Number(row[0]);
      sample.storageKey = row[1];
      sample.sha256 = row[2];
    }
    artifactByAccession.set(accession, sample.artifactId);
    htmlByAccession.set(accession, store.read(sample.storageKey, sample.sha256).toString("utf8"));
  }

  const [runRow] = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
    VALUES ('MATURITY_INSPECTION_BATCH', ${lit(pipelineCodeVersion())},
      jsonb_build_object('positions', ${MATURITY_BATCH.length}), now())
    RETURNING id`);
  runId = Number(runRow[0]);
  const ruleId = ensureRule(database, runId);

  const results = [];
  const filings = [];
  for (const [accession, group] of byAccession) {
    const rows = listIxContextRows(htmlByAccession.get(accession));
    const recorded = inspectFilingPositions(database, {
      positions: group,
      binds: bindFilingPositions(rows, group),
      artifactId: artifactByAccession.get(accession),
      ruleId,
    });
    if (recorded.errors.length) throw new Error(formatInspectionErrors(recorded.errors));
    filings.push({ artifactId: artifactByAccession.get(accession), results: recorded.results, errors: recorded.errors });
    for (const { position, bound, plan } of recorded.results) {
      const isBound = plan.state !== "NOT_BOUND";
      results.push({
        position_id: position.positionId,
        line_number: position.lineNumber,
        accession: position.accession,
        outcome: plan.state,
        written: plan.action === "insert",
        context_id: plan.contextId,
        displayed_raw: plan.rawValue,
        normalized_date: plan.state === "FILING_DISPLAYED" ? bound.normalizedDate : null,
        candidates: isBound ? (bound.candidates ?? []).map((candidate) => ({
          raw: candidate.raw,
          normalized: candidate.normalized,
        })) : [],
        no_bind_reason: plan.noBindReason,
        reason: bound.reason ?? null,
      });
    }
  }
  // All accessions in this batch commit together. A failure rolls back every position,
  // so the batch cannot publish a prefix of its accessions.
  commitInspectionPublication(database, {
    runId,
    ruleId,
    filings,
    counts: {
      maturity_inspection: results.filter((row) => row.written).length,
      positions: MATURITY_BATCH.length,
    },
  });

  const ids = MATURITY_BATCH.map((row) => num(row.positionId)).join(",");
  const provenance = queryRows(database, `SELECT position_observation_id, provenance_state::text,
      inspection_state::text, filing_context_id, displayed_raw, displayed_date::text,
      structured_date::text
    FROM obs.maturity_provenance
    WHERE position_observation_id IN (${ids})`);
  const provenanceById = new Map(provenance.map((row) => [Number(row[0]), row]));
  for (const result of results) {
    const row = provenanceById.get(result.position_id);
    result.provenance_state = row?.[1] ?? null;
    result.inspection_state = row?.[2] ?? null;
    result.structured_date = row?.[6] || null;
  }
  const after = batchCounts(database);
  return { before, after, results, run_id: runId };
  } catch (error) {
    if (runId !== undefined) {
      try {
        recordMaturityRunFailure(database, runId, error);
      } catch {
        // The original failure is the one that must surface. The run stays STARTED
        // only when this outcome write itself fails.
      }
    }
    throw error;
  }
}
