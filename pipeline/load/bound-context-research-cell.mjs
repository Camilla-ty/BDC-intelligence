// Persist INDUSTRY and INSTRUMENT_TYPE from the HTML row of a stored maturity context.
// An empty Industry cell writes no INDUSTRY field. A current head is kept when it is
// already the same text and is otherwise left untouched.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE } from "../lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "../lib/db.mjs";
import { createStore } from "../lib/store.mjs";
import {
  BOUND_CONTEXT_RESEARCH_CODE, BOUND_CONTEXT_RESEARCH_VERSION, boundContextResearchCells, researchHeadAction,
} from "../extract/bound-context-research-cell.mjs";
import { pipelineCodeVersion } from "./run.mjs";
import { ensureAndLinkRuleForRun } from "./rules.mjs";

const CONTEXT_ID = /^[A-Za-z0-9_-]+$/;

function refuseHosted(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("bound context research cells refuse a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("bound context research cells refuse a database other than the local database");
  }
}

function one(rows, label) {
  if (rows.length !== 1) throw new Error(`${label}: expected one row, found ${rows.length}`);
  return rows[0];
}

function currentHeads(database, positionId, fieldCode) {
  return queryRows(database, `SELECT raw_value, coalesce(normalized_text, ''), value_state::text
    FROM obs.current_position_field_value
    WHERE position_observation_id = ${num(positionId)} AND field_code = ${lit(fieldCode)}
    ORDER BY id`).map(([rawValue, normalizedText, valueState]) => ({ rawValue, normalizedText, valueState }));
}

function sqlText(value) {
  if (typeof value !== "string" || value === "") throw new Error("cell text is empty");
  return lit(value);
}

