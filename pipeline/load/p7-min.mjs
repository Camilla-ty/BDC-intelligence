// P7-min: Golden instrument resolution and per-registrant continuity for an explicit
// list of position_observation ids. Inserts only. No universe scan. No Q14 derivation.
// MATCHED instrument requires exact identifier plus a disclosed Investment Type Axis member.
// Continuity v2 keys on registrant, exact identifier, and the footnote-verified type text.

import { randomUUID } from "node:crypto";
import { IDENTIFIER_COLUMN } from "../normalize/borrower-name.mjs";
import {
  INSTRUMENT_MATCH_METHOD, INSTRUMENT_UNRESOLVED_METHOD,
  CONTINUITY_MATCH_METHOD, CONTINUITY_FOOTNOTE_REF_METHOD, CONTINUITY_MATCH_METHODS,
  CONTINUITY_UNRESOLVED_INSTRUMENT_METHOD, CONTINUITY_UNRESOLVED_REGISTRANT_METHOD,
  CONTINUITY_AMBIGUOUS_SERIES_METHOD,
  canMatchInstrument, instrumentKey, continuityKey, continuityGaps, observationCount,
} from "../normalize/instrument-identity.mjs";
import {
  FOOTNOTE_REF_CODE, FOOTNOTE_REF_STATE, FOOTNOTE_REF_VERSION, continuityTypeText,
} from "../normalize/instrument-type-footnote-ref.mjs";
import { loadTypeFootnoteRefs } from "./instrument-type-footnote-ref.mjs";
import { DEFAULT_DATA_DIR } from "../lib/config.mjs";
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
  'type_field_value_id', fv.id,
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
  SELECT fv.id, fv.value_state, fv.raw_value
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

function loadCurrentDecisions(database, ids) {
  const list = ids.join(",");
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'position_observation_id', g.id,
  'instrument_state', ir.state,
  'instrument_id', ir.instrument_id,
  'continuity_state', pc.state,
  'continuity_method', pc.method,
  'position_id', pc.position_id
) ORDER BY g.id), '[]'::json)
FROM unnest(ARRAY[${list}]) AS g(id)
LEFT JOIN resolution.current_instrument_resolution ir ON ir.position_observation_id = g.id
LEFT JOIN resolution.current_position_continuity pc ON pc.position_observation_id = g.id;`)) ?? [];
  return new Map(parsed.map((row) => [Number(row.position_observation_id), row]));
}

// Existing MATCHED continuity rebuilt under the v2 key. A key that already names more than one
// position (for example series split under v1) is ambiguous; it is reported, never rewritten.
function loadExistingPositions(database, dataDir) {
  const col = lit(IDENTIFIER_COLUMN);
  const parsed = parseJsonCell(queryRows(database, `
