// P6-min: Golden legal-entity resolution for an explicit list of position_observation ids.
// Inserts only. Never updates SOI, position, or field-value rows. No universe scan.
// MATCHED only on exact norm.borrower_name v1 equality. Near-name → candidate + UNRESOLVED.

import { IDENTIFIER_COLUMN } from "../normalize/borrower-name.mjs";
import { EXACT_METHOD, NEAR_NAME_METHOD, isExactNormalizedName, isNearNameCandidate } from "../normalize/entity-name-match.mjs";
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

export function snapshotP6Min(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  return parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'soi_row_observation_count', (SELECT count(*) FROM obs.soi_row_observation),
  'position_observation_count', (SELECT count(*) FROM obs.position_observation),
  'position_field_value_count', (SELECT count(*) FROM obs.position_field_value),
  'borrower_name_observation_count', (SELECT count(*) FROM obs.borrower_name_observation),
  'legal_entity_count', (SELECT count(*) FROM identity.legal_entity),
  'legal_entity_alias_count', (SELECT count(*) FROM identity.legal_entity_alias),
  'entity_resolution_count', (SELECT count(*) FROM resolution.entity_resolution_decision),
  'match_candidate_count', (SELECT count(*) FROM resolution.match_candidate),
  'economic_group_count', (SELECT count(*) FROM identity.economic_group),
  'group_membership_count', (SELECT count(*) FROM resolution.group_membership_decision),
  'instrument_resolution_count', (SELECT count(*) FROM resolution.instrument_resolution_decision),
  'max_soi_row_observation_id', (SELECT coalesce(max(id), 0) FROM obs.soi_row_observation),
  'max_position_observation_id', (SELECT coalesce(max(id), 0) FROM obs.position_observation),
  'max_position_field_value_id', (SELECT coalesce(max(id), 0) FROM obs.position_field_value),
  'golden_borrower_name_count', (
    SELECT count(*) FROM obs.borrower_name_observation WHERE position_observation_id IN (${list})),
  'golden_matched', (
    SELECT count(*) FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id IN (${list}) AND d.state = 'MATCHED'),
  'golden_unresolved', (
    SELECT count(*) FROM resolution.current_entity_resolution d
    JOIN obs.borrower_name_observation b ON b.id = d.borrower_name_observation_id
    WHERE b.position_observation_id IN (${list}) AND d.state = 'UNRESOLVED')
);`));
}

function sqlCoreName(expr) {
  const suffixes = "'INC','INCORPORATED','LLC','LTD','CORP','CORPORATION','HOLDINGS','HOLDCO','LP','LLP','CO','COMPANY'";
  return `nullif(btrim(array_to_string(ARRAY(
    SELECT tok FROM unnest(string_to_array(regexp_replace(upper(${expr}), '[^A-Z0-9]+', ' ', 'g'), ' ')) AS tok
    WHERE tok <> '' AND tok NOT IN (${suffixes})
  ), ' ')), '')`;
}

export function listSameFilingNearNameControls(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) return [];
  const list = ids.join(",");
  const coreG = sqlCoreName("g.n");
  const coreO = sqlCoreName("btrim(normalize(s.identifier_raw, NFC))");
  const parsed = parseJsonCell(queryRows(database, `
