// P4-min: borrower-name observations for an explicit list of position_observation ids.
// Inserts only. Never updates SOI, position, or field-value rows. No universe scan.

import { IDENTIFIER_COLUMN } from "../normalize/borrower-name.mjs";
import { copyBlock, lit, num, queryRows, runScript } from "../lib/db.mjs";

function intIds(ids) {
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid position_observation_id: ${raw}`);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function snapshotP4Min(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  const rows = queryRows(database, `
SELECT json_build_object(
  'soi_row_observation_count', (SELECT count(*) FROM obs.soi_row_observation),
  'position_observation_count', (SELECT count(*) FROM obs.position_observation),
  'position_field_value_count', (SELECT count(*) FROM obs.position_field_value),
  'borrower_name_observation_count', (SELECT count(*) FROM obs.borrower_name_observation),
  'golden_borrower_name_count', (
    SELECT count(*) FROM obs.borrower_name_observation
    WHERE position_observation_id IN (${list})),
  'non_golden_borrower_name_count', (
    SELECT count(*) FROM obs.borrower_name_observation
    WHERE position_observation_id NOT IN (${list})),
  'max_soi_row_observation_id', (SELECT coalesce(max(id), 0) FROM obs.soi_row_observation),
  'max_position_observation_id', (SELECT coalesce(max(id), 0) FROM obs.position_observation),
  'max_position_field_value_id', (SELECT coalesce(max(id), 0) FROM obs.position_field_value)
);`);
  return JSON.parse(rows[0][0]);
}

export function applyP4Min({ database, positionObservationIds, runId, rules, identifierSha256 }) {
  const ids = intIds(positionObservationIds);
  if (ids.length === 0) throw new Error("P4-min requires at least one position_observation_id");
  if (!/^[0-9a-f]{64}$/.test(identifierSha256)) throw new Error("identifierSha256 must be 64 hex chars");
  const nameRuleId = rules["norm.borrower_name"];
  if (!nameRuleId) throw new Error("missing rule id for norm.borrower_name");

  const col = lit(IDENTIFIER_COLUMN);
  const sha = lit(identifierSha256);
  const sqlFixed = `
BEGIN;
CREATE TEMP TABLE _p4_po (id bigint PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE _p4_counts (k text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;
${copyBlock("_p4_po", ["id"], ids.map((id) => [id]))}

CREATE TEMP TABLE _p4_ident ON COMMIT DROP AS
SELECT p.id AS position_observation_id,
       s.identifier_raw,
       s.tabular_row_id,
       tl.artifact_id,
       array_position(tl.header, ${col}) AS source_column_position,
       r.cells[array_position(tl.header, ${col})] AS identifier_cell
FROM _p4_po g
JOIN obs.position_observation p ON p.id = g.id
JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
JOIN raw.tabular_row r ON r.id = s.tabular_row_id
JOIN raw.table_load tl ON tl.id = r.table_load_id;

DO $chk$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM _p4_ident;
  IF n <> (SELECT count(*) FROM _p4_po) THEN
    RAISE EXCEPTION 'P4-min: % of % locator ids were not found as position observations', n, (SELECT count(*) FROM _p4_po);
  END IF;
  IF EXISTS (SELECT 1 FROM _p4_ident WHERE source_column_position IS NULL) THEN
    RAISE EXCEPTION 'P4-min: Investment, Identifier Axis is missing from a golden table header';
  END IF;
  IF EXISTS (SELECT 1 FROM _p4_ident WHERE identifier_raw IS DISTINCT FROM identifier_cell) THEN
    RAISE EXCEPTION 'P4-min: identifier_raw does not equal the Identifier Axis cell';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _p4_ident
    WHERE encode(sha256(convert_to(identifier_raw, 'UTF8')), 'hex') <> ${sha}
  ) THEN
    RAISE EXCEPTION 'P4-min: a locator row is not the Stage A identifier';
  END IF;
END
$chk$;

CREATE TEMP TABLE _p4_missing ON COMMIT DROP AS
SELECT DISTINCT i.artifact_id, i.tabular_row_id, i.source_column_position
FROM _p4_ident i
WHERE NOT EXISTS (
  SELECT 1 FROM evidence.evidence ev
  WHERE ev.tabular_row_id = i.tabular_row_id
    AND ev.column_position = i.source_column_position
    AND ev.locator_type = 'TSV_CELL'
);

INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, tabular_row_id,
    column_position, column_label, run_id)
SELECT 'L1_STRUCTURED_DATASET'::ref.evidence_level, m.artifact_id, 'TSV_CELL'::ref.locator_type,
       m.tabular_row_id, m.source_column_position, ${col}, ${num(runId)}
FROM _p4_missing m
ORDER BY m.tabular_row_id, m.source_column_position;

WITH ins AS (
  INSERT INTO obs.borrower_name_observation (
      position_observation_id, source_column_label, source_column_position, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id)
  SELECT i.position_observation_id, ${col}, i.source_column_position,
         i.identifier_raw,
         nullif(btrim(normalize(i.identifier_raw, NFC)), ''),
         CASE WHEN btrim(normalize(i.identifier_raw, NFC)) = '' THEN 'UNRESOLVED' ELSE 'EXTRACTED' END,
         ${num(nameRuleId)}, e.id, ${num(runId)}
  FROM _p4_ident i
  JOIN LATERAL (
    SELECT ev.id FROM evidence.evidence ev
    WHERE ev.tabular_row_id = i.tabular_row_id
      AND ev.column_position = i.source_column_position
      AND ev.locator_type = 'TSV_CELL'
    ORDER BY ev.id
    LIMIT 1
  ) e ON true
  WHERE NOT EXISTS (
    SELECT 1 FROM obs.borrower_name_observation b
    WHERE b.position_observation_id = i.position_observation_id
      AND b.source_column_label = ${col}
      AND b.rule_version_id = ${num(nameRuleId)})
  RETURNING id
)
INSERT INTO _p4_counts SELECT 'identifier_name_inserted', count(*) FROM ins;

WITH ins AS (
  INSERT INTO obs.borrower_name_observation (
      position_observation_id, source_column_label, source_column_position, raw_text, normalized_text,
      extraction_state, rule_version_id, evidence_id, run_id)
  SELECT fv.position_observation_id, fv.source_column_label, fv.source_column_position,
         fv.raw_value,
         nullif(btrim(normalize(fv.raw_value, NFC)), ''),
         CASE WHEN btrim(normalize(fv.raw_value, NFC)) = '' THEN 'UNRESOLVED' ELSE 'EXTRACTED' END,
         ${num(nameRuleId)}, fv.evidence_id, ${num(runId)}
  FROM obs.current_position_field_value fv
  JOIN _p4_po g ON g.id = fv.position_observation_id
  WHERE fv.field_code = 'ISSUER_NAME'
    AND fv.value_state = 'REPORTED'
    AND fv.raw_value IS NOT NULL
    AND fv.raw_value <> ''
    AND fv.source_column_label IS NOT NULL
    AND fv.source_column_position IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM obs.borrower_name_observation b
      WHERE b.position_observation_id = fv.position_observation_id
        AND b.source_column_label = fv.source_column_label
        AND b.rule_version_id = ${num(nameRuleId)})
  RETURNING id
)
INSERT INTO _p4_counts SELECT 'issuer_name_inserted', count(*) FROM ins;

