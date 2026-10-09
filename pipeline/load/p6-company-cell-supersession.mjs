// Append-only supersession of UNRESOLVED / NO_COMPANY_NAME_EVIDENCE decisions when
// observation-bound company-cell (or ISSUER_NAME) evidence arrives later.
// MATCHED is written only when the extracted company name equals an existing
// VERIFIED alias of resolution.entity_exact_company_cell_name. No new legal
// entity is created on this path. Identifier Axis text is never a company name.

import { IDENTIFIER_COLUMN } from "../normalize/borrower-name.mjs";
import {
  COMPANY_CELL_METHOD,
  COMPANY_CELL_NAME_SOURCE,
  COMPANY_CELL_RULE_CODE,
  NO_COMPANY_NAME_METHOD,
  companyNames,
  planCompanyCellEntities,
} from "../normalize/company-cell-entity.mjs";
import { copyBlock, lit, num, queryRows, runScript } from "../lib/db.mjs";
import { loadCompanyCellAliases, loadCompanyCellInputs } from "./p6-company-cell.mjs";

export const COMPANY_CELL_SUPERSESSION_DECIDED_BY = "pipeline p6-company-cell-supersession";

function intIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of ids ?? []) {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid position_observation_id: ${raw}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function requireReason(reason) {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("supersedeReason must be non-empty");
  }
  return reason.trim();
}

function parseJsonCell(rows) {
  if (rows.length === 0) return null;
  return JSON.parse(rows[0][0]);
}

// Read-only. Current NO_COMPANY_NAME_EVIDENCE decisions on the Identifier Axis name.
export function loadNoCompanyNameDecisions(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) return [];
  const col = lit(IDENTIFIER_COLUMN);
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'positionObservationId', b.position_observation_id,
  'borrowerNameObservationId', b.id,
  'decisionId', d.id,
  'method', d.method,
  'state', d.state
) ORDER BY b.position_observation_id), '[]'::json)::text
FROM obs.current_borrower_name_observation b
JOIN resolution.current_entity_resolution d ON d.borrower_name_observation_id = b.id
WHERE b.position_observation_id IN (${ids.join(",")})
  AND b.source_column_label = ${col}
  AND b.extraction_state = 'EXTRACTED'
  AND d.state = 'UNRESOLVED'
  AND d.method = ${lit(NO_COMPANY_NAME_METHOD)};`)) ?? [];
  return parsed.map((row) => ({
    positionObservationId: Number(row.positionObservationId),
    borrowerNameObservationId: Number(row.borrowerNameObservationId),
    decisionId: Number(row.decisionId),
    method: row.method,
    state: row.state,
  }));
}

// Read-only plan. Eligible only when a current NO_COMPANY_NAME_EVIDENCE head exists
// and company-name evidence is now present. MATCHED requires an existing alias.
export function planP6CompanyCellSupersession(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const prior = loadNoCompanyNameDecisions(database, ids);
  const priorByPo = new Map(prior.map((row) => [row.positionObservationId, row]));
  const eligibleIds = prior.map((row) => row.positionObservationId);
  if (eligibleIds.length === 0) {
    return {
      inputs: loadCompanyCellInputs(database, ids),
      prior,
      decisions: [],
      skippedNoPrior: ids.length,
      skippedNoCompanyName: 0,
      skippedNoExistingAlias: 0,
    };
  }
  const inputs = loadCompanyCellInputs(database, eligibleIds);
  const withNames = [];
  let skippedNoCompanyName = 0;
  for (const input of inputs) {
    if (companyNames(input).length === 0) {
      skippedNoCompanyName += 1;
      continue;
    }
    withNames.push(input);
  }
  const aliases = loadCompanyCellAliases(
    database,
    withNames.flatMap((row) => companyNames(row).map((name) => name.normalizedText)),
  );
  const planned = planCompanyCellEntities(withNames, aliases);
  const decisions = [];
  let skippedNoExistingAlias = 0;
  for (const decision of planned.decisions) {
    const priorDecision = priorByPo.get(decision.positionObservationId);
    if (!priorDecision) continue;
    if (decision.state !== "MATCHED" || decision.method !== COMPANY_CELL_METHOD || decision.legalEntityId == null) {
      skippedNoExistingAlias += 1;
      continue;
    }
    decisions.push({
      ...decision,
      priorDecisionId: priorDecision.decisionId,
      borrowerNameObservationId: priorDecision.borrowerNameObservationId,
    });
  }
  return {
    inputs: loadCompanyCellInputs(database, ids),
    prior,
    decisions,
    skippedNoPrior: ids.length - prior.length,
    skippedNoCompanyName,
    skippedNoExistingAlias,
  };
}

export function applyP6CompanyCellSupersession({
  database, positionObservationIds, runId, rules, supersedeReason,
}) {
  const ruleId = rules[COMPANY_CELL_RULE_CODE];
  if (!ruleId) throw new Error(`missing rule id for ${COMPANY_CELL_RULE_CODE}`);
  const reason = requireReason(supersedeReason);
  const plan = planP6CompanyCellSupersession(database, positionObservationIds);
  const decisionRows = plan.decisions.map((decision) => [
    decision.borrowerNameObservationId,
    decision.legalEntityId,
    decision.state,
    decision.method,
    decision.rationale,
    decision.evidenceId,
    decision.priorDecisionId,
    reason,
    decision.companyName,
  ]);
  const run = num(runId);
  const rule = num(ruleId);
  const sql = `
