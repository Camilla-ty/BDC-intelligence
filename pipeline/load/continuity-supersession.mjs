// Approved historical continuity supersession (docs/METHODOLOGY.md 7.8). Read-only planning plus an
// insert-only writer. It inserts one POSITION match_candidate with its comparisons and one superseding
// position_continuity_decision per approved pair, in one transaction. It never updates or deletes a
// decision, never writes instrument decisions, and never inserts or changes identity.position rows.

import { IDENTIFIER_COLUMN } from "../normalize/borrower-name.mjs";
import {
  PAIR_STATUS, SUPERSESSION_DECIDED_BY, SUPERSESSION_METHOD,
  evaluatePair, supersessionDecision, validateAllowlist,
} from "../normalize/continuity-supersession.mjs";
import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
import { copyBlock, lit, num, queryRows, runScript } from "../lib/db.mjs";
import { loadTypeFootnoteRefs } from "./instrument-type-footnote-ref.mjs";

function jsonCell(rows, fallback) {
  return rows.length === 0 || rows[0][0] == null ? fallback : JSON.parse(rows[0][0]);
}

function uuidList(ids) {
  return ids.map((id) => `${lit(id)}::uuid`).join(", ");
}

function loadObservations(database, ids) {
  return jsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'id', p.id,
  'reported_date', p.reported_date,
  'holding_descriptor_raw', p.holding_descriptor_raw,
  'evidence_id', p.evidence_id,
  'registrants', (
    SELECT coalesce(json_agg(json_build_object('registrant_id', x.registrant_id, 'cik', x.cik) ORDER BY x.registrant_id), '[]'::json)
    FROM (SELECT DISTINCT fr.registrant_id, r.cik
          FROM registry.current_filing_registrant fr
          JOIN registry.registrant r ON r.id = fr.registrant_id
          WHERE fr.filing_id = p.filing_id AND fr.registrant_link_status = 'LINKED') x),
  'names', (
    SELECT coalesce(json_agg(json_build_object('id', b.id, 'raw_text', b.raw_text,
        'normalized_text', b.normalized_text, 'evidence_id', b.evidence_id) ORDER BY b.id), '[]'::json)
    FROM obs.borrower_name_observation b
    WHERE b.position_observation_id = p.id AND b.source_column_label = ${lit(IDENTIFIER_COLUMN)}
      AND b.extraction_state = 'EXTRACTED'),
  'types', (
    SELECT coalesce(json_agg(json_build_object('id', fv.id, 'value_state', fv.value_state,
        'raw_value', fv.raw_value, 'evidence_id', fv.evidence_id) ORDER BY fv.id), '[]'::json)
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = p.id AND fv.field_code = 'INSTRUMENT_TYPE'),
  'instruments', (
    SELECT coalesce(json_agg(json_build_object('id', d.id, 'state', d.state,
        'instrument_id', d.instrument_id) ORDER BY d.id), '[]'::json)
    FROM resolution.current_instrument_resolution d WHERE d.position_observation_id = p.id),
  'continuity', (
    SELECT coalesce(json_agg(json_build_object('id', d.id, 'state', d.state, 'method', d.method,
        'position_id', d.position_id, 'position_registrant_id', pos.registrant_id, 'run_id', d.run_id,
        'supersedes_id', d.supersedes_id) ORDER BY d.id), '[]'::json)
    FROM resolution.current_position_continuity d
    LEFT JOIN identity.position pos ON pos.id = d.position_id
    WHERE d.position_observation_id = p.id)
) ORDER BY p.id), '[]'::json)
FROM obs.position_observation p
WHERE p.id IN (${ids.map(num).join(", ")});`), []);
}

function loadSeriesMembers(database, positionIds) {
  if (positionIds.length === 0) return [];
  return jsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object('position_id', d.position_id,
    'position_observation_id', d.position_observation_id, 'reported_date', p.reported_date)
  ORDER BY d.position_id, p.reported_date, d.position_observation_id), '[]'::json)
FROM resolution.current_position_continuity d
JOIN obs.position_observation p ON p.id = d.position_observation_id
WHERE d.state = 'MATCHED' AND d.position_id IN (${uuidList(positionIds)});`), []);
}

// Every observation filed by the registrant whose SOI identifier or identifier-name text is exactly the
// pinned identifier, dated from the earlier date through the later date.
function loadSameKey(database, entry, registrantId) {
  return jsonCell(queryRows(database, `
WITH filings AS (
  SELECT DISTINCT fr.filing_id
  FROM registry.current_filing_registrant fr
  WHERE fr.registrant_id = ${num(registrantId)} AND fr.registrant_link_status = 'LINKED'
)
SELECT coalesce(json_agg(json_build_object('id', x.id, 'reported_date', x.reported_date) ORDER BY x.reported_date, x.id), '[]'::json)
FROM (
  SELECT p.id, p.reported_date
  FROM obs.position_observation p
  JOIN filings f ON f.filing_id = p.filing_id
  WHERE p.reported_date BETWEEN ${lit(entry.earlierReportedDate)}::date AND ${lit(entry.laterReportedDate)}::date
    AND (p.holding_descriptor_raw = ${lit(entry.identifier)}
      OR EXISTS (SELECT 1 FROM obs.borrower_name_observation b
                 WHERE b.position_observation_id = p.id AND b.source_column_label = ${lit(IDENTIFIER_COLUMN)}
                   AND b.raw_text = ${lit(entry.identifier)}))
) x;`), []);
}

