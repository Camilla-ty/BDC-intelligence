// P7-min: Golden instrument resolution and per-registrant continuity for an explicit
// list of position_observation ids. Inserts only. No universe scan. No Q14 derivation.
// MATCHED instrument requires exact identifier plus a disclosed Investment Type Axis member.

import { randomUUID } from "node:crypto";
import { IDENTIFIER_COLUMN } from "../normalize/borrower-name.mjs";
import {
  INSTRUMENT_MATCH_METHOD, INSTRUMENT_UNRESOLVED_METHOD,
  CONTINUITY_MATCH_METHOD, CONTINUITY_UNRESOLVED_INSTRUMENT_METHOD,
  CONTINUITY_UNRESOLVED_REGISTRANT_METHOD,
  canMatchInstrument, instrumentKey, continuityGaps, observationCount,
} from "../normalize/instrument-identity.mjs";
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

export function snapshotP7Min(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  return parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'soi_row_observation_count', (SELECT count(*) FROM obs.soi_row_observation),
  'position_observation_count', (SELECT count(*) FROM obs.position_observation),
  'position_field_value_count', (SELECT count(*) FROM obs.position_field_value),
  'borrower_name_observation_count', (SELECT count(*) FROM obs.borrower_name_observation),
  'legal_entity_count', (SELECT count(*) FROM identity.legal_entity),
  'entity_resolution_count', (SELECT count(*) FROM resolution.entity_resolution_decision),
  'instrument_count', (SELECT count(*) FROM identity.instrument),
  'instrument_resolution_count', (SELECT count(*) FROM resolution.instrument_resolution_decision),
  'identity_position_count', (SELECT count(*) FROM identity.position),
  'position_continuity_count', (SELECT count(*) FROM resolution.position_continuity_decision),
  'economic_group_count', (SELECT count(*) FROM identity.economic_group),
  'derived_value_input_count', (SELECT count(*) FROM derived.derived_value_input),
  'max_soi_row_observation_id', (SELECT coalesce(max(id), 0) FROM obs.soi_row_observation),
  'max_position_observation_id', (SELECT coalesce(max(id), 0) FROM obs.position_observation),
  'max_position_field_value_id', (SELECT coalesce(max(id), 0) FROM obs.position_field_value),
  'golden_instrument_matched', (
    SELECT count(*) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'MATCHED'),
  'golden_instrument_unresolved', (
    SELECT count(*) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'UNRESOLVED'),
  'golden_continuity_matched', (
    SELECT count(*) FROM resolution.current_position_continuity d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'MATCHED')
);`));
}

function loadFacts(database, ids) {
  const list = ids.join(",");
  const col = lit(IDENTIFIER_COLUMN);
  return parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'position_observation_id', p.id,
  'evidence_id', p.evidence_id,
  'reported_date', p.reported_date,
  'identifier_norm', b.normalized_text,
  'identifier_raw', b.raw_text,
  'extraction_state', b.extraction_state,
  'type_state', coalesce(fv.value_state, 'UNKNOWN'),
  'type_text', fv.raw_value,
  'registrant_id', CASE WHEN fr.registrant_link_status = 'LINKED' THEN fr.registrant_id ELSE NULL END,
  'registrant_link_status', fr.registrant_link_status
) ORDER BY p.id), '[]'::json)
FROM obs.position_observation p
JOIN unnest(ARRAY[${list}]) AS g(id) ON g.id = p.id
LEFT JOIN LATERAL (
  SELECT b.normalized_text, b.raw_text, b.extraction_state
  FROM obs.borrower_name_observation b
  WHERE b.position_observation_id = p.id AND b.source_column_label = ${col}
    AND b.extraction_state = 'EXTRACTED'
  ORDER BY b.id LIMIT 1
) b ON true
LEFT JOIN LATERAL (
  SELECT fv.value_state, fv.raw_value
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = p.id AND fv.field_code = 'INSTRUMENT_TYPE'
  ORDER BY fv.id LIMIT 1
) fv ON true
LEFT JOIN LATERAL (
  SELECT fr.registrant_id, fr.registrant_link_status
  FROM registry.current_filing_registrant fr
  WHERE fr.filing_id = p.filing_id
  ORDER BY CASE WHEN fr.registrant_link_status = 'LINKED' THEN 0 ELSE 1 END, fr.registrant_id
  LIMIT 1
) fr ON true;`)) ?? [];
}

