// FILING_CELL ingestion. The SOI_CELL path in p4-min.mjs is separate and is not used here.
// prepareFilingCellObservation validates the company cell. This module inserts evidence
// and the borrower-name row only from that payload, under parser v2's rule_version_id.

import { lit, num, queryRows } from "../lib/db.mjs";
import { prepareFilingCellObservation } from "../parse/filing-cell-writer.mjs";
import { PARSER_CODE, PARSER_VERSION } from "../parse/schedule-disclosure-block.mjs";

export function ingestFilingCompanyCell({
  database, runId, rules, html, artifact, filingLink, positionFilingId, positionObservationId,
  blockEvidence, evidence, rawText,
}) {
  const payload = prepareFilingCellObservation({
    html, artifact, filingLink, positionFilingId, evidence, blockEvidence, rawText,
  });
  if (payload.nameSource !== "FILING_CELL" || payload.locatorType !== "HTML_TABLE_CELL" || payload.parserVersion !== PARSER_VERSION) {
    throw new Error("FILING_CELL payload was not produced by parser v2");
  }
  const parserRuleId = Number(rules?.[PARSER_CODE]);
  if (!parserRuleId) throw new Error("missing persisted parser.sec_schedule_disclosure_block rule_version_id");

  const linked = queryRows(database, `
SELECT rv.id
FROM ops.run_rule_version rr
JOIN ops.rule_version rv ON rv.id = rr.rule_version_id
WHERE rr.run_id = ${num(runId)}
  AND rv.id = ${num(parserRuleId)}
  AND rv.rule_code = ${lit(PARSER_CODE)}
  AND rv.version = ${lit(PARSER_VERSION)}`);
  if (linked.length !== 1) throw new Error("parser v2 is not registered on this run");

  const rows = queryRows(database, `
BEGIN;
CREATE TEMP TABLE filing_cell_ingest (kind text PRIMARY KEY, id bigint) ON COMMIT DROP;
WITH block AS (
  INSERT INTO evidence.evidence (
    evidence_level, artifact_id, locator_type, html_row_ordinal, html_row_end_ordinal, run_id)
  VALUES ('L2_ORIGINAL_FILING', ${num(artifact.id)}, 'DISCLOSURE_BLOCK',
          ${num(payload.blockStartRow)}, ${num(payload.blockEndRow)}, ${num(runId)})
  RETURNING id
)
INSERT INTO filing_cell_ingest (kind, id)
SELECT 'block', id FROM block;
WITH cell AS (
  INSERT INTO evidence.evidence (
    evidence_level, artifact_id, locator_type, html_row_ordinal, html_slot_ordinal, block_evidence_id, run_id)
  SELECT 'L2_ORIGINAL_FILING', ${num(artifact.id)}, 'HTML_TABLE_CELL',
         ${num(payload.htmlRowOrdinal)}, ${num(payload.htmlSlotOrdinal)}, id, ${num(runId)}
  FROM filing_cell_ingest WHERE kind = 'block'
  RETURNING id
)
INSERT INTO filing_cell_ingest (kind, id)
SELECT 'cell', id FROM cell;
INSERT INTO obs.borrower_name_observation (
  position_observation_id, name_source, raw_text, extraction_state, rule_version_id, evidence_id, run_id)
SELECT ${num(positionObservationId)}, ${lit(payload.nameSource)}, ${lit(payload.rawText)},
       'RAW_ONLY', ${num(parserRuleId)}, id, ${num(runId)}
FROM filing_cell_ingest WHERE kind = 'cell'
RETURNING id, evidence_id;
COMMIT;`);
  return {
    observationId: Number(rows[0][0]),
    evidenceId: Number(rows[0][1]),
    ruleVersionId: parserRuleId,
    payload,
  };
}