// Read-only. Returns one evaluated pair per allowlist entry; nothing is written.
export function planContinuitySupersession({ database, allowlist, dataDir = DEFAULT_DATA_DIR }) {
  validateAllowlist(allowlist);
  const ids = allowlist.flatMap((entry) => [entry.laterObservationId, entry.earlierObservationId]);
  const observations = new Map(loadObservations(database, ids).map((row) => [Number(row.id), { ...row, id: Number(row.id) }]));
  const typeIds = [...observations.values()].flatMap((row) => row.types.map((type) => type.id));
  const refs = loadTypeFootnoteRefs(database, typeIds, { dataDir });
  for (const row of observations.values()) {
    row.type_ref = row.types.length === 1 ? refs.get(Number(row.types[0].id)) ?? null : null;
  }
  const positionIds = [...new Set([...observations.values()]
    .flatMap((row) => row.continuity.map((d) => d.position_id)).filter(Boolean))];
  const members = loadSeriesMembers(database, positionIds);
  const membersOf = (positionId) => members.filter((row) => row.position_id === positionId);

  return allowlist.map((entry) => {
    const later = observations.get(entry.laterObservationId) ?? null;
    const earlier = observations.get(entry.earlierObservationId) ?? null;
    const registrant = later?.registrants.length === 1 ? later.registrants[0].registrant_id : null;
    const facts = {
      later,
      earlier,
      laterSeries: later?.continuity.length === 1 ? membersOf(later.continuity[0].position_id) : [],
      targetSeries: membersOf(entry.targetPositionId),
      sameKey: registrant == null ? [] : loadSameKey(database, entry, Number(registrant)),
    };
    const evaluated = evaluatePair(entry, facts);
    if (evaluated.status === PAIR_STATUS.PLANNED) evaluated.decision = supersessionDecision(entry, facts);
    return evaluated;
  });
}

export function summarizePlan(plan) {
  const of = (status) => plan.filter((pair) => pair.status === status);
  return {
    n_planned: of(PAIR_STATUS.PLANNED).length,
    n_already_applied: of(PAIR_STATUS.ALREADY_APPLIED).length,
    n_blocked: of(PAIR_STATUS.BLOCKED).length,
    planned_supersessions: of(PAIR_STATUS.PLANNED).map((pair) => pair.decision),
    already_applied: of(PAIR_STATUS.ALREADY_APPLIED).map((pair) => ({
      position_observation_id: pair.entry.laterObservationId,
      current_decision_id: pair.currentDecisionId,
      supersedes_id: pair.entry.priorDecisionId,
    })),
    blocked: of(PAIR_STATUS.BLOCKED).map((pair) => ({
      position_observation_id: pair.entry.laterObservationId,
      earlier_position_observation_id: pair.entry.earlierObservationId,
      blocking: pair.blocking,
    })),
  };
}

// Insert-only. Refuses the whole operation when any pair is BLOCKED. A pair whose prior decision is no
// longer current is skipped by the SQL guard, so a rerun inserts nothing.
export function applyContinuitySupersession({ database, runId, ruleVersionId, plan }) {
  const blocked = plan.filter((pair) => pair.status === PAIR_STATUS.BLOCKED);
  if (blocked.length > 0) {
    throw new Error(`continuity supersession refused: ${blocked.length} pair(s) blocked (${blocked
      .map((pair) => `${pair.entry.laterObservationId}: ${pair.blocking.map((b) => b.code).join(",")}`).join("; ")})`);
  }
  const decisions = plan.filter((pair) => pair.status === PAIR_STATUS.PLANNED).map((pair) => pair.decision);
  if (decisions.length === 0) return { candidates: 0, comparisons: 0, decisions: [] };
  const out = runScript(database, supersessionSql({ runId, ruleVersionId, decisions }));
  const line = out.find((l) => l.startsWith("{"));
  if (!line) throw new Error("continuity supersession returned no result");
  const result = JSON.parse(line);
  return {
    candidates: Number(result.candidates),
    comparisons: Number(result.comparisons),
    decisions: result.decisions.map((d) => ({
      id: Number(d.id),
      position_observation_id: Number(d.position_observation_id),
      supersedes_id: Number(d.supersedes_id),
      position_id: d.position_id,
    })),
  };
}