WITH golden AS (
  SELECT DISTINCT b.normalized_text AS n
  FROM obs.borrower_name_observation b
  WHERE b.position_observation_id IN (${list})
    AND b.extraction_state = 'EXTRACTED'
    AND b.normalized_text IS NOT NULL
)
SELECT coalesce(json_agg(x.position_observation_id ORDER BY x.position_observation_id), '[]'::json)
FROM (
  SELECT MIN(o.id) AS position_observation_id
  FROM obs.position_observation p
  JOIN obs.position_observation o ON o.filing_id = p.filing_id
  JOIN obs.soi_row_observation s ON s.id = o.origin_soi_row_observation_id
  JOIN obs.borrower_name_observation bno ON bno.position_observation_id = o.id
    AND bno.extraction_state = 'EXTRACTED'
  CROSS JOIN golden g
  WHERE p.id IN (${list})
    AND o.id NOT IN (${list})
    AND s.identifier_raw IS NOT NULL AND btrim(s.identifier_raw) <> ''
    AND btrim(normalize(s.identifier_raw, NFC)) IS DISTINCT FROM g.n
    AND ${coreG} IS NOT NULL AND ${coreO} IS NOT NULL
    AND ${coreG} = ${coreO}
  GROUP BY ${coreO}
  LIMIT 1
) x;`));
  return (parsed ?? []).map(Number);
}

export function applyP6Min({
  database, positionObservationIds, runId, rules, identifierSha256,
  nearNamePositionObservationIds = [],
}) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) throw new Error("P6-min requires at least one position_observation_id");
  if (!/^[0-9a-f]{64}$/.test(identifierSha256)) throw new Error("identifierSha256 must be 64 hex chars");
  const exactRuleId = rules["resolution.entity_exact_normalized_name"];
  const nearRuleId = rules["resolution.entity_near_name_candidate"];
  if (!exactRuleId) throw new Error("missing rule id for resolution.entity_exact_normalized_name");
  if (!nearRuleId) throw new Error("missing rule id for resolution.entity_near_name_candidate");

  const nearIds = intIds(nearNamePositionObservationIds).filter((id) => !ids.includes(id));
  const list = ids.join(",");
  const sha = lit(identifierSha256);
  const col = lit(IDENTIFIER_COLUMN);

  const names = parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'n', count(*),
  'distinct_norm', count(DISTINCT b.normalized_text),
  'extracted', count(*) FILTER (WHERE b.extraction_state = 'EXTRACTED' AND b.normalized_text IS NOT NULL),
  'sha_ok', bool_and(encode(sha256(convert_to(b.raw_text, 'UTF8')), 'hex') = ${sha}),
  'sample_norm', (SELECT b2.normalized_text FROM obs.borrower_name_observation b2
                  WHERE b2.position_observation_id IN (${list})
                    AND b2.source_column_label = ${col}
                    AND b2.extraction_state = 'EXTRACTED'
                  ORDER BY b2.id LIMIT 1)
)
FROM obs.borrower_name_observation b
WHERE b.position_observation_id IN (${list})
  AND b.source_column_label = ${col};`));

  if (Number(names.n) !== ids.length) {
    throw new Error("P6-min requires a P4-min identifier-name observation for every Golden locator");
  }
  if (Number(names.extracted) !== ids.length || names.sha_ok !== true) {
    throw new Error("P6-min: Golden names must be EXTRACTED Stage A identifiers");
  }
  if (Number(names.distinct_norm) !== 1) {
    throw new Error("P6-min: Golden locators do not share one normalized name; MATCHED is not supported");
  }
  const goldenNorm = names.sample_norm;
  if (!goldenNorm) throw new Error("P6-min: missing Golden normalized name");

  const nearRows = nearIds.length === 0 ? [] : parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
         'bno_id', b.id,
         'position_observation_id', b.position_observation_id,
         'normalized_text', b.normalized_text,
         'evidence_id', b.evidence_id)
       ORDER BY b.id), '[]'::json)
FROM obs.borrower_name_observation b
WHERE b.position_observation_id IN (${nearIds.join(",")})
  AND b.extraction_state = 'EXTRACTED'
  AND b.normalized_text IS NOT NULL;`)) ?? [];

  const nearAccepted = [];
  for (const row of nearRows) {
    if (isExactNormalizedName(row.normalized_text, goldenNorm)) {
      throw new Error("P6-min: a near-name control has the Golden normalized name; it is not a negative control");
    }
    if (!isNearNameCandidate(row.normalized_text, goldenNorm)) continue;
    nearAccepted.push(row);
  }

  const nearCopy = nearAccepted.map((r) => [r.bno_id, r.evidence_id]);

  const sql = `
