// Throwaway maturity inspection for the 17-position batch.
// Copies bdc_local, fetches HTML only for the two filings without a stored artifact,
// inserts inspections on the copy, then drops the copy.
// Not part of npm run test:pipeline:integration.
// Run: node --env-file=.env.local --test --test-timeout=1200000 pipeline/test/maturity-inspection-batch.integration.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, databaseExists, dropDatabase, dockerAvailable, psqlOrThrow, query,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { EXPECTED_UNIVERSE } from "../load/golden-gate.mjs";
import { MATURITY_BATCH, runMaturityInspectionBatch } from "../load/maturity-inspection-batch.mjs";
import { createSecClient, requireUserAgent } from "../lib/http.mjs";
import { measureP11 } from "../p11-readiness.mjs";
import { buildP11Audit } from "../normalize/p11-readiness.mjs";

const SOURCE = "bdc_local";

function scalar(database, sql) {
  const found = query(database, sql);
  assert.equal(found.length, 1, sql);
  return found[0];
}

function cloneLoadedDatabase(name) {
  const active = query("postgres", `SELECT count(*) FROM pg_stat_activity
    WHERE datname = '${SOURCE}' AND pid <> pg_backend_pid() AND state = 'active'
      AND query NOT ILIKE '%autovacuum%'`);
  if (active[0] !== "0") throw new Error(`${SOURCE} has an active query; refusing to copy it`);
  psqlOrThrow("postgres", `
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = '${SOURCE}' AND pid <> pg_backend_pid();
CREATE DATABASE "${name}" WITH TEMPLATE "${SOURCE}";
`);
}

test("the 17-position maturity batch stays on a throwaway copy", { timeout: 1_200_000 }, async (t) => {
  if (!dockerAvailable() || !containerRunning() || !databaseExists(SOURCE)) {
    t.skip("loaded bdc_local is not available");
    return;
  }
  const positionsBefore = scalar(SOURCE, "SELECT count(*) FROM obs.position_observation");
  const fieldsBefore = scalar(SOURCE, "SELECT count(*) FROM obs.position_field_value");
  const maturityBefore = scalar(SOURCE, `SELECT count(*) FROM obs.position_field_value
    WHERE field_code = 'MATURITY_DATE' AND value_state = 'REPORTED' AND normalized_date IS NOT NULL`);
  const clone = `bdc_maturity_batch_${process.pid}`;
  const savedPipelineUrl = process.env.PIPELINE_DATABASE_URL;
  delete process.env.PIPELINE_DATABASE_URL;
  dropDatabase(clone);
  let finished = false;
  try {
    cloneLoadedDatabase(clone);
    migrate(clone);
    assert.equal(scalar(clone, "SELECT count(*) FROM ops.schema_migration WHERE filename = '0023_maturity_inspection.sql'"), "1");
    const client = createSecClient({ userAgent: requireUserAgent() });
    const batch = await runMaturityInspectionBatch({
      database: clone,
      client,
      sessionId: `maturity-batch-${process.pid}`,
    });
    assert.equal(batch.results.length, MATURITY_BATCH.length);
    assert.equal(batch.before.positions, EXPECTED_UNIVERSE.position_observation_count);
    assert.equal(batch.after.positions, batch.before.positions);
    assert.equal(batch.after.field_values, batch.before.field_values);
    assert.equal(batch.after.maturity_rows, batch.before.maturity_rows);
    assert.equal(batch.after.maturity_reported, batch.before.maturity_reported);
    assert.equal(batch.after.classifications, batch.before.classifications);
    for (const row of batch.results) {
      const candidates = row.candidates.map((candidate) => `${candidate.raw}${candidate.normalized ? `=${candidate.normalized}` : ""}`).join("; ");
      console.log([
        row.position_id,
        row.line_number,
        row.accession,
        row.outcome,
        row.provenance_state,
        row.context_id ?? "",
        row.displayed_raw ?? "",
        row.normalized_date ?? "",
        row.structured_date ?? "",
        candidates,
        row.reason ?? "",
      ].join("\t"));
    }
    console.log(JSON.stringify({ before: batch.before, after: batch.after }));
    assert.equal(batch.after.inspections, batch.results.filter((row) => row.written).length);
    assert.equal(
      batch.after.maturity_year_lines - batch.before.maturity_year_lines,
      batch.results.filter((row) => row.provenance_state === "FILING_DISPLAYED").length,
    );
    const proven = batch.results.find((row) => row.position_id === 606);
    assert.equal(proven.outcome, "FILING_DISPLAYED");
    assert.equal(proven.provenance_state, "FILING_DISPLAYED");
    assert.equal(proven.context_id, "c-1596");
    assert.equal(proven.displayed_raw, "2/4/2030");
    assert.equal(proven.normalized_date, "2030-02-04");
    assert.equal(proven.structured_date, null);
    const measured = measureP11(clone);
    const audit = buildP11Audit(measured);
    assert.equal(audit.population.position_observations, EXPECTED_UNIVERSE.position_observation_count);
    assert.equal(audit.population.field_values, EXPECTED_UNIVERSE.position_field_value_count);
    assert.equal(audit.attributes.maturity_date.REPORTED, Number(maturityBefore));
    finished = true;
  } finally {
    dropDatabase(clone);
    if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
  }
  assert.equal(finished, true);
  assert.equal(scalar(SOURCE, `SELECT count(*) FROM ops.schema_migration
    WHERE filename IN ('0021_soi_row_kind.sql', '0022_soi_classification_evidence.sql', '0023_maturity_inspection.sql',
      '0024_maturity_inspection_not_bound.sql', '0025_maturity_provenance.sql', '0026_maturity_read_path.sql')`), "0");
  assert.equal(scalar(SOURCE, "SELECT count(*) FROM obs.position_observation"), positionsBefore);
  assert.equal(scalar(SOURCE, "SELECT count(*) FROM obs.position_field_value"), fieldsBefore);
});
