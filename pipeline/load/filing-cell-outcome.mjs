// Run completion for a filing-cell ingestion. This file is not part of the parser rule definition.
// The evidence transaction commits inside ingestFilingCompanyCell. This module
// records the run outcome only after that function returns.

import { lit, num, queryRows } from "../lib/db.mjs";
import { ingestFilingCompanyCell } from "./filing-cell.mjs";

const SUCCEEDED_COUNTS = {
  disclosure_blocks: 1,
  company_cells: 1,
  borrower_name_observations: 1,
};

// One completion row for this run. A failure before this call leaves the run STARTED.
// An existing outcome is left unchanged.
export function recordFilingCellIngestSucceeded(database, runId) {
  const rows = queryRows(database, `
INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
SELECT ${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(SUCCEEDED_COUNTS))}::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM ops.run_outcome existing WHERE existing.run_id = ${num(runId)})
RETURNING id;`);
  if (rows.length !== 1) {
    throw new Error("filing-cell run already has an outcome; a second SUCCEEDED outcome was not written");
  }
}

export function completeFilingCellIngest(input) {
  const result = ingestFilingCompanyCell(input);
  recordFilingCellIngestSucceeded(input.database, input.runId);
  return result;
}