BEGIN;
CREATE TEMP TABLE _cc_sup (
  bno_id bigint PRIMARY KEY,
  legal_entity_id uuid NOT NULL,
  state text NOT NULL,
  method text NOT NULL,
  rationale text NOT NULL,
  evidence_id bigint NOT NULL,
  supersedes_id bigint NOT NULL,
  supersede_reason text NOT NULL,
  company_name text NOT NULL
) ON COMMIT DROP;
${copyBlock("_cc_sup", [
    "bno_id", "legal_entity_id", "state", "method", "rationale", "evidence_id",
    "supersedes_id", "supersede_reason", "company_name",
  ], decisionRows)}

DO $chk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _cc_sup s
    JOIN resolution.current_entity_resolution e ON e.id = s.supersedes_id
    WHERE e.borrower_name_observation_id IS DISTINCT FROM s.bno_id
       OR e.state IS DISTINCT FROM 'UNRESOLVED'
       OR e.method IS DISTINCT FROM ${lit(NO_COMPANY_NAME_METHOD)}
  ) THEN
    RAISE EXCEPTION 'P6 company cell supersession: prior decision is not a current NO_COMPANY_NAME_EVIDENCE head';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _cc_sup s
    JOIN resolution.current_entity_resolution e ON e.borrower_name_observation_id = s.bno_id
    WHERE e.id IS DISTINCT FROM s.supersedes_id
  ) THEN
    RAISE EXCEPTION 'P6 company cell supersession: identifier name current head changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _cc_sup s
    WHERE NOT EXISTS (
      SELECT 1 FROM identity.legal_entity_alias a
      JOIN ops.rule_version rv ON rv.id = a.rule_version_id
      WHERE a.legal_entity_id = s.legal_entity_id
        AND a.alias_text = s.company_name
        AND rv.rule_code = ${lit(COMPANY_CELL_RULE_CODE)}
        AND a.verification_state = 'VERIFIED'
        AND NOT EXISTS (SELECT 1 FROM identity.legal_entity_alias x WHERE x.supersedes_id = a.id)
    )
  ) THEN
    RAISE EXCEPTION 'P6 company cell supersession: no current VERIFIED company-cell alias equals the extracted company name';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _cc_sup s
    WHERE NOT EXISTS (
      SELECT 1 FROM obs.current_borrower_name_observation b
      WHERE b.position_observation_id = (
              SELECT i.position_observation_id FROM obs.current_borrower_name_observation i WHERE i.id = s.bno_id)
        AND b.name_source = ${lit(COMPANY_CELL_NAME_SOURCE)}
        AND b.extraction_state = 'EXTRACTED'
        AND b.evidence_id = s.evidence_id
        AND b.normalized_text = s.company_name
    )
  ) THEN
    RAISE EXCEPTION 'P6 company cell supersession: evidence_id is not the observation EXTRACTED company-cell name for the company name';
  END IF;
END
$chk$;

INSERT INTO resolution.entity_resolution_decision (
    borrower_name_observation_id, legal_entity_id, state, method, rationale, actor_kind,
    decided_by, decided_at, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
SELECT bno_id, legal_entity_id, state::ref.resolution_state, method, rationale, 'SYSTEM_RULE'::ref.actor_kind,
       ${lit(COMPANY_CELL_SUPERSESSION_DECIDED_BY)}, now(), ${rule}, evidence_id, ${run},
       supersedes_id, supersede_reason
FROM _cc_sup ORDER BY bno_id;

SELECT json_build_object(
  'matched_superseded', (SELECT count(*) FROM _cc_sup WHERE state = 'MATCHED'),
  'prior_unresolved', ${num(plan.prior.length)},
  'skipped_no_prior', ${num(plan.skippedNoPrior)},
  'skipped_no_company_name', ${num(plan.skippedNoCompanyName)},
  'skipped_no_existing_alias', ${num(plan.skippedNoExistingAlias)}
);
COMMIT;`;
  const out = runScript(database, sql);
  const counts = JSON.parse(out.find((line) => line.startsWith("{")));
  return {
    matched_superseded: Number(counts.matched_superseded),
    prior_unresolved: Number(counts.prior_unresolved),
    skipped_no_prior: Number(counts.skipped_no_prior),
    skipped_no_company_name: Number(counts.skipped_no_company_name),
    skipped_no_existing_alias: Number(counts.skipped_no_existing_alias),
  };
}
