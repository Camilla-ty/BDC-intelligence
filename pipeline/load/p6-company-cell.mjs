// P6 company-cell legal-entity resolution for an explicit list of position_observation ids.
// resolution.entity_exact_company_cell_name v1. Inserts only. The decision sits on the
// observation's single Identifier Axis name row, so the borrower read views are unchanged.
// An observation whose identifier name already has a current decision is left as it is.

import { randomUUID } from "node:crypto";
import { IDENTIFIER_COLUMN } from "../normalize/borrower-name.mjs";
import {
  COMPANY_CELL_NAME_SOURCE,
  COMPANY_CELL_RULE_CODE,
  NO_COMPANY_NAME_METHOD,
  companyNames,
  planCompanyCellEntities,
} from "../normalize/company-cell-entity.mjs";
import { copyBlock, lit, num, queryRows, runScript } from "../lib/db.mjs";

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

function parseJsonCell(rows) {
  if (rows.length === 0) return null;
  return JSON.parse(rows[0][0]);
}

// Read-only. Company names, identifier name rows, and existing decisions for each observation.
export function loadCompanyCellInputs(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) return [];
  const col = lit(IDENTIFIER_COLUMN);
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'id', p.id,
  'identifierNames', (
    SELECT coalesce(json_agg(json_build_object('id', b.id, 'evidenceId', b.evidence_id) ORDER BY b.id), '[]'::json)
    FROM obs.current_borrower_name_observation b
    WHERE b.position_observation_id = p.id AND b.name_source = 'SOI_CELL'
      AND b.source_column_label = ${col} AND b.extraction_state = 'EXTRACTED'),
  'decided', EXISTS (
    SELECT 1 FROM resolution.current_entity_resolution d
    JOIN obs.current_borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id = p.id AND b.source_column_label = ${col}),
  'filingCells', (
    SELECT coalesce(json_agg(json_build_object('normalizedText', b.normalized_text, 'evidenceId', b.evidence_id) ORDER BY b.id), '[]'::json)
    FROM obs.current_borrower_name_observation b
    WHERE b.position_observation_id = p.id AND b.name_source = ${lit(COMPANY_CELL_NAME_SOURCE)}
      AND b.extraction_state = 'EXTRACTED'),
  'issuerNames', (
    SELECT coalesce(json_agg(json_build_object('rawText', fv.raw_value, 'evidenceId', fv.evidence_id) ORDER BY fv.id), '[]'::json)
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = p.id AND fv.field_code = 'ISSUER_NAME'
      AND fv.value_state = 'REPORTED' AND coalesce(fv.raw_value, '') <> '')
) ORDER BY p.id), '[]'::json)::text
FROM obs.position_observation p
WHERE p.id IN (${ids.join(",")});`)) ?? [];
  if (parsed.length !== ids.length) {
    throw new Error(`P6 company cell: expected ${ids.length} position observations, got ${parsed.length}`);
  }
  return parsed.map((row) => ({ ...row, id: Number(row.id) }));
}

// Read-only. Current VERIFIED aliases written by this rule for the given names.
export function loadCompanyCellAliases(database, names) {
  const list = [...new Set(names)];
  if (list.length === 0) return [];
  return parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object('aliasText', a.alias_text, 'legalEntityId', a.legal_entity_id) ORDER BY a.id), '[]'::json)::text
FROM identity.legal_entity_alias a
JOIN ops.rule_version rv ON rv.id = a.rule_version_id
WHERE rv.rule_code = ${lit(COMPANY_CELL_RULE_CODE)}
  AND a.verification_state = 'VERIFIED'
  AND NOT EXISTS (SELECT 1 FROM identity.legal_entity_alias s WHERE s.supersedes_id = a.id)
  AND a.alias_text IN (${list.map(lit).join(", ")});`)) ?? [];
}

// Read-only plan for observations whose identifier name has no current decision.
export function planP6CompanyCell(database, positionObservationIds) {
  const inputs = loadCompanyCellInputs(database, positionObservationIds);
  const open = inputs.filter((row) => !row.decided);
  const aliases = loadCompanyCellAliases(
    database,
    open.flatMap((row) => companyNames(row).map((name) => name.normalizedText)),
  );
  return { inputs, alreadyDecided: inputs.length - open.length, ...planCompanyCellEntities(open, aliases) };
}