SELECT json_object_agg(k, n) FROM _p4_counts;
COMMIT;
`;

  const out = runScript(database, sqlFixed);
  const countsLine = out.find((l) => l.startsWith("{")) ?? out[out.length - 1];
  const inserted = JSON.parse(countsLine);
  return {
    identifier_name_inserted: Number(inserted.identifier_name_inserted ?? 0),
    issuer_name_inserted: Number(inserted.issuer_name_inserted ?? 0),
  };
}

export function goldenInstrumentTypeCounts(database, positionObservationIds) {
  const ids = intIds(positionObservationIds);
  const list = ids.join(",");
  const rows = queryRows(database, `
SELECT json_build_object(
  'reported', count(*) FILTER (WHERE coalesce(s.value_state, 'UNKNOWN') = 'REPORTED' AND coalesce(fv.raw_value, '') <> ''),
  'unknown', count(*) FILTER (WHERE coalesce(s.value_state, 'UNKNOWN') <> 'REPORTED' OR coalesce(fv.raw_value, '') = ''),
  'disclosed_member_hashes', coalesce((
    SELECT json_agg(h ORDER BY h)
    FROM (
      SELECT DISTINCT encode(sha256(convert_to(fv2.raw_value, 'UTF8')), 'hex') AS h
      FROM obs.position_field_status s2
      JOIN obs.current_position_field_value fv2
        ON fv2.id = s2.field_value_id
      WHERE s2.position_observation_id IN (${list})
        AND s2.field_code = 'INSTRUMENT_TYPE'
        AND coalesce(s2.value_state, 'UNKNOWN') = 'REPORTED'
        AND coalesce(fv2.raw_value, '') <> ''
    ) x
  ), '[]'::json)
)
FROM obs.position_field_status s
LEFT JOIN obs.current_position_field_value fv ON fv.id = s.field_value_id
WHERE s.position_observation_id IN (${list}) AND s.field_code = 'INSTRUMENT_TYPE';`);
  return JSON.parse(rows[0][0]);
}
