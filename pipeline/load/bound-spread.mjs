// Persist the spread fact already chosen by a maturity context bind.
// This does not find a row. It refuses a hosted database, an existing SPREAD head,
// and any value other than the unscaled fact amount.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE } from "../lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "../lib/db.mjs";
import { createStore } from "../lib/store.mjs";
import { bindMaturityContext, spreadFactFromBind } from "../normalize/maturity-context-bind.mjs";
import { pipelineCodeVersion } from "./run.mjs";
import { ensureAndLinkRuleForRun } from "./rules.mjs";

export const BOUND_SPREAD_CODE = "obs.spread.bound_ixbrl_fact";
export const BOUND_SPREAD_VERSION = "1";

const FACT_ID = /^[A-Za-z0-9_-]+$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

function refuseHosted(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("bound spread persistence refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("bound spread persistence refuses a database other than the local database");
  }
}

function one(rows, label) {
  if (rows.length !== 1) throw new Error(`${label}: expected one row, found ${rows.length}`);
  return rows[0];
}

export function persistBoundSpread({
  database,
  positionId,
  dataDir = DEFAULT_DATA_DIR,
}) {
  refuseHosted(database);
  if (!Number.isSafeInteger(positionId) || positionId < 1) throw new Error("position id is required");

  const position = one(queryRows(database, `SELECT p.id::text, p.filing_id::text, p.reported_date::text
    FROM obs.position_observation p
    WHERE p.id = ${num(positionId)}`), "position");
  const reportedDate = position[2];
  if (!reportedDate) throw new Error("position has no reported date");

  const fields = queryRows(database, `SELECT field_code, raw_value, normalized_numeric::text
    FROM obs.current_position_field_value
    WHERE position_observation_id = ${num(positionId)}
    ORDER BY field_code, source_column_label`).map(([fieldCode, rawValue, normalized]) => ({
    field_code: fieldCode,
    raw_value: rawValue,
    normalized_numeric: normalized === "" ? null : normalized,
  }));
  if (fields.some((field) => field.field_code === "SPREAD")) {
    throw new Error("a current SPREAD head already exists; it was not overwritten");
  }

  const document = one(queryRows(database, `SELECT id::text FROM registry.filing_document
    WHERE filing_id = ${num(Number(position[1]))}
      AND named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT'`), "primary filing document");
  const artifact = one(queryRows(database, `SELECT a.id::text, a.storage_key, a.sha256
    FROM registry.filing_document_artifact fda
    JOIN raw.artifact a ON a.id = fda.artifact_id
    WHERE fda.filing_document_id = ${num(Number(document[0]))}`), "filing HTML artifact");
  const html = createStore(dataDir).read(artifact[1], artifact[2]).toString("utf8");
  const bind = bindMaturityContext(html, fields, reportedDate);
  const spread = spreadFactFromBind(bind);
  if (!spread) throw new Error("the bound context does not have one spread fact");
  if (!FACT_ID.test(spread.factId) || !DECIMAL.test(spread.rawValue)) {
    throw new Error("spread fact id or unscaled value is not storable");
  }
  if (spread.rawValue === spread.displayedText && spread.scale && spread.scale !== "0") {
    throw new Error("refusing to store the displayed spread without its scale");
  }

  const [runRow] = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
    VALUES ('BOUND_SPREAD_FACT', ${lit(pipelineCodeVersion())},
      ${lit(JSON.stringify({
        position_observation_id: positionId,
        context_id: spread.contextId,
        fact_id: spread.factId,
      }))}::jsonb, now())
    RETURNING id`);
  const runId = Number(runRow[0]);
  try {
    const rule = ensureAndLinkRuleForRun(database, runId, {
      code: BOUND_SPREAD_CODE,
      version: BOUND_SPREAD_VERSION,
    });
    const rows = queryRows(database, `
BEGIN;
DO $bound_spread$
DECLARE
  evidence_count integer;
  evidence_id bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM obs.position_field_value f
    WHERE f.position_observation_id = ${num(positionId)}
      AND f.field_code = 'SPREAD'
      AND NOT EXISTS (SELECT 1 FROM obs.position_field_value s WHERE s.supersedes_id = f.id)
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'a current SPREAD head already exists; it was not overwritten';
  END IF;
  SELECT count(*) INTO evidence_count
  FROM evidence.evidence e
  WHERE e.artifact_id = ${num(Number(artifact[0]))}
    AND e.locator_type = 'IXBRL_FACT'
    AND e.evidence_level = 'L2_ORIGINAL_FILING'
    AND e.ixbrl_fact_id = ${lit(spread.factId)};
  IF evidence_count > 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'more than one IXBRL_FACT evidence row exists for this spread fact';
  END IF;
  IF evidence_count = 0 THEN
    INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, ixbrl_fact_id, run_id)
    VALUES ('L2_ORIGINAL_FILING', ${num(Number(artifact[0]))}, 'IXBRL_FACT', ${lit(spread.factId)}, ${num(runId)})
    RETURNING id INTO evidence_id;
  ELSE
    SELECT e.id INTO evidence_id
    FROM evidence.evidence e
    WHERE e.artifact_id = ${num(Number(artifact[0]))}
      AND e.locator_type = 'IXBRL_FACT'
      AND e.evidence_level = 'L2_ORIGINAL_FILING'
      AND e.ixbrl_fact_id = ${lit(spread.factId)};
  END IF;
  INSERT INTO obs.position_field_value (
    position_observation_id, field_code, raw_value, normalized_numeric,
    currency_state, scale_state, value_state, normalization_rule_version_id, evidence_id, run_id)
  VALUES (
    ${num(positionId)}, 'SPREAD', ${lit(spread.rawValue)}, ${spread.rawValue}::numeric,
    'UNKNOWN', 'KNOWN', 'REPORTED', ${num(rule.id)}, evidence_id, ${num(runId)});
END
$bound_spread$;
INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify({
    position_observation_id: positionId,
    context_id: spread.contextId,
    spread_raw: spread.rawValue,
  }))}::jsonb, NULL);
COMMIT;`);
    const stored = one(queryRows(database, `SELECT f.id::text, f.raw_value, f.normalized_numeric::text,
        f.scale_state::text, e.id::text, e.locator_type::text, e.ixbrl_fact_id
      FROM obs.current_position_field_value f
      JOIN evidence.evidence e ON e.id = f.evidence_id
      WHERE f.position_observation_id = ${num(positionId)} AND f.field_code = 'SPREAD'`), "stored spread");
    return {
      runId,
      ruleVersionId: rule.id,
      positionId,
      contextId: spread.contextId,
      factId: stored[6],
      fieldValueId: Number(stored[0]),
      rawValue: stored[1],
      normalizedNumeric: stored[2],
      scaleState: stored[3],
      evidenceId: Number(stored[4]),
      locatorType: stored[5],
      statementRows: rows.length,
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
    const result = persistBoundSpread({
      database: DEFAULT_DATABASE,
      positionId: positionArgument(process.argv.slice(2)),
    });
    console.log(JSON.stringify(result));
  } catch (caught) {
    console.error(`bound-spread: ${caught.message}`);
    process.exit(1);
  }
}