SELECT coalesce(json_agg(json_build_object(
  'position_observation_id', d.position_observation_id,
  'registrant_id', pos.registrant_id,
  'ident', b.normalized_text,
  'type_field_value_id', fv.id,
  'type_text', fv.raw_value,
  'position_id', d.position_id
)), '[]'::json)
FROM resolution.current_position_continuity d
JOIN identity.position pos ON pos.id = d.position_id
JOIN LATERAL (
  SELECT b.normalized_text
  FROM obs.borrower_name_observation b
  WHERE b.position_observation_id = d.position_observation_id AND b.source_column_label = ${col}
    AND b.extraction_state = 'EXTRACTED'
  ORDER BY b.id LIMIT 1
) b ON true
JOIN LATERAL (
  SELECT fv.id, fv.raw_value, fv.value_state
  FROM obs.current_position_field_value fv
  WHERE fv.position_observation_id = d.position_observation_id AND fv.field_code = 'INSTRUMENT_TYPE'
  ORDER BY fv.id LIMIT 1
) fv ON true
WHERE d.state = 'MATCHED' AND d.method IN (${CONTINUITY_MATCH_METHODS.map(lit).join(", ")})
  AND fv.value_state = 'REPORTED' AND coalesce(fv.raw_value, '') <> '';`)) ?? [];
  const refs = loadTypeFootnoteRefs(database, parsed.map((row) => row.type_field_value_id), { dataDir });
  const map = new Map();
  for (const row of parsed) {
    const ref = refs.get(Number(row.type_field_value_id));
    const key = continuityKey(row.registrant_id, row.ident, continuityTypeText(ref));
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(row.position_id);
  }
  return map;
}

function footnoteRefNote(ref) {
  if (!ref || ref.state === FOOTNOTE_REF_STATE.NOT_APPLICABLE || ref.state === FOOTNOTE_REF_STATE.NO_CANDIDATE) return "";
  const rule = `${FOOTNOTE_REF_CODE} v${FOOTNOTE_REF_VERSION}`;
  if (ref.state === FOOTNOTE_REF_STATE.VERIFIED) {
    return `; ${rule} VERIFIED (${ref.reason}): raw type ${JSON.stringify(ref.rawText)}, continuity type `
      + `${JSON.stringify(ref.normalizedText)}, removed markers ${ref.removedMarkers.map((m) => `(${m})`).join("")}, `
      + `footnotes ${ref.footnoteIds.join(",")}`;
  }
  const marker = ref.failedMarker ? `, marker (${ref.failedMarker})` : "";
  return `; ${rule} UNVERIFIED (${ref.reason}${marker}): type kept as raw ${JSON.stringify(ref.rawText)}`;
}

function typeRefSummary(ref) {
  if (!ref) return null;
  return {
    source_rule: ref.sourceRule,
    raw_text: ref.rawText,
    normalized_text: ref.normalizedText,
    state: ref.state,
    reason: ref.reason,
    removed_markers: ref.removedMarkers,
    footnote_ids: ref.footnoteIds,
    failed_marker: ref.failedMarker ?? null,
  };
}

// Read-only. Builds every planned identity row and decision without writing anything.
export function planP7Min({ database, positionObservationIds, identifierSha256 = null, dataDir = DEFAULT_DATA_DIR }) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) throw new Error("P7-min requires at least one position_observation_id");
  if (identifierSha256 != null && !/^[0-9a-f]{64}$/.test(identifierSha256)) {
    throw new Error("identifierSha256 must be 64 hex chars");
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

  const typeRefs = loadTypeFootnoteRefs(database, facts.map((row) => row.type_field_value_id), { dataDir });
  const decided = loadCurrentDecisions(database, ids);
  const existingInst = loadExistingInstrumentKeys(database);
  const existingPos = loadExistingPositions(database, dataDir);
  const plannedPos = new Map();
  const newInstruments = [];
  const newPositions = [];
  const instMatched = [];
  const instUnresolved = [];
  const contMatched = [];
  const contUnresolved = [];
  const seriesDates = new Map();
  const matchedInstruments = new Set();
  const observations = [];

  for (const row of facts) {
    const current = decided.get(Number(row.position_observation_id)) ?? {};
    const ref = row.type_field_value_id == null ? null : typeRefs.get(Number(row.type_field_value_id));
    const note = footnoteRefNote(ref);
    const matchable = canMatchInstrument({
      identifierNorm: row.identifier_norm,
      typeState: row.type_state,
      typeText: row.type_text,
    });
    const observation = {
      position_observation_id: row.position_observation_id,
      registrant_id: row.registrant_id,
      identifier: row.identifier_norm,
      reported_date: row.reported_date,
      type: typeRefSummary(ref),
      continuity_type_text: null,
      instrument: null,
      continuity: null,
    };
    observations.push(observation);

    let instrumentId = null;
    if (current.instrument_state) {
      instrumentId = current.instrument_state === "MATCHED" ? current.instrument_id : null;
      observation.instrument = { already_decided: true, state: current.instrument_state, instrument_id: instrumentId };
    } else if (matchable) {
      const key = instrumentKey(row.identifier_norm, row.type_text);
      instrumentId = existingInst.get(key);
      const created = !instrumentId;
      if (created) {
        instrumentId = randomUUID();
        existingInst.set(key, instrumentId);
        newInstruments.push([instrumentId, row.identifier_norm, row.type_text]);
      }
      instMatched.push([row.position_observation_id, instrumentId, row.evidence_id]);
      observation.instrument = { already_decided: false, state: "MATCHED", instrument_id: instrumentId, new_instrument: created };
    } else {
      instUnresolved.push([row.position_observation_id, row.evidence_id]);
      observation.instrument = { already_decided: false, state: "UNRESOLVED", method: INSTRUMENT_UNRESOLVED_METHOD };
    }
    if (instrumentId) matchedInstruments.add(instrumentId);

    if (current.continuity_state) {
      observation.continuity = {
        already_decided: true,
        state: current.continuity_state,
        method: current.continuity_method,
        position_id: current.position_id,
      };
      if (matchable && row.registrant_id != null) {
        observation.continuity_type_text = continuityTypeText(ref ?? { rawText: row.type_text });
      }
      if (current.continuity_state === "MATCHED" && current.position_id) {
        if (!seriesDates.has(current.position_id)) seriesDates.set(current.position_id, []);
        seriesDates.get(current.position_id).push(row.reported_date);
      }
      continue;
    }

    const unresolved = (method, rationale) => {
      contUnresolved.push([row.position_observation_id, row.evidence_id, method, rationale + note]);
      observation.continuity = { already_decided: false, state: "UNRESOLVED", method };
    };
    if (!instrumentId) {
      unresolved(CONTINUITY_UNRESOLVED_INSTRUMENT_METHOD, "instrument identity is UNRESOLVED; continuity is not manufactured");
      continue;
    }
    if (row.registrant_id == null) {
      unresolved(CONTINUITY_UNRESOLVED_REGISTRANT_METHOD,
        "filing registrant is not a single LINKED registry.current_filing_registrant row; continuity is not MATCHED");
      continue;
    }
    const typeText = continuityTypeText(ref ?? { rawText: row.type_text });
    observation.continuity_type_text = typeText;
    const key = continuityKey(row.registrant_id, row.identifier_norm, typeText);
    const existing = existingPos.get(key);
    if (existing && existing.size > 1) {
      unresolved(CONTINUITY_AMBIGUOUS_SERIES_METHOD,
        `existing MATCHED continuity names ${existing.size} positions for this registrant, identifier, and type; no series is chosen`);
      continue;
    }
    let positionId = existing ? [...existing][0] : plannedPos.get(key);
    const created = !positionId;
    if (created) {
      positionId = randomUUID();
      plannedPos.set(key, positionId);
      newPositions.push([positionId, row.registrant_id]);
    }
    const verified = ref?.state === FOOTNOTE_REF_STATE.VERIFIED;
    const method = verified ? CONTINUITY_FOOTNOTE_REF_METHOD : CONTINUITY_MATCH_METHOD;
    const rationale = verified
      ? "same LINKED filing registrant, exact identifier, and footnote-verified type text; instrument identity keeps the raw type; different registrants stay separate series"
      : "same LINKED filing registrant and same MATCHED instrument; different registrants stay separate series";
    contMatched.push([row.position_observation_id, positionId, row.evidence_id, method, rationale + note]);
    observation.continuity = { already_decided: false, state: "MATCHED", method, position_id: positionId, new_position: created };
    if (!seriesDates.has(positionId)) seriesDates.set(positionId, []);
    seriesDates.get(positionId).push(row.reported_date);
  }

  return {
    ids,
    newInstruments,
    newPositions,
    instMatched,
    instUnresolved,
    contMatched,
    contUnresolved,
    seriesDates,
    matchedInstruments,
    observations,
  };
}

export function applyP7Min({
  database, positionObservationIds, runId, rules, identifierSha256 = null, dataDir = DEFAULT_DATA_DIR,
}) {
  const instMatchRule = rules["resolution.instrument_exact_identifier_and_type"];
  const instUnresRule = rules["resolution.instrument_unknown_attributes"];
  const contMatchRule = rules["resolution.position_same_registrant_and_instrument"];
  const contUnresRule = rules["resolution.position_unresolved_without_instrument"];
  const footnoteRefRule = rules["norm.instrument_type_footnote_ref"];
  if (!instMatchRule || !instUnresRule || !contMatchRule || !contUnresRule || !footnoteRefRule) {
    throw new Error("P7-min: missing instrument/continuity rule ids");
  }
  const {
    newInstruments, newPositions, instMatched, instUnresolved, contMatched, contUnresolved,
    seriesDates, matchedInstruments,
  } = planP7Min({ database, positionObservationIds, identifierSha256, dataDir });

  const sql = `