export function persistBoundContextResearchCells({
  database,
  positionId,
  dataDir = DEFAULT_DATA_DIR,
}) {
  refuseHosted(database);
  if (!Number.isSafeInteger(positionId) || positionId < 1) throw new Error("position id is required");
  const position = one(queryRows(database, `SELECT filing_id::text
    FROM obs.position_observation WHERE id = ${num(positionId)}`), "position");
  const inspection = one(queryRows(database, `SELECT filing_context_id
    FROM obs.maturity_inspection i
    WHERE i.position_observation_id = ${num(positionId)}
      AND i.inspection_state = 'FILING_DISPLAYED'
      AND NOT EXISTS (SELECT 1 FROM obs.maturity_inspection s WHERE s.supersedes_id = i.id)`), "bound context");
  const contextId = inspection[0];
  if (!CONTEXT_ID.test(contextId)) throw new Error("bound context id is not storable");
  const document = one(queryRows(database, `SELECT id::text FROM registry.filing_document
    WHERE filing_id = ${num(Number(position[0]))} AND named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT'`), "primary filing document");
  const artifact = one(queryRows(database, `SELECT a.id::text, a.storage_key, a.sha256
    FROM registry.filing_document_artifact fda
    JOIN raw.artifact a ON a.id = fda.artifact_id
    WHERE fda.filing_document_id = ${num(Number(document[0]))}`), "filing HTML artifact");
  const html = createStore(dataDir).read(artifact[1], artifact[2]).toString("utf8");
  const selected = boundContextResearchCells(html, contextId);
  if (!selected || !selected.fields.some((field) => field.fieldCode === "INSTRUMENT_TYPE")) {
    throw new Error("the bound context row does not have an untagged Type cell");
  }
  const plans = selected.fields.map((field) => {
    const action = researchHeadAction(currentHeads(database, positionId, field.fieldCode), field.rawText);
    if (action === "CONFLICT") {
      throw new Error(`current ${field.fieldCode} conflicts with the bound HTML cell; nothing was written`);
    }
    return { field, action };
  });
  if (plans.every((plan) => plan.action === "KEEP")) {
    return {
      positionId,
      contextId,
      artifactId: Number(artifact[0]),
      fields: plans.map((plan) => ({ fieldCode: plan.field.fieldCode, rawText: plan.field.rawText, action: "KEEP" })),
    };
  }

  const anchor = one(queryRows(database, `SELECT id::text FROM evidence.evidence
    WHERE artifact_id = ${num(Number(artifact[0]))}
      AND evidence_level = 'L2_ORIGINAL_FILING'
      AND locator_type = 'HTML_ANCHOR'
      AND html_anchor = ${lit(`ix-context-row:${contextId}`)}`), "context row anchor");
  const [runRow] = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
    VALUES ('BOUND_CONTEXT_RESEARCH_CELL', ${lit(pipelineCodeVersion())},
      ${lit(JSON.stringify({ position_observation_id: positionId, context_id: contextId }))}::jsonb, now())
    RETURNING id`);
  const runId = Number(runRow[0]);
  try {
    const rule = ensureAndLinkRuleForRun(database, runId, {
      code: BOUND_CONTEXT_RESEARCH_CODE,
      version: BOUND_CONTEXT_RESEARCH_VERSION,
    });
    const cellRows = plans.filter((plan) => plan.action === "INSERT").map((plan) => {
      const field = plan.field;
      const heading = field.heading;
      return `(${sqlText(field.fieldCode)}, ${sqlText(field.rawText)}, ${num(field.rowOrdinal)}, ${num(field.slotOrdinal)}, ${num(heading.rowOrdinal)}, ${num(heading.slotOrdinal)}, ${sqlText(heading.rawText)}, ${sqlText(heading.matchedText)})`;
    }).join(",\n");
    queryRows(database, `
BEGIN;
CREATE TEMP TABLE _bound_cells (
  field_code text, raw_text text, value_row integer, value_slot integer,
  heading_row integer, heading_slot integer, heading_raw text, heading_matched text
) ON COMMIT DROP;
INSERT INTO _bound_cells VALUES
${cellRows};
DO $bound_cells$
DECLARE
  rec record;
  heading_id bigint;
  heading_count integer;
  cell_id bigint;
  cell_count integer;
  field_id bigint;
BEGIN
  FOR rec IN SELECT * FROM _bound_cells ORDER BY field_code LOOP
    heading_id := NULL;
    SELECT count(*) INTO heading_count
    FROM evidence.evidence e
    JOIN evidence.html_column_heading h ON h.evidence_id = e.id
    WHERE e.artifact_id = ${num(Number(artifact[0]))}
      AND e.locator_type = 'HTML_COLUMN_HEADING'
      AND e.html_row_ordinal = rec.heading_row
      AND e.html_slot_ordinal = rec.heading_slot;
    IF heading_count > 1 THEN
      RAISE EXCEPTION USING MESSAGE = 'more than one heading exists for this cell';
    END IF;
    IF heading_count = 1 THEN
      SELECT e.id INTO heading_id
      FROM evidence.evidence e
      JOIN evidence.html_column_heading h ON h.evidence_id = e.id
      WHERE e.artifact_id = ${num(Number(artifact[0]))}
        AND e.locator_type = 'HTML_COLUMN_HEADING'
        AND e.html_row_ordinal = rec.heading_row
        AND e.html_slot_ordinal = rec.heading_slot
        AND h.raw_text = rec.heading_raw
        AND h.matched_text = rec.heading_matched;
      IF heading_id IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'stored heading text differs; it was not overwritten';
      END IF;
    ELSE
      INSERT INTO evidence.evidence (
        evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, run_id)
      VALUES ('L2_ORIGINAL_FILING', ${num(Number(artifact[0]))}, 'HTML_COLUMN_HEADING', rec.heading_row, rec.heading_slot, ${num(runId)})
      RETURNING id INTO heading_id;
      INSERT INTO evidence.html_column_heading (evidence_id, raw_text, matched_text)
      VALUES (heading_id, rec.heading_raw, rec.heading_matched);
    END IF;
    SELECT count(*) INTO cell_count
    FROM evidence.evidence e
    WHERE e.artifact_id = ${num(Number(artifact[0]))}
      AND e.locator_type = 'HTML_TABLE_CELL'
      AND e.html_row_ordinal = rec.value_row
      AND e.html_slot_ordinal = rec.value_slot
      AND e.heading_evidence_id = heading_id
      AND e.block_evidence_id IS NULL;
    IF cell_count > 1 THEN
      RAISE EXCEPTION USING MESSAGE = 'more than one HTML cell exists for this heading';
    END IF;
    IF cell_count = 0 THEN
      INSERT INTO evidence.evidence (
        evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, heading_evidence_id, run_id)
      VALUES (
        'L2_ORIGINAL_FILING', ${num(Number(artifact[0]))}, 'HTML_TABLE_CELL',
        rec.value_row, rec.value_slot, heading_id, ${num(runId)})
      RETURNING id INTO cell_id;
    ELSE
      SELECT e.id INTO cell_id
      FROM evidence.evidence e
      WHERE e.artifact_id = ${num(Number(artifact[0]))}
        AND e.locator_type = 'HTML_TABLE_CELL'
        AND e.html_row_ordinal = rec.value_row
        AND e.html_slot_ordinal = rec.value_slot
        AND e.heading_evidence_id = heading_id
        AND e.block_evidence_id IS NULL;
    END IF;
    INSERT INTO obs.position_field_value (
      position_observation_id, field_code, raw_value, normalized_text,
      currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
    VALUES (
      ${num(positionId)}, rec.field_code, rec.raw_text, rec.raw_text,
      'UNKNOWN', 'NOT_APPLICABLE', 'REPORTED', ${num(rule.id)}, cell_id, ${num(runId)})
    RETURNING id INTO field_id;
    INSERT INTO evidence.supplementary_evidence (subject_table, subject_id, evidence_id, role, run_id)
    VALUES ('obs.position_field_value', field_id, ${num(Number(anchor[0]))}, 'CORROBORATES', ${num(runId)});
  END LOOP;
END
$bound_cells$;
INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify({
    position_observation_id: positionId,
    context_id: contextId,
  }))}::jsonb, NULL);
