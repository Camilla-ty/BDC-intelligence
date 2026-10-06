// BORROWER_NAME_NORMALIZE writer. Loads each supplied root's supersession chain,
// asks planBorrowerNameNormalize what to insert, and commits those inserts with the
// run outcome. A conflict or a failed insert records FAILED and leaves the run in place.

import { lit, num, queryRows } from "../lib/db.mjs";
import { planBorrowerNameNormalize } from "./borrower-name-normalize.mjs";

function rootIdList(rootIds) {
  if (!Array.isArray(rootIds) || rootIds.length === 0) throw new Error("borrower name normalization requires at least one root");
  return rootIds.map((id) => {
    const parsed = Number(id);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`invalid borrower name id: ${id}`);
    return parsed;
  });
}

function chainRow(raw) {
  return {
    id: Number(raw.id),
    positionObservationId: Number(raw.positionObservationId),
    evidenceId: Number(raw.evidenceId),
    nameSource: raw.nameSource,
    rawText: raw.rawText,
    normalizedText: raw.normalizedText,
    extractionState: raw.extractionState,
    ruleVersionId: Number(raw.ruleVersionId),
    supersedesId: raw.supersedesId == null ? null : Number(raw.supersedesId),
    sourceColumnLabel: raw.sourceColumnLabel,
    sourceColumnPosition: raw.sourceColumnPosition == null ? null : Number(raw.sourceColumnPosition),
  };
}

// Roots and every later row in their chains. The current head is the row nothing supersedes.
export function loadBorrowerNameChains(database, rootIds) {
  const ids = rootIdList(rootIds);
  const rows = queryRows(database, `
WITH RECURSIVE chain AS (
  SELECT b.id, b.position_observation_id, b.evidence_id, b.name_source, b.raw_text,
         b.normalized_text, b.extraction_state, b.rule_version_id, b.supersedes_id,
         b.source_column_label, b.source_column_position
  FROM obs.borrower_name_observation b
  WHERE b.id IN (${ids.map(num).join(",")})
  UNION
  SELECT s.id, s.position_observation_id, s.evidence_id, s.name_source, s.raw_text,
         s.normalized_text, s.extraction_state, s.rule_version_id, s.supersedes_id,
         s.source_column_label, s.source_column_position
  FROM obs.borrower_name_observation s
  JOIN chain c ON s.supersedes_id = c.id
)
SELECT encode(convert_to(coalesce(json_agg(json_build_object(
  'id', id,
  'positionObservationId', position_observation_id,
  'evidenceId', evidence_id,
  'nameSource', name_source,
  'rawText', raw_text,
  'normalizedText', normalized_text,
  'extractionState', extraction_state,
  'ruleVersionId', rule_version_id,
  'supersedesId', supersedes_id,
  'sourceColumnLabel', source_column_label,
  'sourceColumnPosition', source_column_position
))::text, '[]'), 'UTF8'), 'base64')
FROM chain`);
  const encoded = rows.map((row) => row.join("")).join("");
  const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  return parsed.map(chainRow);
}

export function recordBorrowerNameRunFailure(database, runId, error) {
  const existing = queryRows(database, `SELECT status FROM ops.run_outcome WHERE run_id = ${num(runId)}`);
  if (existing.length > 0) return;
  const summary = String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 500);
  queryRows(database, `
INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${num(runId)}, 'FAILED', now(), '{}'::jsonb, ${lit(summary)})`);
}

function insertSql(inserts, runId) {
  if (inserts.length === 0) return "";
  const values = inserts.map((plan) => {
    const row = plan.successor;
    return `(${num(row.positionObservationId)}, ${lit(row.nameSource)}, ${lit(row.rawText)}, ${lit(row.normalizedText)}, ${lit(row.extractionState)}, ${num(row.ruleVersionId)}, ${num(row.evidenceId)}, ${num(runId)}, ${num(row.supersedesId)}, ${lit(row.supersedeReason)})`;
  });
  return `
INSERT INTO obs.borrower_name_observation (
  position_observation_id, name_source, raw_text, normalized_text, extraction_state,
  rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
VALUES
${values.join(",\n")};`;
}

// One transaction: optional caller checks, the planned inserts, and the SUCCEEDED outcome.
// The planner runs first. A conflict throws before any name row is inserted.
export function normalizeBorrowerNames(database, { runId, rootIds, rule, baselineSql = "" }) {
  if (!Number.isSafeInteger(Number(runId)) || Number(runId) < 1) throw new Error("normalization run id is missing");
  const id = Number(runId);
  try {
    const rows = loadBorrowerNameChains(database, rootIds);
    const roots = rootIdList(rootIds).map((rootId) => {
      const root = rows.find((row) => row.id === rootId);
      if (!root) throw new Error(`borrower name ${rootId} is not in the lineage`);
      return root;
    });
    const plan = planBorrowerNameNormalize(roots, rows, rule);
    const counts = {
      borrower_name_observation: plan.inserts.length,
      evidence: 0,
      legal_entity: 0,
      entity_resolution_decision: 0,
      instrument_resolution_decision: 0,
    };
    queryRows(database, `
BEGIN;
${baselineSql}
${insertSql(plan.inserts, id)}
INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(id)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(counts))}::jsonb);
COMMIT;`);
    return plan;
  } catch (error) {
    try {
      recordBorrowerNameRunFailure(database, id, error);
    } catch {
      // The data transaction already rolled back. Keep the original failure.
    }
    throw error;
  }
}
