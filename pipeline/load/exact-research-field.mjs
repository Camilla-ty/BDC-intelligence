// Writes INDUSTRY and INSTRUMENT_TYPE for one exact-bind detail row.
// Evidence is a new or reused DISCLOSURE_BLOCK plus HTML_TABLE_CELL children.
// column_label is omitted. Existing evidence rows are not updated.
// An empty cell, a trailing-space identifier, a different period, or a layout
// parser v2 does not return as a block produces no field row.

import { lit, num, queryRows } from "../lib/db.mjs";
import { ensureAndLinkRuleForRun } from "./rules.mjs";
import {
  RESEARCH_FIELD_CODE, RESEARCH_FIELD_VERSION, selectExactResearchFields,
} from "../extract/exact-research-field.mjs";

export { RESEARCH_FIELD_CODE, RESEARCH_FIELD_VERSION, selectExactResearchFields };

function assertFilingArtifact(input) {
  if (input.artifact?.sourceType !== "SEC_FILING_DOCUMENT") {
    throw new Error("artifact must be SEC_FILING_DOCUMENT");
  }
  if (!Number.isSafeInteger(input.artifact.id) || input.artifact.id < 1) {
    throw new Error("artifact id is required");
  }
  if (input.filingLink?.artifactId !== input.artifact.id || input.filingLink?.filingId !== input.positionFilingId) {
    throw new Error("filing link does not match the position filing");
  }
  if (!Number.isSafeInteger(input.positionObservationId) || input.positionObservationId < 1) {
    throw new Error("position_observation_id is required");
  }
  if (!Number.isSafeInteger(input.runId) || input.runId < 1) throw new Error("run id is required");
}

function fieldStatement(field, positionObservationId) {
  const code = lit(field.fieldCode);
  const raw = lit(field.rawText);
  const row = num(field.htmlRowOrdinal);
  const slot = num(field.htmlSlotOrdinal);
  const position = num(positionObservationId);
  return `
  field_count := 0;
  field_id := NULL;
  existing_raw := NULL;
  existing_norm := NULL;
  existing_state := NULL;
  existing_row := NULL;
  existing_slot := NULL;
  existing_artifact := NULL;
  existing_block := NULL;
  existing_label := NULL;
  SELECT count(*) INTO field_count
  FROM obs.position_field_value f
  WHERE f.position_observation_id = ${position}
    AND f.field_code = ${code}
    AND f.source_column_label IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = f.id);
  IF field_count > 1 THEN
    RAISE EXCEPTION USING MESSAGE = ${lit(`more than one current ${field.fieldCode} value for this position`)};
  END IF;
  IF field_count = 1 THEN
    SELECT f.id, f.raw_value, f.normalized_text, f.value_state::text,
           e.html_row_ordinal, e.html_slot_ordinal, e.artifact_id, e.block_evidence_id, e.column_label
      INTO field_id, existing_raw, existing_norm, existing_state,
           existing_row, existing_slot, existing_artifact, existing_block, existing_label
    FROM obs.position_field_value f
    JOIN evidence.evidence e ON e.id = f.evidence_id
    WHERE f.position_observation_id = ${position}
      AND f.field_code = ${code}
      AND f.source_column_label IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = f.id);
    IF existing_raw IS DISTINCT FROM ${raw}
       OR existing_norm IS DISTINCT FROM ${raw}
       OR existing_state IS DISTINCT FROM 'REPORTED'
       OR existing_row IS DISTINCT FROM ${row}
       OR existing_slot IS DISTINCT FROM ${slot}
       OR existing_artifact IS DISTINCT FROM v_artifact_id
       OR existing_block IS DISTINCT FROM v_block_id
       OR existing_label IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = ${lit(`stored ${field.fieldCode} does not match this exact cell; it was not overwritten`)};
    END IF;
    INSERT INTO rf_result (field_code, field_value_id, evidence_id, inserted)
    VALUES (${code}, field_id, (
      SELECT f.evidence_id FROM obs.position_field_value f WHERE f.id = field_id), false);
  ELSE
    cell_count := 0;
    cell_id := NULL;
    SELECT count(*) INTO cell_count
    FROM evidence.evidence e
    WHERE e.artifact_id = v_artifact_id
      AND e.locator_type = 'HTML_TABLE_CELL'
      AND e.evidence_level = 'L2_ORIGINAL_FILING'
      AND e.html_row_ordinal = ${row}
      AND e.html_slot_ordinal = ${slot}
      AND e.block_evidence_id = v_block_id
      AND e.column_label IS NULL;
    IF cell_count > 1 THEN
      RAISE EXCEPTION USING MESSAGE = ${lit(`more than one HTML cell for ${field.fieldCode}`)};
    END IF;
    IF cell_count = 0 THEN
      INSERT INTO evidence.evidence (
        evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
      VALUES ('L2_ORIGINAL_FILING', v_artifact_id, 'HTML_TABLE_CELL', ${row}, ${slot}, v_block_id, v_run_id)
      RETURNING id INTO cell_id;
    ELSE
      SELECT e.id INTO cell_id
      FROM evidence.evidence e
      WHERE e.artifact_id = v_artifact_id
        AND e.locator_type = 'HTML_TABLE_CELL'
        AND e.evidence_level = 'L2_ORIGINAL_FILING'
        AND e.html_row_ordinal = ${row}
        AND e.html_slot_ordinal = ${slot}
        AND e.block_evidence_id = v_block_id
        AND e.column_label IS NULL;
    END IF;
    INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_text,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
    VALUES (
      ${position}, ${code}, ${raw}, ${raw},
      'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', v_rule_id, cell_id, v_run_id)
    RETURNING id INTO field_id;
    INSERT INTO rf_result (field_code, field_value_id, evidence_id, inserted)
    VALUES (${code}, field_id, cell_id, true);
  END IF;`;
}