BEGIN;
CREATE TEMP TABLE _p6_po (id bigint PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE _p6_near (bno_id bigint PRIMARY KEY, evidence_id bigint NOT NULL) ON COMMIT DROP;
${copyBlock("_p6_po", ["id"], ids.map((id) => [id]))}
${copyBlock("_p6_near", ["bno_id", "evidence_id"], nearCopy)}

CREATE TEMP TABLE _p6_names ON COMMIT DROP AS
SELECT b.id AS bno_id, b.position_observation_id, b.normalized_text, b.evidence_id
FROM obs.borrower_name_observation b
JOIN _p6_po g ON g.id = b.position_observation_id
WHERE b.source_column_label = ${col}
  AND b.extraction_state = 'EXTRACTED';

DO $chk$
BEGIN
  IF (SELECT count(*) FROM _p6_names) <> (SELECT count(*) FROM _p6_po) THEN
    RAISE EXCEPTION 'P6-min: missing identifier-name observations';
  END IF;
  IF (SELECT count(DISTINCT normalized_text) FROM _p6_names) <> 1 THEN
    RAISE EXCEPTION 'P6-min: Golden names are not a single normalized value';
  END IF;
END
$chk$;

CREATE TEMP TABLE _p6_entity (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _p6_entity
SELECT d.legal_entity_id
FROM resolution.current_entity_resolution d
JOIN _p6_names n ON n.bno_id = d.borrower_name_observation_id
WHERE d.state = 'MATCHED' AND d.legal_entity_id IS NOT NULL
GROUP BY d.legal_entity_id
HAVING count(*) FILTER (WHERE d.method <> ${lit(EXACT_METHOD)}) = 0;

DO $one$
BEGIN
  IF (SELECT count(*) FROM _p6_entity) > 1 THEN
    RAISE EXCEPTION 'P6-min: Golden names already MATCHED to more than one legal entity';
  END IF;
END
$one$;

WITH ins_le AS (
  INSERT INTO identity.legal_entity (creation_reason, run_id)
  SELECT 'P6-min Golden legal entity from exact normalized borrower-name observations', ${num(runId)}
  WHERE NOT EXISTS (SELECT 1 FROM _p6_entity)
  RETURNING id
)
INSERT INTO _p6_entity SELECT id FROM ins_le;

DO $need$
BEGIN
  IF (SELECT count(*) FROM _p6_entity) <> 1 THEN
    RAISE EXCEPTION 'P6-min: expected exactly one Golden legal entity';
  END IF;
END
$need$;

INSERT INTO identity.legal_entity_alias (legal_entity_id, alias_text, verification_state, rule_version_id, evidence_id, run_id)
SELECT e.id, (SELECT normalized_text FROM _p6_names LIMIT 1), 'VERIFIED', ${num(exactRuleId)},
       (SELECT evidence_id FROM _p6_names ORDER BY bno_id LIMIT 1), ${num(runId)}
FROM _p6_entity e
WHERE NOT EXISTS (
  SELECT 1 FROM identity.legal_entity_alias a
  WHERE a.legal_entity_id = e.id AND a.alias_text = (SELECT normalized_text FROM _p6_names LIMIT 1)
    AND a.verification_state = 'VERIFIED'
    AND NOT EXISTS (SELECT 1 FROM identity.legal_entity_alias s WHERE s.supersedes_id = a.id));

WITH ins_m AS (
  INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, legal_entity_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT n.bno_id, e.id, 'MATCHED'::ref.resolution_state, ${lit(EXACT_METHOD)},
         'normalized_text equals the Golden identifier after norm.borrower_name v1 (NFC + btrim); no fuzzy or LLM',
         'SYSTEM_RULE'::ref.actor_kind, 'pipeline p6-min', now(), ${num(exactRuleId)}, n.evidence_id, ${num(runId)}
  FROM _p6_names n
  CROSS JOIN _p6_entity e
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.entity_resolution_decision d
    WHERE d.borrower_name_observation_id = n.bno_id
      AND NOT EXISTS (SELECT 1 FROM resolution.entity_resolution_decision s WHERE s.supersedes_id = d.id))
  RETURNING id
),
ins_c AS (
  INSERT INTO resolution.match_candidate (
      candidate_kind, borrower_name_observation_id, legal_entity_id, rule_version_id, run_id)
  SELECT 'LEGAL_ENTITY', n.bno_id, e.id, ${num(nearRuleId)}, ${num(runId)}
  FROM _p6_near n
  CROSS JOIN _p6_entity e
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.match_candidate c
    WHERE c.candidate_kind = 'LEGAL_ENTITY'
      AND c.borrower_name_observation_id = n.bno_id
      AND c.legal_entity_id = e.id
      AND c.rule_version_id = ${num(nearRuleId)})
  RETURNING id, borrower_name_observation_id
),
cmp AS (
  INSERT INTO resolution.match_candidate_comparison (
      match_candidate_id, attribute_code, outcome, left_evidence_id, right_evidence_id, rule_version_id, run_id)
  SELECT c.id, 'NORMALIZED_NAME', 'DISAGREE'::ref.comparison_outcome,
         n.evidence_id, (SELECT evidence_id FROM _p6_names ORDER BY bno_id LIMIT 1),
         ${num(nearRuleId)}, ${num(runId)}
  FROM ins_c c
  JOIN _p6_near n ON n.bno_id = c.borrower_name_observation_id
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.match_candidate_comparison x
    WHERE x.match_candidate_id = c.id AND x.attribute_code = 'NORMALIZED_NAME'
      AND x.rule_version_id = ${num(nearRuleId)})
  RETURNING match_candidate_id
),
dec AS (
  INSERT INTO resolution.entity_resolution_decision (
      borrower_name_observation_id, match_candidate_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT n.bno_id, c.id, 'UNRESOLVED'::ref.resolution_state, ${lit(NEAR_NAME_METHOD)},
         'normalized_text is not equal to the Golden identifier; corporate-suffix / Holdco difference is a candidate only and is not MATCHED',
         'SYSTEM_RULE'::ref.actor_kind, 'pipeline p6-min', now(), ${num(nearRuleId)}, n.evidence_id, ${num(runId)}
  FROM _p6_near n
  JOIN ins_c c ON c.borrower_name_observation_id = n.bno_id
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.entity_resolution_decision d
    WHERE d.borrower_name_observation_id = n.bno_id
      AND NOT EXISTS (SELECT 1 FROM resolution.entity_resolution_decision s WHERE s.supersedes_id = d.id))
  RETURNING id
)
SELECT json_build_object(
  'legal_entity_id', (SELECT id::text FROM _p6_entity),
  'matched_inserted', (SELECT count(*) FROM ins_m),
  'near_name_unresolved_inserted', (SELECT count(*) FROM dec),
  'near_name_candidates_inserted', (SELECT count(*) FROM ins_c),
  'near_name_comparisons_inserted', (SELECT count(*) FROM cmp),
  'economic_group_rows', (SELECT count(*) FROM identity.economic_group),
  'group_membership_rows', (SELECT count(*) FROM resolution.group_membership_decision)
);
COMMIT;`;

  const out = runScript(database, sql);
  const line = out.find((l) => l.startsWith("{"));
  const inserted = JSON.parse(line);
  return {
    legal_entity_id: inserted.legal_entity_id,
    matched_inserted: Number(inserted.matched_inserted ?? 0),
    near_name_unresolved_inserted: Number(inserted.near_name_unresolved_inserted ?? 0),
    near_name_candidates_inserted: Number(inserted.near_name_candidates_inserted ?? 0),
    near_name_controls_considered: nearAccepted.length,
    economic_group_rows: Number(inserted.economic_group_rows ?? 0),
    group_membership_rows: Number(inserted.group_membership_rows ?? 0),
  };
}

export function goldenEntityReport(database, positionObservationIds, legalEntityId) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  const entityLit = legalEntityId ? lit(legalEntityId) : "NULL";
  return parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'legal_entity_exists', EXISTS (SELECT 1 FROM identity.legal_entity WHERE id = ${entityLit}::uuid),
  'alias_cik_like', (
    SELECT count(*) FROM identity.legal_entity_alias a
    WHERE a.legal_entity_id = ${entityLit}::uuid AND a.alias_text ~ '^[0-9]{10}$'),
  'identity_cik_columns', (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'identity' AND column_name ILIKE '%cik%'),
  'golden_decision_problems', (
    SELECT count(*) FROM obs.borrower_name_observation bno
    JOIN unnest(ARRAY[${list}]) AS g(id) ON g.id = bno.position_observation_id
    LEFT JOIN resolution.current_entity_resolution d ON d.borrower_name_observation_id = bno.id
    WHERE d.id IS NULL
       OR (d.state = 'UNRESOLVED' AND d.legal_entity_id IS NOT NULL)
       OR (d.state <> 'UNRESOLVED' AND d.legal_entity_id IS NULL)
       OR d.state NOT IN ('MATCHED','PROBABLE','UNRESOLVED','REJECTED')),
  'golden_matched_to_entity', (
    SELECT count(*) FROM obs.borrower_name_observation bno
    JOIN unnest(ARRAY[${list}]) AS g(id) ON g.id = bno.position_observation_id
    JOIN resolution.current_entity_resolution d ON d.borrower_name_observation_id = bno.id
    WHERE d.state = 'MATCHED' AND d.legal_entity_id = ${entityLit}::uuid
      AND d.method = ${lit(EXACT_METHOD)} AND d.actor_kind = 'SYSTEM_RULE'),
  'golden_matched_other_entity', (
    SELECT count(*) FROM obs.borrower_name_observation bno
    JOIN unnest(ARRAY[${list}]) AS g(id) ON g.id = bno.position_observation_id
    JOIN resolution.current_entity_resolution d ON d.borrower_name_observation_id = bno.id
    WHERE d.state = 'MATCHED' AND d.legal_entity_id IS DISTINCT FROM ${entityLit}::uuid),
  'fuzzy_matched', (
    SELECT count(*) FROM resolution.current_entity_resolution d
    WHERE d.state = 'MATCHED' AND (d.method ILIKE '%fuzzy%' OR d.method ILIKE '%llm%')),
  'near_name_unresolved', (
    SELECT count(*) FROM resolution.current_entity_resolution d
    WHERE d.state = 'UNRESOLVED' AND d.method = ${lit(NEAR_NAME_METHOD)} AND d.legal_entity_id IS NULL),
  'near_name_candidates', (
    SELECT count(*) FROM resolution.match_candidate c
    WHERE c.candidate_kind = 'LEGAL_ENTITY' AND c.legal_entity_id = ${entityLit}::uuid),
  'economic_groups', (SELECT count(*) FROM identity.economic_group),
  'group_membership', (SELECT count(*) FROM resolution.group_membership_decision),
  'head_forks', (
    SELECT count(*) FROM (
      SELECT d.borrower_name_observation_id
      FROM resolution.entity_resolution_decision d
      WHERE NOT EXISTS (SELECT 1 FROM resolution.entity_resolution_decision s WHERE s.supersedes_id = d.id)
      GROUP BY 1 HAVING count(*) > 1) x)
);`));
}