function loadExistingInstrumentKeys(database) {
  const col = lit(IDENTIFIER_COLUMN);
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'ident', b.normalized_text,
  'type_text', fv.raw_value,
  'instrument_id', d.instrument_id
)), '[]'::json)
FROM resolution.current_instrument_resolution d
JOIN obs.borrower_name_observation b
  ON b.position_observation_id = d.position_observation_id AND b.source_column_label = ${col}
 AND b.extraction_state = 'EXTRACTED'
JOIN obs.current_position_field_value fv
  ON fv.position_observation_id = d.position_observation_id AND fv.field_code = 'INSTRUMENT_TYPE'
WHERE d.state = 'MATCHED' AND d.method = ${lit(INSTRUMENT_MATCH_METHOD)}
  AND d.instrument_id IS NOT NULL
  AND fv.value_state = 'REPORTED' AND coalesce(fv.raw_value, '') <> '';`)) ?? [];
  const map = new Map();
  for (const row of parsed) {
    const key = instrumentKey(row.ident, row.type_text);
    if (map.has(key) && map.get(key) !== row.instrument_id) {
      throw new Error("P7-min: existing MATCHED decisions map one identifier+type to more than one instrument");
    }
    map.set(key, row.instrument_id);
  }
  return map;
}

function loadExistingPositions(database) {
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'registrant_id', pos.registrant_id,
  'instrument_id', ir.instrument_id,
  'position_id', d.position_id
)), '[]'::json)
FROM resolution.current_position_continuity d
JOIN identity.position pos ON pos.id = d.position_id
JOIN resolution.current_instrument_resolution ir
  ON ir.position_observation_id = d.position_observation_id
WHERE d.state = 'MATCHED' AND d.method = ${lit(CONTINUITY_MATCH_METHOD)}
  AND ir.state = 'MATCHED' AND ir.instrument_id IS NOT NULL;`)) ?? [];
  const map = new Map();
  for (const row of parsed) {
    const key = `${row.registrant_id}\u0000${row.instrument_id}`;
    if (map.has(key) && map.get(key) !== row.position_id) {
      throw new Error("P7-min: existing MATCHED continuity maps one registrant+instrument to more than one position");
    }
    map.set(key, row.position_id);
  }
  return map;
}