COMMIT;`);
    const stored = queryRows(database, `SELECT f.field_code, f.raw_value, e.locator_type::text, e.artifact_id::text,
        e.html_row_ordinal::text, h.matched_text, s.evidence_id::text
      FROM obs.current_position_field_value f
      JOIN evidence.evidence e ON e.id = f.evidence_id
      JOIN evidence.html_column_heading h ON h.evidence_id = e.heading_evidence_id
      JOIN evidence.supplementary_evidence s
        ON s.subject_table = 'obs.position_field_value' AND s.subject_id = f.id AND s.role = 'CORROBORATES'
      WHERE f.position_observation_id = ${num(positionId)}
        AND f.field_code IN ('INDUSTRY', 'INSTRUMENT_TYPE')
      ORDER BY f.field_code`);
    return {
      runId,
      ruleVersionId: rule.id,
      positionId,
      contextId,
      artifactId: Number(artifact[0]),
      contextEvidenceId: Number(anchor[0]),
      fields: stored.map((row) => ({
        fieldCode: row[0],
        rawText: row[1],
        locatorType: row[2],
        artifactId: Number(row[3]),
        rowOrdinal: Number(row[4]),
        heading: row[5],
        contextEvidenceId: Number(row[6]),
      })),
    };
  } catch (error) {
    try {
      queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
        VALUES (${num(runId)}, 'FAILED', now(), '{}'::jsonb, ${lit(String(error.message).slice(0, 500))})`);
    } catch {
      // The original failure is the one that must surface.
    }
    throw error;
  }
}

function positionArgument(args) {
  const index = args.indexOf("--position");
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || !/^\d+$/.test(value)) throw new Error("--position is required");
  const positionId = Number(value);
  if (!Number.isSafeInteger(positionId)) throw new Error("--position is not a safe integer");
  return positionId;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = persistBoundContextResearchCells({
      database: DEFAULT_DATABASE,
      positionId: positionArgument(process.argv.slice(2)),
    });
    console.log(JSON.stringify(result));
  } catch (caught) {
    console.error(`bound-context-research-cell: ${caught.message}`);
    process.exit(1);
  }
}