export function ingestExactResearchFields(input) {
  assertFilingArtifact(input);
  const selected = selectExactResearchFields({
    html: input.html,
    holdingDescriptorRaw: input.holdingDescriptorRaw,
    reportedDate: input.reportedDate,
  });
  const rule = ensureAndLinkRuleForRun(input.database, input.runId, {
    code: RESEARCH_FIELD_CODE,
    version: RESEARCH_FIELD_VERSION,
  });
  if (selected.fields.length === 0) {
    return {
      ruleVersionId: rule.id,
      definitionSha256: rule.definitionSha256,
      blockEvidenceId: null,
      fields: [],
    };
  }
  const statements = selected.fields.map((field) => fieldStatement(field, input.positionObservationId)).join("\n");
  const rows = queryRows(input.database, `
BEGIN;
CREATE TEMP TABLE rf_result (
  field_code text,
  field_value_id bigint,
  evidence_id bigint,
  inserted boolean
) ON COMMIT DROP;
DO $exact_research$
DECLARE
  v_artifact_id bigint := ${num(input.artifact.id)};
  v_run_id bigint := ${num(input.runId)};
  v_rule_id bigint := ${num(rule.id)};
  v_block_id bigint;
  block_count integer;
  cell_id bigint;
  cell_count integer;
  field_id bigint;
  field_count integer;
  existing_raw text;
  existing_norm text;
  existing_state text;
  existing_row integer;
  existing_slot integer;
  existing_artifact bigint;
  existing_block bigint;
  existing_label text;
BEGIN
  IF (SELECT filing_id FROM obs.position_observation WHERE id = ${num(input.positionObservationId)})
     IS DISTINCT FROM ${num(input.positionFilingId)} THEN
    RAISE EXCEPTION USING MESSAGE = 'position filing does not match';
  END IF;
  IF (SELECT holding_descriptor_raw FROM obs.position_observation WHERE id = ${num(input.positionObservationId)})
     IS DISTINCT FROM ${lit(input.holdingDescriptorRaw)} THEN
    RAISE EXCEPTION USING MESSAGE = 'position holding does not match';
  END IF;
  IF (SELECT reported_date::text FROM obs.position_observation WHERE id = ${num(input.positionObservationId)})
     IS DISTINCT FROM ${lit(input.reportedDate)} THEN
    RAISE EXCEPTION USING MESSAGE = 'position reported date does not match';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM registry.filing_document_artifact fda
    JOIN raw.artifact a ON a.id = fda.artifact_id
    JOIN registry.filing_document d ON d.id = fda.filing_document_id
    WHERE a.id = v_artifact_id
      AND a.source_type_code = 'SEC_FILING_DOCUMENT'
      AND d.filing_id = ${num(input.positionFilingId)}
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'filing document artifact is not linked to this filing';
  END IF;
  SELECT count(*) INTO block_count
  FROM evidence.evidence
  WHERE artifact_id = v_artifact_id
    AND locator_type = 'DISCLOSURE_BLOCK'
    AND evidence_level = 'L2_ORIGINAL_FILING'
    AND html_row_ordinal = ${num(selected.block.startRowOrdinal)}
    AND html_row_end_ordinal = ${num(selected.block.endRowOrdinal)};
  IF block_count > 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'more than one disclosure block matches this artifact and row range';
  END IF;
  IF block_count = 0 THEN
    INSERT INTO evidence.evidence (
      evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
    VALUES ('L2_ORIGINAL_FILING', v_artifact_id, 'DISCLOSURE_BLOCK',
            ${num(selected.block.startRowOrdinal)}, ${num(selected.block.endRowOrdinal)}, v_run_id)
    RETURNING id INTO v_block_id;
  ELSE
    SELECT id INTO v_block_id
    FROM evidence.evidence
    WHERE artifact_id = v_artifact_id
      AND locator_type = 'DISCLOSURE_BLOCK'
      AND evidence_level = 'L2_ORIGINAL_FILING'
      AND html_row_ordinal = ${num(selected.block.startRowOrdinal)}
      AND html_row_end_ordinal = ${num(selected.block.endRowOrdinal)};
  END IF;
  ${statements}
END
$exact_research$;
SELECT field_code, field_value_id::text, evidence_id::text, inserted::text,
       (SELECT block_evidence_id::text FROM evidence.evidence WHERE id = rf_result.evidence_id)
FROM rf_result
ORDER BY field_code;
COMMIT;`);
  return {
    ruleVersionId: rule.id,
    definitionSha256: rule.definitionSha256,
    blockEvidenceId: Number(rows[0][4]),
    fields: rows.map((row) => ({
      fieldCode: row[0],
      fieldValueId: Number(row[1]),
      evidenceId: Number(row[2]),
      inserted: row[3] === "true",
      rawText: selected.fields.find((field) => field.fieldCode === row[0]).rawText,
      htmlRowOrdinal: selected.fields.find((field) => field.fieldCode === row[0]).htmlRowOrdinal,
      htmlSlotOrdinal: selected.fields.find((field) => field.fieldCode === row[0]).htmlSlotOrdinal,
    })),
  };
}