export function applyP7Min({ database, positionObservationIds, runId, rules, identifierSha256 = null }) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) throw new Error("P7-min requires at least one position_observation_id");
  if (identifierSha256 != null && !/^[0-9a-f]{64}$/.test(identifierSha256)) {
    throw new Error("identifierSha256 must be 64 hex chars");
  }
  const instMatchRule = rules["resolution.instrument_exact_identifier_and_type"];
  const instUnresRule = rules["resolution.instrument_unknown_attributes"];
  const contMatchRule = rules["resolution.position_same_registrant_and_instrument"];
  const contUnresRule = rules["resolution.position_unresolved_without_instrument"];
  if (!instMatchRule || !instUnresRule || !contMatchRule || !contUnresRule) {
    throw new Error("P7-min: missing instrument/continuity rule ids");
  }

  const facts = loadFacts(database, ids);
  if (facts.length !== ids.length) {
    throw new Error(`P7-min: expected ${ids.length} locator facts, got ${facts.length}`);
  }
  for (const row of facts) {
    if (!row.identifier_norm || row.extraction_state !== "EXTRACTED") {
      throw new Error("P7-min requires a P4-min identifier-name observation for every locator");
    }
  }
  if (identifierSha256) {
    const shaRows = queryRows(database, `
SELECT bool_and(encode(sha256(convert_to(b.raw_text, 'UTF8')), 'hex') = ${lit(identifierSha256)})
FROM obs.borrower_name_observation b
WHERE b.position_observation_id IN (${ids.join(",")})
  AND b.source_column_label = ${lit(IDENTIFIER_COLUMN)};`);
    if (shaRows[0][0] !== "t") throw new Error("P7-min: Golden names must be Stage A identifiers");
  }

  const existingInst = loadExistingInstrumentKeys(database);
  const existingPos = loadExistingPositions(database);
  const newInstruments = [];
  const newPositions = [];
  const instMatched = [];
  const instUnresolved = [];
  const contMatched = [];
  const contUnresolved = [];
  const seriesDates = new Map();

  for (const row of facts) {
    const matchable = canMatchInstrument({
      identifierNorm: row.identifier_norm,
      typeState: row.type_state,
      typeText: row.type_text,
    });
    if (matchable) {
      const key = instrumentKey(row.identifier_norm, row.type_text);
      let instrumentId = existingInst.get(key);
      if (!instrumentId) {
        instrumentId = randomUUID();
        existingInst.set(key, instrumentId);
        newInstruments.push([instrumentId, row.identifier_norm, row.type_text]);
      }
      instMatched.push([row.position_observation_id, instrumentId, row.evidence_id]);
      if (row.registrant_id != null) {
        const pkey = `${row.registrant_id}\u0000${instrumentId}`;
        let positionId = existingPos.get(pkey);
        if (!positionId) {
          positionId = randomUUID();
          existingPos.set(pkey, positionId);
          newPositions.push([positionId, row.registrant_id]);
        }
        contMatched.push([row.position_observation_id, positionId, row.evidence_id]);
        if (!seriesDates.has(positionId)) seriesDates.set(positionId, []);
        seriesDates.get(positionId).push(row.reported_date);
      } else {
        contUnresolved.push([
          row.position_observation_id, row.evidence_id, CONTINUITY_UNRESOLVED_REGISTRANT_METHOD,
          "filing registrant is not a single LINKED registry.current_filing_registrant row; continuity is not MATCHED",
        ]);
      }
    } else {
      instUnresolved.push([row.position_observation_id, row.evidence_id]);
      contUnresolved.push([
        row.position_observation_id, row.evidence_id, CONTINUITY_UNRESOLVED_INSTRUMENT_METHOD,
        "instrument identity is UNRESOLVED; continuity is not manufactured",
      ]);
    }
  }

  const sql = `
BEGIN;
CREATE TEMP TABLE _p7_new_inst (id uuid PRIMARY KEY, ident text NOT NULL, type_text text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_new_pos (id uuid PRIMARY KEY, registrant_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_im (po_id bigint PRIMARY KEY, instrument_id uuid NOT NULL, evidence_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_iu (po_id bigint PRIMARY KEY, evidence_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_cm (po_id bigint PRIMARY KEY, position_id uuid NOT NULL, evidence_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_cu (po_id bigint PRIMARY KEY, evidence_id bigint NOT NULL, method text NOT NULL, rationale text NOT NULL) ON COMMIT DROP;
${copyBlock("_p7_new_inst", ["id", "ident", "type_text"], newInstruments)}
${copyBlock("_p7_new_pos", ["id", "registrant_id"], newPositions)}
${copyBlock("_p7_im", ["po_id", "instrument_id", "evidence_id"], instMatched)}
${copyBlock("_p7_iu", ["po_id", "evidence_id"], instUnresolved)}
${copyBlock("_p7_cm", ["po_id", "position_id", "evidence_id"], contMatched)}
${copyBlock("_p7_cu", ["po_id", "evidence_id", "method", "rationale"], contUnresolved)}

INSERT INTO identity.instrument (id, creation_reason, run_id)
SELECT id, 'P7-min instrument from exact identifier and disclosed Investment Type Axis member', ${num(runId)}
FROM _p7_new_inst
WHERE NOT EXISTS (SELECT 1 FROM identity.instrument e WHERE e.id = _p7_new_inst.id);

INSERT INTO identity.position (id, registrant_id, creation_reason, run_id)
SELECT id, registrant_id, 'P7-min per-registrant continuity series for a MATCHED instrument', ${num(runId)}
FROM _p7_new_pos
WHERE NOT EXISTS (SELECT 1 FROM identity.position e WHERE e.id = _p7_new_pos.id);

WITH ins AS (
  INSERT INTO resolution.instrument_resolution_decision (
      position_observation_id, instrument_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT m.po_id, m.instrument_id, 'MATCHED'::ref.resolution_state, ${lit(INSTRUMENT_MATCH_METHOD)},
         'exact identifier after norm.borrower_name v1 and disclosed Investment Type Axis member; not merged from legal entity alone; no fuzzy or LLM',
         'SYSTEM_RULE'::ref.actor_kind, 'pipeline p7-min', now(), ${num(instMatchRule)}, m.evidence_id, ${num(runId)}
  FROM _p7_im m
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.instrument_resolution_decision d
    WHERE d.position_observation_id = m.po_id
      AND NOT EXISTS (SELECT 1 FROM resolution.instrument_resolution_decision s WHERE s.supersedes_id = d.id))
  RETURNING id
),
ins_u AS (
  INSERT INTO resolution.instrument_resolution_decision (
      position_observation_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT u.po_id, 'UNRESOLVED'::ref.resolution_state, ${lit(INSTRUMENT_UNRESOLVED_METHOD)},
         'Investment Type Axis is not a non-empty REPORTED member; instrument identity stays UNKNOWN/UNRESOLVED',
         'SYSTEM_RULE'::ref.actor_kind, 'pipeline p7-min', now(), ${num(instUnresRule)}, u.evidence_id, ${num(runId)}
  FROM _p7_iu u
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.instrument_resolution_decision d
    WHERE d.position_observation_id = u.po_id
      AND NOT EXISTS (SELECT 1 FROM resolution.instrument_resolution_decision s WHERE s.supersedes_id = d.id))
  RETURNING id
),
ins_c AS (
  INSERT INTO resolution.position_continuity_decision (
      position_observation_id, position_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT m.po_id, m.position_id, 'MATCHED'::ref.resolution_state, ${lit(CONTINUITY_MATCH_METHOD)},
         'same LINKED filing registrant and same MATCHED instrument; different registrants stay separate series',
         'SYSTEM_RULE'::ref.actor_kind, 'pipeline p7-min', now(), ${num(contMatchRule)}, m.evidence_id, ${num(runId)}
  FROM _p7_cm m
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.position_continuity_decision d
    WHERE d.position_observation_id = m.po_id
      AND NOT EXISTS (SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = d.id))
  RETURNING id
),
ins_cu AS (
  INSERT INTO resolution.position_continuity_decision (
      position_observation_id, state, method, rationale, actor_kind,
      decided_by, decided_at, rule_version_id, evidence_id, run_id)
  SELECT u.po_id, 'UNRESOLVED'::ref.resolution_state, u.method, u.rationale,
         'SYSTEM_RULE'::ref.actor_kind, 'pipeline p7-min', now(), ${num(contUnresRule)}, u.evidence_id, ${num(runId)}
  FROM _p7_cu u
  WHERE NOT EXISTS (
    SELECT 1 FROM resolution.position_continuity_decision d
    WHERE d.position_observation_id = u.po_id
      AND NOT EXISTS (SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = d.id))
  RETURNING id
)
SELECT json_build_object(
  'instruments_created', (SELECT count(*) FROM _p7_new_inst),
  'positions_created', (SELECT count(*) FROM _p7_new_pos),
  'instrument_matched_inserted', (SELECT count(*) FROM ins),
  'instrument_unresolved_inserted', (SELECT count(*) FROM ins_u),
  'continuity_matched_inserted', (SELECT count(*) FROM ins_c),
  'continuity_unresolved_inserted', (SELECT count(*) FROM ins_cu)
);
COMMIT;`;

  const out = runScript(database, sql);
  const line = out.find((l) => l.startsWith("{"));
  const inserted = JSON.parse(line);

  const series = [];
  for (const [positionId, dates] of seriesDates) {
    const gaps = continuityGaps(dates);
    series.push({
      position_id: positionId,
      n_observations: observationCount(dates.length),
      n_dates: gaps.observed.length,
      n_gaps: gaps.missing.length,
    });
  }

  return {
    instruments_created: Number(inserted.instruments_created ?? 0),
    positions_created: Number(inserted.positions_created ?? 0),
    instrument_matched_inserted: Number(inserted.instrument_matched_inserted ?? 0),
    instrument_unresolved_inserted: Number(inserted.instrument_unresolved_inserted ?? 0),
    continuity_matched_inserted: Number(inserted.continuity_matched_inserted ?? 0),
    continuity_unresolved_inserted: Number(inserted.continuity_unresolved_inserted ?? 0),
    distinct_matched_instruments: new Set(instMatched.map((r) => r[1])).size,
    distinct_continuity_series: seriesDates.size,
    series_gap_dates: series.reduce((n, s) => n + s.n_gaps, 0),
    series,
  };
}