BEGIN;
CREATE TEMP TABLE _p7_new_inst (id uuid PRIMARY KEY, ident text NOT NULL, type_text text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_new_pos (id uuid PRIMARY KEY, registrant_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_im (po_id bigint PRIMARY KEY, instrument_id uuid NOT NULL, evidence_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_iu (po_id bigint PRIMARY KEY, evidence_id bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_cm (po_id bigint PRIMARY KEY, position_id uuid NOT NULL, evidence_id bigint NOT NULL, method text NOT NULL, rationale text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE _p7_cu (po_id bigint PRIMARY KEY, evidence_id bigint NOT NULL, method text NOT NULL, rationale text NOT NULL) ON COMMIT DROP;
${copyBlock("_p7_new_inst", ["id", "ident", "type_text"], newInstruments)}
${copyBlock("_p7_new_pos", ["id", "registrant_id"], newPositions)}
${copyBlock("_p7_im", ["po_id", "instrument_id", "evidence_id"], instMatched)}
${copyBlock("_p7_iu", ["po_id", "evidence_id"], instUnresolved)}
${copyBlock("_p7_cm", ["po_id", "position_id", "evidence_id", "method", "rationale"], contMatched)}
${copyBlock("_p7_cu", ["po_id", "evidence_id", "method", "rationale"], contUnresolved)}

INSERT INTO identity.instrument (id, creation_reason, run_id)
SELECT id, 'P7-min instrument from exact identifier and disclosed Investment Type Axis member', ${num(runId)}
FROM _p7_new_inst
WHERE NOT EXISTS (SELECT 1 FROM identity.instrument e WHERE e.id = _p7_new_inst.id);

INSERT INTO identity.position (id, registrant_id, creation_reason, run_id)
SELECT id, registrant_id, 'P7-min per-registrant continuity series for an exact identifier and type', ${num(runId)}
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
  SELECT m.po_id, m.position_id, 'MATCHED'::ref.resolution_state, m.method, m.rationale,
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
    distinct_matched_instruments: matchedInstruments.size,
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
      AND d.method IN (${CONTINUITY_MATCH_METHODS.map(lit).join(", ")}) AND d.actor_kind = 'SYSTEM_RULE'),
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