// The only SQL the writer runs. A row is inserted only while its prior decision is still current.
export function supersessionSql({ runId, ruleVersionId, decisions }) {
  const rows = decisions.map((d) => [d.position_observation_id, d.prior_continuity_decision_id, d.target_position_id,
    d.decision_evidence_id, d.rationale, d.supersede_reason]);
  const comparisons = decisions.flatMap((d) => d.supporting_evidence.map((e) => [
    d.position_observation_id, e.attribute, e.earlier_evidence_id, e.later_evidence_id]));
  const rule = num(ruleVersionId);
  const run = num(runId);
  return `
BEGIN;
CREATE TEMP TABLE _cs (po_id bigint PRIMARY KEY, prior_id bigint NOT NULL, position_id uuid NOT NULL,
  evidence_id bigint NOT NULL, rationale text NOT NULL, reason text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _cs_cmp (po_id bigint NOT NULL, attribute_code text NOT NULL, left_evidence_id bigint NOT NULL,
  right_evidence_id bigint NOT NULL) ON COMMIT DROP;
${copyBlock("_cs", ["po_id", "prior_id", "position_id", "evidence_id", "rationale", "reason"], rows)}
${copyBlock("_cs_cmp", ["po_id", "attribute_code", "left_evidence_id", "right_evidence_id"], comparisons)}
WITH todo AS (
  SELECT c.*
  FROM _cs c
  JOIN resolution.position_continuity_decision d ON d.id = c.prior_id AND d.position_observation_id = c.po_id
  WHERE NOT EXISTS (SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = d.id)
), cand AS (
  INSERT INTO resolution.match_candidate (candidate_kind, position_observation_id, position_id, rule_version_id, run_id)
  SELECT 'POSITION', t.po_id, t.position_id, ${rule}, ${run} FROM todo t
  RETURNING id, position_observation_id
), cmp AS (
  INSERT INTO resolution.match_candidate_comparison (
      match_candidate_id, attribute_code, outcome, left_evidence_id, right_evidence_id, rule_version_id, run_id)
  SELECT cand.id, x.attribute_code, 'AGREE'::ref.comparison_outcome, x.left_evidence_id, x.right_evidence_id, ${rule}, ${run}
  FROM cand JOIN _cs_cmp x ON x.po_id = cand.position_observation_id
  RETURNING match_candidate_id
), dec AS (
  INSERT INTO resolution.position_continuity_decision (
      position_observation_id, position_id, match_candidate_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id, supersedes_id, supersede_reason)
  SELECT t.po_id, t.position_id, cand.id, 'MATCHED'::ref.resolution_state, ${lit(SUPERSESSION_METHOD)}, t.rationale,
         'SYSTEM_RULE'::ref.actor_kind, ${lit(SUPERSESSION_DECIDED_BY)}, now(), ${rule}, t.evidence_id, ${run},
         t.prior_id, t.reason
  FROM todo t JOIN cand ON cand.position_observation_id = t.po_id
  RETURNING id, position_observation_id, supersedes_id, position_id
)
SELECT json_build_object(
  'candidates', (SELECT count(*) FROM cand),
  'comparisons', (SELECT count(*) FROM cmp),
  'decisions', (SELECT coalesce(json_agg(json_build_object('id', id, 'position_observation_id', position_observation_id,
      'supersedes_id', supersedes_id, 'position_id', position_id) ORDER BY position_observation_id), '[]'::json) FROM dec));
COMMIT;`;
}

// Read-only counters for before/after zero-write checks.
export function supersessionCounters(database) {
  return jsonCell(queryRows(database, `
SELECT json_build_object(
  'ops_run', (SELECT count(*) FROM ops.run),
  'max_run_id', (SELECT coalesce(max(id), 0) FROM ops.run),
  'run_outcome', (SELECT count(*) FROM ops.run_outcome),
  'rule_version', (SELECT count(*) FROM ops.rule_version),
  'max_rule_version_id', (SELECT coalesce(max(id), 0) FROM ops.rule_version),
  'run_rule_version', (SELECT count(*) FROM ops.run_rule_version),
  'match_candidate', (SELECT count(*) FROM resolution.match_candidate),
  'match_candidate_comparison', (SELECT count(*) FROM resolution.match_candidate_comparison),
  'position_continuity_decision', (SELECT count(*) FROM resolution.position_continuity_decision),
  'max_position_continuity_decision_id', (SELECT coalesce(max(id), 0) FROM resolution.position_continuity_decision),
  'superseding_continuity_decisions', (SELECT count(*) FROM resolution.position_continuity_decision WHERE supersedes_id IS NOT NULL),
  'instrument_resolution_decision', (SELECT count(*) FROM resolution.instrument_resolution_decision),
  'max_instrument_resolution_decision_id', (SELECT coalesce(max(id), 0) FROM resolution.instrument_resolution_decision),
  'entity_resolution_decision', (SELECT count(*) FROM resolution.entity_resolution_decision),
  'identity_instrument', (SELECT count(*) FROM identity.instrument),
  'identity_position', (SELECT count(*) FROM identity.position)
);`), {});
}
