#!/usr/bin/env node
// P7 instrument and continuity decisions for accepted SOI fact-group BALANCE
// members only. One call to applyP7Min. Does not call P4 or P6, does not select
// spread or PIK members, and does not change the P7 matcher.
//
//   node pipeline/p7-balance-candidates.mjs [--dry-run] [--db bdc_local]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import { applyP7Min } from "./load/p7-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { ensureAndLinkRuleForRun } from "./load/rules.mjs";
import { IDENTIFIER_COLUMN } from "./normalize/borrower-name.mjs";
import { SOI_FACT_GROUP_RULE } from "./normalize/soi-observation-group.mjs";
import { loadBalanceFactGroupCandidates } from "./p4-balance-candidates.mjs";

const EXPECTED_CANDIDATES = 418;
const EXPECTED_INSTRUMENTS = 248;
const EXPECTED_POSITIONS = 248;
const EXPECTED_MULTI_DATE = 170;
const EXPECTED_SINGLE_DATE = 78;

/** Identities linked for balance-candidate P7; must match applyP7Min + current RULES. */
export const P7_BALANCE_RULES = [
  { code: "norm.instrument_type_footnote_ref", version: "1" },
  { code: "resolution.instrument_exact_identifier_and_type", version: "2" },
  { code: "resolution.instrument_unknown_attributes", version: "2" },
  { code: "resolution.position_same_registrant_and_instrument", version: "2" },
  { code: "resolution.position_unresolved_without_instrument", version: "2" },
];