export function applyP6CompanyCell({ database, positionObservationIds, runId, rules }) {
  const ruleId = rules["resolution.entity_exact_company_cell_name"];
  if (!ruleId) throw new Error("missing rule id for resolution.entity_exact_company_cell_name");
  const plan = planP6CompanyCell(database, positionObservationIds);
  const byId = new Map(plan.inputs.map((row) => [row.id, row]));
  for (const decision of plan.decisions) {
    if (byId.get(decision.positionObservationId).identifierNames.length !== 1) {
      throw new Error("P6 company cell requires one current Identifier Axis name for every observation");
    }
  }
  const newEntityIds = new Map(plan.newEntities.map((entity) => [entity.aliasText, randomUUID()]));
  const entityRows = plan.newEntities.map((entity) => [newEntityIds.get(entity.aliasText), entity.aliasText, entity.evidenceId]);
  const decisionRows = plan.decisions.map((decision) => {
    const identifierName = byId.get(decision.positionObservationId).identifierNames[0];
    return [
      identifierName.id,
      decision.legalEntityId ?? (decision.newEntityAlias == null ? null : newEntityIds.get(decision.newEntityAlias)),
      decision.state,
      decision.method,
      decision.rationale,
      decision.method === NO_COMPANY_NAME_METHOD ? identifierName.evidenceId : decision.evidenceId,
    ];
  });
  const run = num(runId);
  const rule = num(ruleId);
  const sql = `
BEGIN;
CREATE TEMP TABLE _cc_le (id uuid PRIMARY KEY, alias_text text NOT NULL UNIQUE, evidence_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _cc_dec (bno_id bigint PRIMARY KEY, legal_entity_id uuid, state text NOT NULL, method text NOT NULL,
  rationale text NOT NULL, evidence_id bigint NOT NULL) ON COMMIT DROP;
${copyBlock("_cc_le", ["id", "alias_text", "evidence_id"], entityRows)}
${copyBlock("_cc_dec", ["bno_id", "legal_entity_id", "state", "method", "rationale", "evidence_id"], decisionRows)}

DO $chk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _cc_le n
    JOIN identity.legal_entity_alias a ON a.alias_text = n.alias_text
    JOIN ops.rule_version rv ON rv.id = a.rule_version_id
    WHERE rv.rule_code = ${lit(COMPANY_CELL_RULE_CODE)} AND a.verification_state = 'VERIFIED'
      AND NOT EXISTS (SELECT 1 FROM identity.legal_entity_alias s WHERE s.supersedes_id = a.id)
  ) THEN
    RAISE EXCEPTION 'P6 company cell: a planned legal-entity alias already exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _cc_dec d
    JOIN resolution.current_entity_resolution e ON e.borrower_name_observation_id = d.bno_id
  ) THEN
    RAISE EXCEPTION 'P6 company cell: an identifier name already has a current entity decision';
  END IF;
END
$chk$;

INSERT INTO identity.legal_entity (id, creation_reason, run_id)
SELECT id, 'Legal entity from an exact primary-filing company cell or SOI issuer name', ${run}
FROM _cc_le ORDER BY alias_text;

INSERT INTO identity.legal_entity_alias (legal_entity_id, alias_text, verification_state, rule_version_id, evidence_id, run_id)
SELECT id, alias_text, 'VERIFIED', ${rule}, evidence_id, ${run}
FROM _cc_le ORDER BY alias_text;

INSERT INTO resolution.entity_resolution_decision (
    borrower_name_observation_id, legal_entity_id, state, method, rationale, actor_kind,
    decided_by, decided_at, rule_version_id, evidence_id, run_id)
SELECT bno_id, legal_entity_id, state::ref.resolution_state, method, rationale, 'SYSTEM_RULE'::ref.actor_kind,
       'pipeline p6-company-cell', now(), ${rule}, evidence_id, ${run}
FROM _cc_dec ORDER BY bno_id;

SELECT json_build_object(
  'legal_entities_created', (SELECT count(*) FROM _cc_le),
  'matched_inserted', (SELECT count(*) FROM _cc_dec WHERE state = 'MATCHED'),
  'unresolved_inserted', (SELECT count(*) FROM _cc_dec WHERE state = 'UNRESOLVED')
);
COMMIT;`;
  const out = runScript(database, sql);
  const counts = JSON.parse(out.find((line) => line.startsWith("{")));
  return {
    legal_entities_created: Number(counts.legal_entities_created),
    matched_inserted: Number(counts.matched_inserted),
    unresolved_inserted: Number(counts.unresolved_inserted),
    already_decided: plan.alreadyDecided,
  };
}