export function goldenInstrumentReport(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  return parseJsonCell(queryRows(database, `
SELECT json_build_object(
  'identity_cik_columns', (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'identity' AND column_name ILIKE '%cik%'),
  'instrument_decision_problems', (
    SELECT count(*) FROM unnest(ARRAY[${list}]) AS g(id)
    LEFT JOIN resolution.current_instrument_resolution d ON d.position_observation_id = g.id
    WHERE d.id IS NULL
       OR (d.state = 'UNRESOLVED' AND d.instrument_id IS NOT NULL)
       OR (d.state <> 'UNRESOLVED' AND d.instrument_id IS NULL)
       OR d.state NOT IN ('MATCHED','PROBABLE','UNRESOLVED','REJECTED')),
  'continuity_decision_problems', (
    SELECT count(*) FROM unnest(ARRAY[${list}]) AS g(id)
    LEFT JOIN resolution.current_position_continuity d ON d.position_observation_id = g.id
    WHERE d.id IS NULL
       OR (d.state = 'UNRESOLVED' AND d.position_id IS NOT NULL)
       OR (d.state <> 'UNRESOLVED' AND d.position_id IS NULL)
       OR d.state NOT IN ('MATCHED','PROBABLE','UNRESOLVED','REJECTED')),
  'instrument_matched', (
    SELECT count(*) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'MATCHED'
      AND d.method = ${lit(INSTRUMENT_MATCH_METHOD)} AND d.actor_kind = 'SYSTEM_RULE'),
  'instrument_unresolved', (
    SELECT count(*) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'UNRESOLVED'
      AND d.method = ${lit(INSTRUMENT_UNRESOLVED_METHOD)} AND d.instrument_id IS NULL),
  'distinct_matched_instruments', (
    SELECT count(DISTINCT d.instrument_id) FROM resolution.current_instrument_resolution d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'MATCHED' AND d.instrument_id IS NOT NULL),
  'continuity_matched', (
    SELECT count(*) FROM resolution.current_position_continuity d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'MATCHED'
      AND d.method = ${lit(CONTINUITY_MATCH_METHOD)} AND d.actor_kind = 'SYSTEM_RULE'),
  'continuity_unresolved', (
    SELECT count(*) FROM resolution.current_position_continuity d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'UNRESOLVED' AND d.position_id IS NULL),
  'distinct_continuity_series', (
    SELECT count(DISTINCT d.position_id) FROM resolution.current_position_continuity d
    WHERE d.position_observation_id IN (${list}) AND d.state = 'MATCHED' AND d.position_id IS NOT NULL),
  'cross_bdc_series_merge', (
    SELECT count(*) FROM (
      SELECT d.position_id, count(DISTINCT fr.registrant_id) AS n
      FROM resolution.current_position_continuity d
      JOIN obs.position_observation p ON p.id = d.position_observation_id
      JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id
      WHERE d.position_observation_id IN (${list}) AND d.state = 'MATCHED' AND d.position_id IS NOT NULL
      GROUP BY d.position_id HAVING count(DISTINCT fr.registrant_id) > 1) x),
  'fuzzy_matched', (
    SELECT count(*) FROM (
      SELECT method FROM resolution.current_instrument_resolution WHERE state = 'MATCHED'
      UNION ALL
      SELECT method FROM resolution.current_position_continuity WHERE state = 'MATCHED') m
    WHERE m.method ILIKE '%fuzzy%' OR m.method ILIKE '%llm%'),
  'instrument_head_forks', (
    SELECT count(*) FROM (
      SELECT d.position_observation_id FROM resolution.instrument_resolution_decision d
      WHERE NOT EXISTS (SELECT 1 FROM resolution.instrument_resolution_decision s WHERE s.supersedes_id = d.id)
      GROUP BY 1 HAVING count(*) > 1) x),
  'continuity_head_forks', (
    SELECT count(*) FROM (
      SELECT d.position_observation_id FROM resolution.position_continuity_decision d
      WHERE NOT EXISTS (SELECT 1 FROM resolution.position_continuity_decision s WHERE s.supersedes_id = d.id)
      GROUP BY 1 HAVING count(*) > 1) x),
  'economic_groups', (SELECT count(*) FROM identity.economic_group),
  'q14_derived_inputs', (
    SELECT count(*) FROM derived.derived_value_input i
    JOIN obs.position_field_value fv ON fv.id = i.field_value_id
    WHERE fv.field_code IN ('COST','FAIR_VALUE')),
  'coverage_holes', (
    SELECT count(*) FROM (
      SELECT r.registrant_id, dt.reported_date
      FROM (SELECT DISTINCT fr.registrant_id
            FROM obs.position_observation p
            JOIN unnest(ARRAY[${list}]) AS g(id) ON g.id = p.id
            JOIN registry.current_filing_registrant fr ON fr.filing_id = p.filing_id
            WHERE fr.registrant_link_status = 'LINKED') r
      CROSS JOIN (SELECT DISTINCT p.reported_date
                  FROM obs.position_observation p
                  JOIN unnest(ARRAY[${list}]) AS g(id) ON g.id = p.id
                  WHERE p.reported_date IS NOT NULL) dt
      WHERE NOT EXISTS (
        SELECT 1 FROM obs.position_observation p2
        JOIN unnest(ARRAY[${list}]) AS g2(id) ON g2.id = p2.id
        JOIN registry.current_filing_registrant fr2 ON fr2.filing_id = p2.filing_id
        WHERE fr2.registrant_id = r.registrant_id AND p2.reported_date = dt.reported_date
          AND fr2.registrant_link_status = 'LINKED')
    ) holes),
  'zero_field_values_on_holes', 0
);`));
}