function opt(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function assertLocal(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("balance-candidate P7 refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("balance-candidate P7 refuses a database other than the local database");
  }
}

/**
 * Link catalog P7_BALANCE_RULES and apply P7 for the given balance member ids.
 * Callers that gate on production counts (applyP7ToBalanceCandidates) run after
 * local DB checks. Disposable integration tests call this write path directly.
 */
export function applyP7BalanceCandidateWrite({
  database,
  positionObservationIds,
  runId,
  dataDir = DEFAULT_DATA_DIR,
}) {
  if (!Array.isArray(positionObservationIds) || positionObservationIds.length === 0) {
    throw new Error("balance-candidate P7 requires at least one observation");
  }
  const rules = {};
  for (const rule of P7_BALANCE_RULES) {
    rules[rule.code] = ensureAndLinkRuleForRun(database, runId, rule).id;
  }
  return applyP7Min({
    database,
    positionObservationIds,
    runId,
    rules,
    dataDir,
  });
}

function jsonRow(database, sql) {
  const rows = queryRows(database, sql);
  if (rows.length !== 1 || rows[0].length !== 1) throw new Error("expected one JSON row");
  return JSON.parse(rows[0][0]);
}

function candidateFacts(database) {
  const column = lit(IDENTIFIER_COLUMN);
  return jsonRow(database, `
WITH cand AS (
  SELECT m.position_observation_id,
         s.identifier_raw,
         nullif(b.normalized_text, '') AS identifier_norm,
         tv.raw_value AS type_text,
         tv.value_state::text AS type_state,
         p.reported_date
  FROM obs.position_observation_group g
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
    AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
  JOIN obs.position_observation_group_member m
    ON m.group_id = g.id AND m.member_role = 'BALANCE'
  JOIN obs.position_observation p ON p.id = m.position_observation_id
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  LEFT JOIN LATERAL (
    SELECT b.normalized_text
    FROM obs.borrower_name_observation b
    WHERE b.position_observation_id = p.id
      AND b.source_column_label = ${column}
      AND b.extraction_state = 'EXTRACTED'
    ORDER BY b.id
    LIMIT 1
  ) b ON true
  LEFT JOIN LATERAL (
    SELECT fv.raw_value, fv.value_state
    FROM obs.current_position_field_value fv
    WHERE fv.position_observation_id = p.id AND fv.field_code = 'INSTRUMENT_TYPE'
    ORDER BY fv.id
    LIMIT 1
  ) tv ON true
),
ends AS (
  SELECT earlier_position_observation_id AS position_observation_id
  FROM registry.position_period_comparison
  UNION
  SELECT later_position_observation_id FROM registry.position_period_comparison
),
outside_keys AS (
  SELECT DISTINCT b.normalized_text AS identifier_norm, fv.raw_value AS type_text
  FROM resolution.current_instrument_resolution d
  JOIN obs.borrower_name_observation b
    ON b.position_observation_id = d.position_observation_id
   AND b.source_column_label = ${column}
   AND b.extraction_state = 'EXTRACTED'
  JOIN obs.current_position_field_value fv
    ON fv.position_observation_id = d.position_observation_id
   AND fv.field_code = 'INSTRUMENT_TYPE'
  WHERE d.state = 'MATCHED'
    AND d.method = 'EXACT_IDENTIFIER_AND_TYPE'
    AND d.instrument_id IS NOT NULL
    AND fv.value_state = 'REPORTED'
    AND coalesce(fv.raw_value, '') <> ''
    AND NOT EXISTS (SELECT 1 FROM cand c WHERE c.position_observation_id = d.position_observation_id)
)
SELECT json_build_object(
  'candidates', (SELECT count(*) FROM cand),
  'distinct_candidates', (SELECT count(DISTINCT position_observation_id) FROM cand),
  'extracted_names', (SELECT count(*) FROM cand WHERE identifier_norm IS NOT NULL),
  'matchable', (SELECT count(*) FROM cand
     WHERE identifier_norm IS NOT NULL AND type_state = 'REPORTED' AND coalesce(type_text, '') <> ''),
  'instrument_decisions', (SELECT count(*) FROM resolution.instrument_resolution_decision d
     JOIN cand c ON c.position_observation_id = d.position_observation_id),
  'continuity_decisions', (SELECT count(*) FROM resolution.position_continuity_decision d
     JOIN cand c ON c.position_observation_id = d.position_observation_id),
  'instrument_heads', (SELECT count(*) FROM resolution.current_instrument_resolution d
     JOIN cand c ON c.position_observation_id = d.position_observation_id),
  'continuity_heads', (SELECT count(*) FROM resolution.current_position_continuity d
     JOIN cand c ON c.position_observation_id = d.position_observation_id),
  'duplicate_instrument_heads', (SELECT count(*) FROM (
     SELECT d.position_observation_id FROM resolution.instrument_resolution_decision d
     JOIN cand c ON c.position_observation_id = d.position_observation_id
     WHERE NOT EXISTS (SELECT 1 FROM resolution.instrument_resolution_decision s WHERE s.supersedes_id = d.id)
     GROUP BY 1 HAVING count(*) > 1) x),
  'duplicate_continuity_heads', (SELECT count(*) FROM (
     SELECT d.position_observation_id FROM resolution.position_continuity_decision d
     JOIN cand c ON c.position_observation_id = d.position_observation_id
     WHERE NOT EXISTS (SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = d.id)
     GROUP BY 1 HAVING count(*) > 1) x),
  'unresolved_heads', (SELECT count(*) FROM resolution.current_instrument_resolution d
     JOIN cand c ON c.position_observation_id = d.position_observation_id
     WHERE d.state <> 'MATCHED'),
  'endpoint_overlap', (SELECT count(*) FROM ends e JOIN cand c ON c.position_observation_id = e.position_observation_id),
  'endpoint_paired_outside', (SELECT count(*) FROM registry.position_period_comparison c
     WHERE (c.earlier_position_observation_id IN (SELECT position_observation_id FROM cand)
            AND c.later_position_observation_id NOT IN (SELECT position_observation_id FROM cand))
        OR (c.later_position_observation_id IN (SELECT position_observation_id FROM cand)
            AND c.earlier_position_observation_id NOT IN (SELECT position_observation_id FROM cand))),
  'non_balance_overlap', (SELECT count(*) FROM obs.position_observation_group_member m
     JOIN cand c ON c.position_observation_id = m.position_observation_id
     JOIN obs.position_observation_group g ON g.id = m.group_id
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
       AND m.member_role <> 'BALANCE'),
  'external_key_collisions', (SELECT count(*) FROM (
     SELECT DISTINCT c.identifier_norm, c.type_text FROM cand c
     JOIN outside_keys k ON k.identifier_norm = c.identifier_norm AND k.type_text = c.type_text) x),
  'sibling_instrument_decisions', (SELECT count(*) FROM resolution.instrument_resolution_decision d
     JOIN obs.position_observation_group_member m ON m.position_observation_id = d.position_observation_id
     JOIN obs.position_observation_group g ON g.id = m.group_id
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
       AND m.member_role <> 'BALANCE'),
  'sibling_continuity_decisions', (SELECT count(*) FROM resolution.position_continuity_decision d
     JOIN obs.position_observation_group_member m ON m.position_observation_id = d.position_observation_id
     JOIN obs.position_observation_group g ON g.id = m.group_id
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
       AND m.member_role <> 'BALANCE'),
  'spread_members', (SELECT count(*) FROM obs.position_observation_group_member m
     JOIN obs.position_observation_group g ON g.id = m.group_id
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
       AND m.member_role = 'SPREAD'),
  'pik_members', (SELECT count(*) FROM obs.position_observation_group_member m
     JOIN obs.position_observation_group g ON g.id = m.group_id
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
       AND m.member_role = 'PIK')
)::text;`);
}

function seriesProof(database) {
  return jsonRow(database, `
WITH cand AS (
  SELECT m.position_observation_id, p.reported_date
  FROM obs.position_observation_group g
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
    AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
  JOIN obs.position_observation_group_member m
    ON m.group_id = g.id AND m.member_role = 'BALANCE'
  JOIN obs.position_observation p ON p.id = m.position_observation_id
),
series AS (
  SELECT d.position_id, i.instrument_id,
         count(*) AS n,
         count(DISTINCT c.reported_date) AS n_dates
  FROM cand c
  JOIN resolution.current_instrument_resolution i
    ON i.position_observation_id = c.position_observation_id
  JOIN resolution.current_position_continuity d
    ON d.position_observation_id = c.position_observation_id
  WHERE i.state = 'MATCHED' AND d.state = 'MATCHED'
  GROUP BY d.position_id, i.instrument_id
)
SELECT json_build_object(
  'matched_instrument_decisions', (SELECT count(*) FROM cand c
     JOIN resolution.current_instrument_resolution d ON d.position_observation_id = c.position_observation_id
     WHERE d.state = 'MATCHED'),
  'matched_continuity_decisions', (SELECT count(*) FROM cand c
     JOIN resolution.current_position_continuity d ON d.position_observation_id = c.position_observation_id
     WHERE d.state = 'MATCHED'),
  'distinct_instruments', (SELECT count(DISTINCT instrument_id) FROM series),
  'distinct_positions', (SELECT count(DISTINCT position_id) FROM series),
  'multi_date_positions', (SELECT count(*) FROM series WHERE n = 2 AND n_dates = 2),
  'single_date_positions', (SELECT count(*) FROM series WHERE n = 1 AND n_dates = 1),
  'other_positions', (SELECT count(*) FROM series WHERE NOT ((n = 2 AND n_dates = 2) OR (n = 1 AND n_dates = 1)))
)::text;`);
}

function isolationSnapshot(database, priorPositionIds = null) {
  const priorFilter = priorPositionIds == null
    ? ""
    : `WHERE position_id IN (${priorPositionIds.map((id) => lit(id)).join(", ")})`;
  return jsonRow(database, `
WITH prior_comparisons AS (
  SELECT position_id, earlier_position_observation_id, later_position_observation_id,
         principal_changed, cost_changed, fair_value_changed, maturity_changed
  FROM registry.position_period_comparison
  ${priorFilter}
),
all_comparisons AS (
  SELECT position_id, earlier_position_observation_id, later_position_observation_id,
         fair_value_changed, principal_changed, cost_changed, maturity_changed
  FROM registry.position_period_comparison
),
legacy_comparisons AS (
  SELECT *
  FROM all_comparisons c
  WHERE NOT EXISTS (
    SELECT 1
    FROM obs.position_observation_group g
    JOIN ops.rule_version rv ON rv.id = g.rule_version_id
      AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
      AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
    JOIN obs.position_observation_group_member m
      ON m.group_id = g.id AND m.member_role = 'BALANCE'
     AND m.position_observation_id IN (c.earlier_position_observation_id, c.later_position_observation_id)
  )
)
SELECT json_build_object(
  'instrument_decisions', (SELECT count(*) FROM resolution.instrument_resolution_decision),
  'instrument_decision_max_id', (SELECT coalesce(max(id), 0) FROM resolution.instrument_resolution_decision),
  'continuity_decisions', (SELECT count(*) FROM resolution.position_continuity_decision),
  'continuity_decision_max_id', (SELECT coalesce(max(id), 0) FROM resolution.position_continuity_decision),
  'instruments', (SELECT count(*) FROM identity.instrument),
  'positions', (SELECT count(*) FROM identity.position),
  'prior_comparisons', (SELECT count(*) FROM prior_comparisons),
  'prior_comparison_positions', (SELECT count(DISTINCT position_id) FROM prior_comparisons),
  'prior_comparisons_changed', (SELECT count(*) FROM prior_comparisons c
     WHERE c.fair_value_changed OR c.principal_changed OR c.cost_changed OR c.maturity_changed),
  'prior_comparison_fingerprint', (SELECT md5(coalesce(string_agg(
       position_id::text || ':' || earlier_position_observation_id::text || ':' || later_position_observation_id::text
       || ':' || coalesce(principal_changed::text, '') || ':' || coalesce(cost_changed::text, '')
       || ':' || coalesce(fair_value_changed::text, '') || ':' || coalesce(maturity_changed::text, ''),
       ',' ORDER BY position_id::text), '')) FROM prior_comparisons),
  'prior_position_ids', (SELECT coalesce(json_agg(position_id ORDER BY position_id::text), '[]'::json) FROM prior_comparisons),
  'comparisons', (SELECT count(*) FROM all_comparisons),
  'comparison_positions', (SELECT count(DISTINCT position_id) FROM all_comparisons),
  'comparisons_changed', (SELECT count(*) FROM all_comparisons c
     WHERE c.fair_value_changed OR c.principal_changed OR c.cost_changed OR c.maturity_changed),
  'legacy_comparisons', (SELECT count(*) FROM legacy_comparisons),
  'legacy_comparison_positions', (SELECT count(DISTINCT position_id) FROM legacy_comparisons),
  'legacy_comparisons_changed', (SELECT count(*) FROM legacy_comparisons c
     WHERE c.fair_value_changed OR c.principal_changed OR c.cost_changed OR c.maturity_changed),
  'legacy_comparison_fingerprint', (SELECT md5(coalesce(string_agg(
       position_id::text || ':' || earlier_position_observation_id::text || ':' || later_position_observation_id::text
       || ':' || coalesce(principal_changed::text, '') || ':' || coalesce(cost_changed::text, '')
       || ':' || coalesce(fair_value_changed::text, '') || ':' || coalesce(maturity_changed::text, ''),
       ',' ORDER BY position_id::text), '')) FROM legacy_comparisons),
  'fact_groups', (SELECT count(*) FROM obs.position_observation_group g
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}),
  'fact_group_members', (SELECT count(*) FROM obs.position_observation_group_member m
     JOIN obs.position_observation_group g ON g.id = m.group_id
     JOIN ops.rule_version rv ON rv.id = g.rule_version_id
     WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}),
  'position_observations', (SELECT count(*) FROM obs.position_observation),
  'borrower_names', (SELECT count(*) FROM obs.borrower_name_observation)
)::text;`);
}

function chyronProof(database) {
  const column = lit(IDENTIFIER_COLUMN);
  return jsonRow(database, `
WITH obs AS (
  SELECT p.id, p.reported_date, s.identifier_raw, tv.raw_value AS type_text,
         i.instrument_id, i.state::text AS instrument_state,
         d.position_id, d.state::text AS continuity_state
  FROM obs.position_observation p
  JOIN registry.filing f ON f.id = p.filing_id AND f.accession_number = '0000950170-23-003448'
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  LEFT JOIN obs.current_position_field_value tv
    ON tv.position_observation_id = p.id AND tv.field_code = 'INSTRUMENT_TYPE'
  LEFT JOIN resolution.current_instrument_resolution i ON i.position_observation_id = p.id
  LEFT JOIN resolution.current_position_continuity d ON d.position_observation_id = p.id
  WHERE s.identifier_raw = 'ChyronHego Corporation'
)
SELECT json_build_object(
  'first_lien_instruments', (SELECT count(DISTINCT instrument_id) FROM obs
     WHERE type_text = 'First Lien Secured Debt [Member]' AND instrument_state = 'MATCHED'
       AND id IN (SELECT position_observation_id FROM obs.position_observation_group_member m
         JOIN obs.position_observation_group g ON g.id = m.group_id
         JOIN ops.rule_version rv ON rv.id = g.rule_version_id
         WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
           AND m.member_role = 'BALANCE')),
  'first_lien_positions', (SELECT count(DISTINCT position_id) FROM obs
     WHERE type_text = 'First Lien Secured Debt [Member]' AND continuity_state = 'MATCHED'
       AND id IN (SELECT position_observation_id FROM obs.position_observation_group_member m
         JOIN obs.position_observation_group g ON g.id = m.group_id
         JOIN ops.rule_version rv ON rv.id = g.rule_version_id
         WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
           AND m.member_role = 'BALANCE')),
  'first_lien_dates', (SELECT count(DISTINCT reported_date) FROM obs
     WHERE type_text = 'First Lien Secured Debt [Member]'
       AND id IN (SELECT position_observation_id FROM obs.position_observation_group_member m
         JOIN obs.position_observation_group g ON g.id = m.group_id
         JOIN ops.rule_version rv ON rv.id = g.rule_version_id
         WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
           AND m.member_role = 'BALANCE')),
  'revolver_instruments', (SELECT count(DISTINCT instrument_id) FROM obs
     WHERE type_text = 'First Lien Secured Debt Revolver [Member]' AND instrument_state = 'MATCHED'
       AND id IN (SELECT position_observation_id FROM obs.position_observation_group_member m
         JOIN obs.position_observation_group g ON g.id = m.group_id
         JOIN ops.rule_version rv ON rv.id = g.rule_version_id
         WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
           AND m.member_role = 'BALANCE')),
  'revolver_positions', (SELECT count(DISTINCT position_id) FROM obs
     WHERE type_text = 'First Lien Secured Debt Revolver [Member]' AND continuity_state = 'MATCHED'
       AND id IN (SELECT position_observation_id FROM obs.position_observation_group_member m
         JOIN obs.position_observation_group g ON g.id = m.group_id
         JOIN ops.rule_version rv ON rv.id = g.rule_version_id
         WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
           AND m.member_role = 'BALANCE')),
  'first_lien_two_instruments', (SELECT count(DISTINCT instrument_id) FROM obs
     WHERE type_text = 'First Lien Secured Debt Two [Member]' AND instrument_state = 'MATCHED'
       AND id IN (SELECT position_observation_id FROM obs.position_observation_group_member m
         JOIN obs.position_observation_group g ON g.id = m.group_id
         JOIN ops.rule_version rv ON rv.id = g.rule_version_id
         WHERE rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)} AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
           AND m.member_role = 'BALANCE')),
  'shared_first_lien_and_revolver_instruments', (SELECT count(*) FROM (
     SELECT instrument_id FROM obs WHERE type_text = 'First Lien Secured Debt [Member]' AND instrument_id IS NOT NULL
     INTERSECT
     SELECT instrument_id FROM obs WHERE type_text = 'First Lien Secured Debt Revolver [Member]' AND instrument_id IS NOT NULL
  ) x),
  'shared_first_lien_and_two_instruments', (SELECT count(*) FROM (
     SELECT instrument_id FROM obs WHERE type_text = 'First Lien Secured Debt [Member]' AND instrument_id IS NOT NULL
     INTERSECT
     SELECT instrument_id FROM obs WHERE type_text = 'First Lien Secured Debt Two [Member]' AND instrument_id IS NOT NULL
  ) x),
  'controlled_decisions', (SELECT count(*) FROM obs
     WHERE type_text = 'Controlled Investments [Member]' AND (instrument_state IS NOT NULL OR continuity_state IS NOT NULL)),
  'first_lien_one_decisions', (SELECT count(*) FROM obs
     WHERE type_text = 'First Lien Secured Debt One [Member]' AND (instrument_state IS NOT NULL OR continuity_state IS NOT NULL)),
  'preferred_equity', (SELECT coalesce(json_agg(json_build_object('instrument_id', instrument_id, 'position_id', position_id, 'instrument_state', instrument_state) ORDER BY id), '[]'::json)
     FROM obs WHERE type_text = 'Preferred Equity [Member]'),
  'preferred_stock', (SELECT coalesce(json_agg(json_build_object('instrument_id', instrument_id, 'position_id', position_id, 'instrument_state', instrument_state) ORDER BY id), '[]'::json)
     FROM obs WHERE type_text = 'Preferred Stock')
)::text;`);
}

function assertReady(scope, candidates) {
  const failures = [];
  if (candidates.length !== EXPECTED_CANDIDATES) failures.push(`candidates=${candidates.length}`);
  if (Number(scope.candidates) !== EXPECTED_CANDIDATES) failures.push(`scope candidates=${scope.candidates}`);
  if (Number(scope.distinct_candidates) !== EXPECTED_CANDIDATES) failures.push("candidate ids are not distinct");
  if (Number(scope.extracted_names) !== EXPECTED_CANDIDATES) failures.push(`extracted names=${scope.extracted_names}`);
  if (Number(scope.matchable) !== EXPECTED_CANDIDATES) failures.push(`matchable=${scope.matchable}`);
  if (Number(scope.endpoint_paired_outside) !== 0) failures.push(`endpoint paired outside the candidate set=${scope.endpoint_paired_outside}`);
  if (Number(scope.instrument_heads) === 0 && Number(scope.endpoint_overlap) !== 0) {
    failures.push(`endpoint overlap=${scope.endpoint_overlap}`);
  }
  if (Number(scope.non_balance_overlap) !== 0) failures.push(`non-balance overlap=${scope.non_balance_overlap}`);
  if (Number(scope.external_key_collisions) !== 0) failures.push(`external key collisions=${scope.external_key_collisions}`);
  if (Number(scope.sibling_instrument_decisions) !== 0) failures.push(`sibling instrument decisions=${scope.sibling_instrument_decisions}`);
  if (Number(scope.sibling_continuity_decisions) !== 0) failures.push(`sibling continuity decisions=${scope.sibling_continuity_decisions}`);
  if (Number(scope.spread_members) !== 418) failures.push(`spread members=${scope.spread_members}`);
  if (Number(scope.pik_members) !== 3) failures.push(`pik members=${scope.pik_members}`);
  if (Number(scope.duplicate_instrument_heads) !== 0 || Number(scope.duplicate_continuity_heads) !== 0) {
    failures.push("duplicate decision heads");
  }
  const decided = Number(scope.instrument_heads);
  const continuity = Number(scope.continuity_heads);
  if (!((decided === 0 && continuity === 0) || (decided === EXPECTED_CANDIDATES && continuity === EXPECTED_CANDIDATES))) {
    failures.push(`instrument heads=${decided} continuity heads=${continuity}`);
  }
  if (failures.length > 0) throw new Error(`balance-candidate P7 refused to write: ${failures.join("; ")}`);
  return decided === 0 ? "insert" : "idempotent";
}

function assertSeries(proof) {
  const failures = [];
  for (const [key, expected] of [
    ["matched_instrument_decisions", EXPECTED_CANDIDATES],
    ["matched_continuity_decisions", EXPECTED_CANDIDATES],
    ["distinct_instruments", EXPECTED_INSTRUMENTS],
    ["distinct_positions", EXPECTED_POSITIONS],
    ["multi_date_positions", EXPECTED_MULTI_DATE],
    ["single_date_positions", EXPECTED_SINGLE_DATE],
    ["other_positions", 0],
  ]) {
    if (Number(proof[key]) !== expected) failures.push(`${key}=${proof[key]}`);
  }
  if (failures.length > 0) throw new Error(`balance-candidate P7 series check failed: ${failures.join("; ")}`);
}

function assertChyron(before, after) {
  const failures = [];
  if (Number(after.first_lien_instruments) !== 1 || Number(after.first_lien_positions) !== 1 || Number(after.first_lien_dates) !== 2) {
    failures.push(`first lien instruments=${after.first_lien_instruments} positions=${after.first_lien_positions} dates=${after.first_lien_dates}`);
  }
  if (Number(after.revolver_instruments) !== 1 || Number(after.revolver_positions) !== 1) {
    failures.push(`revolver instruments=${after.revolver_instruments} positions=${after.revolver_positions}`);
  }
  if (Number(after.first_lien_two_instruments) !== 1) failures.push(`first lien two instruments=${after.first_lien_two_instruments}`);
  if (Number(after.shared_first_lien_and_revolver_instruments) !== 0) failures.push("First Lien and Revolver share an instrument");
  if (Number(after.shared_first_lien_and_two_instruments) !== 0) failures.push("First Lien and First Lien Two share an instrument");
  if (Number(after.controlled_decisions) !== 0) failures.push(`controlled decisions=${after.controlled_decisions}`);
  if (Number(after.first_lien_one_decisions) !== 0) failures.push(`first lien one decisions=${after.first_lien_one_decisions}`);
  if (JSON.stringify(before.preferred_equity) !== JSON.stringify(after.preferred_equity)) failures.push("Preferred Equity changed");
  if (JSON.stringify(before.preferred_stock) !== JSON.stringify(after.preferred_stock)) failures.push("Preferred Stock changed");
  if (failures.length > 0) throw new Error(`balance-candidate P7 ChyronHego check failed: ${failures.join("; ")}`);
}

export function applyP7ToBalanceCandidates({ database = DEFAULT_DATABASE, dryRun = false, log = console.log } = {}) {
  assertLocal(database);
  const candidates = loadBalanceFactGroupCandidates(database);
  const scope = candidateFacts(database);
  const mode = assertReady(scope, candidates);
  const summary = {
    candidates: candidates.length,
    mode,
    externalKeyCollisions: Number(scope.external_key_collisions),
    dryRun,
  };
  if (dryRun) {
    log(JSON.stringify(summary));
    return summary;
  }
  const before = isolationSnapshot(database);
  const chyronBefore = chyronProof(database);
  if (before.legacy_comparisons !== 42 || before.legacy_comparisons_changed !== 26 || before.legacy_comparison_positions !== 42) {
    throw new Error(`balance-candidate P7 refused unexpected comparison totals: ${JSON.stringify({
      legacy_comparisons: before.legacy_comparisons,
      legacy_comparisons_changed: before.legacy_comparisons_changed,
      legacy_comparison_positions: before.legacy_comparison_positions,
    })}`);
  }
  if (mode === "insert" && before.comparisons !== 42) {
    throw new Error(`balance-candidate P7 refused to insert while comparison rows are already ${before.comparisons}`);
  }
  if (before.fact_groups !== EXPECTED_CANDIDATES || before.fact_group_members !== 839 || before.position_observations !== 1442423) {
    throw new Error(`balance-candidate P7 refused unexpected stored totals: ${JSON.stringify({
      fact_groups: before.fact_groups,
      fact_group_members: before.fact_group_members,
      position_observations: before.position_observations,
    })}`);
  }
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('P7_BALANCE_FACT_GROUP', ${lit(pipelineCodeVersion())},
        jsonb_build_object('candidates', ${num(candidates.length)}, 'mode', ${lit(mode)}),
        now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  try {
    const inserted = applyP7BalanceCandidateWrite({
      database,
      positionObservationIds: candidates.map((row) => row.id),
      runId,
    });
    const proof = seriesProof(database);
    const afterScope = candidateFacts(database);
    const after = isolationSnapshot(database, before.prior_position_ids);
    const chyronAfter = chyronProof(database);
    assertSeries(proof);
    assertChyron(chyronBefore, chyronAfter);
    if (Number(afterScope.sibling_instrument_decisions) !== 0 || Number(afterScope.sibling_continuity_decisions) !== 0) {
      throw new Error("balance-candidate P7 wrote a decision for a non-balance fact-group member");
    }
    if (Number(afterScope.duplicate_instrument_heads) !== 0 || Number(afterScope.duplicate_continuity_heads) !== 0) {
      throw new Error("balance-candidate P7 created duplicate decision heads");
    }
    const expectedInserted = mode === "insert" ? EXPECTED_CANDIDATES : 0;
    if (inserted.instrument_matched_inserted !== expectedInserted || inserted.continuity_matched_inserted !== expectedInserted) {
      throw new Error(`inserted instrument=${inserted.instrument_matched_inserted} continuity=${inserted.continuity_matched_inserted}`);
    }
    if (inserted.instrument_unresolved_inserted !== 0 || inserted.continuity_unresolved_inserted !== 0) {
      throw new Error("balance-candidate P7 inserted an unresolved decision");
    }
    if (mode === "insert" && (inserted.instruments_created !== EXPECTED_INSTRUMENTS || inserted.positions_created !== EXPECTED_POSITIONS)) {
      throw new Error(`created instruments=${inserted.instruments_created} positions=${inserted.positions_created}`);
    }
    if (mode === "idempotent" && (inserted.instruments_created !== 0 || inserted.positions_created !== 0)) {
      throw new Error(`idempotent run created instruments=${inserted.instruments_created} positions=${inserted.positions_created}`);
    }
    const preserved = [
      "fact_groups", "fact_group_members", "position_observations", "borrower_names",
      "prior_comparisons", "prior_comparison_positions", "prior_comparisons_changed", "prior_comparison_fingerprint",
      "legacy_comparisons", "legacy_comparison_positions", "legacy_comparisons_changed", "legacy_comparison_fingerprint",
    ];
    const changed = preserved.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (changed.length > 0) throw new Error(`balance-candidate P7 changed ${changed.join(", ")}`);
    if (mode === "insert") {
      if (after.instrument_decisions !== before.instrument_decisions + EXPECTED_CANDIDATES) {
        throw new Error(`instrument decisions ${before.instrument_decisions} -> ${after.instrument_decisions}`);
      }
      if (after.continuity_decisions !== before.continuity_decisions + EXPECTED_CANDIDATES) {
        throw new Error(`continuity decisions ${before.continuity_decisions} -> ${after.continuity_decisions}`);
      }
      if (after.instruments !== before.instruments + EXPECTED_INSTRUMENTS || after.positions !== before.positions + EXPECTED_POSITIONS) {
        throw new Error(`instruments ${before.instruments} -> ${after.instruments}; positions ${before.positions} -> ${after.positions}`);
      }
    } else if (after.instrument_decisions !== before.instrument_decisions || after.continuity_decisions !== before.continuity_decisions
      || after.instruments !== before.instruments || after.positions !== before.positions) {
      throw new Error("idempotent run changed decision or identity totals");
    }
    const result = {
      ...summary,
      runId,
      instrumentDecisionsInserted: inserted.instrument_matched_inserted,
      continuityDecisionsInserted: inserted.continuity_matched_inserted,
      instrumentsCreated: inserted.instruments_created,
      positionsCreated: inserted.positions_created,
      distinctInstruments: Number(proof.distinct_instruments),
      distinctPositions: Number(proof.distinct_positions),
      multiDatePositions: Number(proof.multi_date_positions),
      singleDatePositions: Number(proof.single_date_positions),
      instrumentDecisions: after.instrument_decisions,
      continuityDecisions: after.continuity_decisions,
      comparisons: after.comparisons,
      priorComparisons: after.prior_comparisons,
      priorComparisonsChanged: after.prior_comparisons_changed,
    };
    queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(result))}::jsonb);`);
    log(JSON.stringify(result));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${num(runId)}, 'FAILED', now(), '{}'::jsonb, ${lit(message)});`);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  applyP7ToBalanceCandidates({ database, dryRun: args.includes("--dry-run") });
}
