#!/usr/bin/env node
// Read-only gate: audited balance-slice period comparisons are retrievable through
// registry.borrower_position_comparisons for the MATCHED legal entity on both
// endpoints. Entity scope follows registry.position_read (Identifier Axis name →
// current_entity_resolution), never position_id or Identifier Axis text alone.
// Reuses stored comparison rows and deltas. Does not write or invent arithmetic.
//
// Calls the entity-scoped reader as the session role (asWriter: false):
// bdc_pipeline_writer is not granted EXECUTE on borrower_position_comparisons.
//
//   node pipeline/balance-entity-comparison-read.mjs [--dry-run] [--db bdc_local]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDITED_BALANCE_COMPARISON_PINS } from "./balance-period-comparison-coverage.mjs";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import { IDENTIFIER_COLUMN } from "./normalize/borrower-name.mjs";
import { SOI_FACT_GROUP_RULE } from "./normalize/soi-observation-group.mjs";
import {
  EXPECTED_NEW_BATCHES,
  EXPECTED_REUSE_BATCHES,
  EXPECTED_TARGETS,
} from "./p6-balance-endpoints.mjs";

// Audited-slice pins. Sources (do not invent):
// - balanceComparisonRows / retrievableSeries = 170 from
//   AUDITED_BALANCE_COMPARISON_PINS / p7 EXPECTED_MULTI_DATE.
// - distinctEntities = 100 from p6 EXPECTED_NEW_BATCHES + EXPECTED_REUSE_BATCHES
//   (one exact-name batch → one legal entity for the 340 endpoints).
// - p6EndpointTargets = 340 from p6 EXPECTED_TARGETS (reported; linkage context).
export const AUDITED_BALANCE_ENTITY_COMPARISON_PINS = Object.freeze({
  balanceComparisonRows: AUDITED_BALANCE_COMPARISON_PINS.balanceComparisonRows,
  retrievableSeries: AUDITED_BALANCE_COMPARISON_PINS.balanceComparisonRows,
  seriesMissingFromReader: 0,
  seriesMissingEntityMapping: 0,
  seriesCrossEntityMismatch: 0,
  seriesAmbiguousEntityMapping: 0,
  distinctEntities: EXPECTED_NEW_BATCHES + EXPECTED_REUSE_BATCHES,
  p6EndpointTargets: EXPECTED_TARGETS,
  provenanceMismatches: 0,
  outcomeMismatches: 0,
  duplicateReaderRows: 0,
  crossEntityLeaks: 0,
});

function opt(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function jsonRow(database, sql) {
  // Read path: session role can EXECUTE borrower_position_comparisons; writer cannot.
  const rows = queryRows(database, sql, { asWriter: false });
  if (rows.length !== 1 || rows[0].length !== 1) throw new Error("expected one JSON row");
  return JSON.parse(rows[0][0]);
}

export function assertLocalBalanceEntityComparisonReadDatabase(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("balance entity-comparison read refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("balance entity-comparison read refuses a database other than the local database");
  }
}

/**
 * Load entity-scoped read coverage for balance-slice period comparisons.
 * No writes. Does not apply audited pins.
 */
export function loadBalanceEntityComparisonRead(database) {
  const column = lit(IDENTIFIER_COLUMN);
  return jsonRow(database, `
SET max_parallel_workers_per_gather = 0;
WITH cand AS (
  SELECT m.position_observation_id
  FROM obs.position_observation_group g
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
    AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
  JOIN obs.position_observation_group_member m
    ON m.group_id = g.id AND m.member_role = 'BALANCE'
),
balance_cmp AS (
  SELECT c.position_id,
         c.earlier_position_observation_id,
         c.later_position_observation_id,
         c.earlier_accession_number,
         c.later_accession_number,
         c.earlier_observation_evidence_id,
         c.later_observation_evidence_id,
         c.principal_comparison_state,
         c.principal_delta::text AS principal_delta
  FROM registry.position_period_comparison c
  WHERE c.earlier_position_observation_id IN (SELECT position_observation_id FROM cand)
    AND c.later_position_observation_id IN (SELECT position_observation_id FROM cand)
),
obs_entity AS (
  SELECT b.position_observation_id,
         count(*)::integer AS name_count,
         count(DISTINCT er.legal_entity_id) FILTER (WHERE er.state = 'MATCHED')::integer AS matched_entity_n,
         (array_agg(er.legal_entity_id::text ORDER BY er.legal_entity_id::text)
            FILTER (WHERE er.state = 'MATCHED'))[1] AS matched_entity
  FROM obs.current_borrower_name_observation b
  LEFT JOIN resolution.current_entity_resolution er
    ON er.borrower_name_observation_id = b.id
  WHERE b.source_column_label = ${column}
    AND b.extraction_state = 'EXTRACTED'
    AND b.position_observation_id IN (
      SELECT earlier_position_observation_id FROM balance_cmp
      UNION
      SELECT later_position_observation_id FROM balance_cmp
    )
  GROUP BY b.position_observation_id
),
classified AS (
  SELECT bc.*,
         ee.name_count AS earlier_name_count,
         ee.matched_entity_n AS earlier_entity_n,
         ee.matched_entity AS earlier_entity,
         le.name_count AS later_name_count,
         le.matched_entity_n AS later_entity_n,
         le.matched_entity AS later_entity,
         CASE
           WHEN ee.name_count IS DISTINCT FROM 1 OR le.name_count IS DISTINCT FROM 1
             OR ee.matched_entity_n IS DISTINCT FROM 1 OR le.matched_entity_n IS DISTINCT FROM 1
             OR ee.matched_entity IS NULL OR le.matched_entity IS NULL
             THEN 'AMBIGUOUS_OR_MISSING'
           WHEN ee.matched_entity IS DISTINCT FROM le.matched_entity
             THEN 'CROSS_ENTITY'
           ELSE 'SAME_ENTITY'
         END AS entity_mapping
  FROM balance_cmp bc
  LEFT JOIN obs_entity ee ON ee.position_observation_id = bc.earlier_position_observation_id
  LEFT JOIN obs_entity le ON le.position_observation_id = bc.later_position_observation_id
),
expected AS (
  SELECT *
  FROM classified
  WHERE entity_mapping = 'SAME_ENTITY'
),
entities AS (
  SELECT DISTINCT earlier_entity::uuid AS legal_entity_id FROM expected
),
retrieved AS (
  SELECT e.legal_entity_id,
         r.legal_entity_id AS returned_entity_id,
         r.position_id,
         r.earlier_position_observation_id,
         r.later_position_observation_id,
         r.earlier_accession_number,
         r.later_accession_number,
         r.earlier_observation_evidence_id,
         r.later_observation_evidence_id,
         r.principal_comparison_state,
         r.principal_delta
  FROM entities e
  CROSS JOIN LATERAL registry.borrower_position_comparisons(e.legal_entity_id) r
),
joined AS (
  SELECT x.position_id,
         x.earlier_position_observation_id,
         x.later_position_observation_id,
         x.earlier_accession_number,
         x.later_accession_number,
         x.earlier_observation_evidence_id,
         x.later_observation_evidence_id,
         x.principal_comparison_state,
         x.principal_delta,
         x.earlier_entity AS legal_entity_id,
         r.returned_entity_id,
         r.earlier_accession_number AS read_earlier_accession,
         r.later_accession_number AS read_later_accession,
         r.earlier_observation_evidence_id AS read_earlier_evidence,
         r.later_observation_evidence_id AS read_later_evidence,
         r.principal_comparison_state AS read_principal_state,
         r.principal_delta AS read_principal_delta
  FROM expected x
  LEFT JOIN retrieved r
    ON r.legal_entity_id = x.earlier_entity::uuid
   AND r.position_id = x.position_id::text
   AND r.earlier_position_observation_id = x.earlier_position_observation_id::text
   AND r.later_position_observation_id = x.later_position_observation_id::text
)
SELECT json_build_object(
  'balanceComparisonRows', (SELECT count(*)::integer FROM balance_cmp),
  'seriesSameEntityMapped', (SELECT count(*)::integer FROM expected),
  'seriesMissingEntityMapping', (
    SELECT count(*)::integer FROM classified
    WHERE entity_mapping = 'AMBIGUOUS_OR_MISSING'
      AND NOT (
        coalesce(earlier_entity_n, 0) > 1 OR coalesce(later_entity_n, 0) > 1
        OR coalesce(earlier_name_count, 0) > 1 OR coalesce(later_name_count, 0) > 1
      )),
  'seriesAmbiguousEntityMapping', (
    SELECT count(*)::integer FROM classified
    WHERE entity_mapping = 'AMBIGUOUS_OR_MISSING'
      AND (
        coalesce(earlier_entity_n, 0) > 1 OR coalesce(later_entity_n, 0) > 1
        OR coalesce(earlier_name_count, 0) > 1 OR coalesce(later_name_count, 0) > 1
      )),
  'seriesCrossEntityMismatch', (
    SELECT count(*)::integer FROM classified WHERE entity_mapping = 'CROSS_ENTITY'),
  'distinctEntities', (SELECT count(*)::integer FROM entities),
  'retrievableSeries', (
    SELECT count(*)::integer FROM joined WHERE returned_entity_id IS NOT NULL),
  'seriesMissingFromReader', (
    SELECT count(*)::integer FROM joined WHERE returned_entity_id IS NULL),
  'provenanceMismatches', (
    SELECT count(*)::integer FROM joined
    WHERE returned_entity_id IS NOT NULL
      AND (
        read_earlier_accession IS DISTINCT FROM earlier_accession_number
        OR read_later_accession IS DISTINCT FROM later_accession_number
        OR read_earlier_evidence IS DISTINCT FROM earlier_observation_evidence_id::text
        OR read_later_evidence IS DISTINCT FROM later_observation_evidence_id::text
        OR nullif(btrim(coalesce(read_earlier_accession, '')), '') IS NULL
        OR nullif(btrim(coalesce(read_later_accession, '')), '') IS NULL
        OR read_earlier_evidence IS NULL
        OR read_later_evidence IS NULL
      )),
  'outcomeMismatches', (
    SELECT count(*)::integer FROM joined
    WHERE returned_entity_id IS NOT NULL
      AND (
        read_principal_state IS DISTINCT FROM principal_comparison_state
        OR read_principal_delta IS DISTINCT FROM principal_delta
      )),
  'duplicateReaderRows', (
    SELECT count(*)::integer FROM (
      SELECT legal_entity_id, position_id, earlier_position_observation_id, later_position_observation_id
      FROM retrieved
      GROUP BY 1, 2, 3, 4
      HAVING count(*) > 1
    ) d),
  'crossEntityLeaks', (
    SELECT count(*)::integer FROM retrieved r
    WHERE EXISTS (
      SELECT 1 FROM expected e
      WHERE e.position_id::text = r.position_id
        AND e.earlier_position_observation_id::text = r.earlier_position_observation_id
        AND e.later_position_observation_id::text = r.later_position_observation_id
        AND e.earlier_entity::uuid IS DISTINCT FROM r.legal_entity_id
    )),
  'principalComparable', (
    SELECT count(*)::integer FROM joined
    WHERE returned_entity_id IS NOT NULL AND read_principal_state = 'COMPARABLE'),
  'principalInsufficientData', (
    SELECT count(*)::integer FROM joined
    WHERE returned_entity_id IS NOT NULL AND read_principal_state = 'INSUFFICIENT_DATA'),
  'readerRowsForEntities', (SELECT count(*)::integer FROM retrieved)
)::text;`);
}

export function evaluateBalanceEntityComparisonRead(report, pins = AUDITED_BALANCE_ENTITY_COMPARISON_PINS) {
  const failures = [];
  const num = (key) => Number(report[key]);

  if (num("balanceComparisonRows") !== pins.balanceComparisonRows) {
    failures.push(`balanceComparisonRows=${report.balanceComparisonRows} expected=${pins.balanceComparisonRows}`);
  }
  if (num("retrievableSeries") !== pins.retrievableSeries) {
    failures.push(`retrievableSeries=${report.retrievableSeries} expected=${pins.retrievableSeries}`);
  }
  if (num("seriesMissingFromReader") !== pins.seriesMissingFromReader) {
    failures.push(`seriesMissingFromReader=${report.seriesMissingFromReader} expected=${pins.seriesMissingFromReader}`);
  }
  if (num("seriesMissingEntityMapping") !== pins.seriesMissingEntityMapping) {
    failures.push(`seriesMissingEntityMapping=${report.seriesMissingEntityMapping} expected=${pins.seriesMissingEntityMapping}`);
  }
  if (num("seriesCrossEntityMismatch") !== pins.seriesCrossEntityMismatch) {
    failures.push(`seriesCrossEntityMismatch=${report.seriesCrossEntityMismatch} expected=${pins.seriesCrossEntityMismatch}`);
  }
  if (num("seriesAmbiguousEntityMapping") !== pins.seriesAmbiguousEntityMapping) {
    failures.push(`seriesAmbiguousEntityMapping=${report.seriesAmbiguousEntityMapping} expected=${pins.seriesAmbiguousEntityMapping}`);
  }
  if (num("distinctEntities") !== pins.distinctEntities) {
    failures.push(`distinctEntities=${report.distinctEntities} expected=${pins.distinctEntities}`);
  }
  if (num("provenanceMismatches") !== pins.provenanceMismatches) {
    failures.push(`provenanceMismatches=${report.provenanceMismatches}`);
  }
  if (num("outcomeMismatches") !== pins.outcomeMismatches) {
    failures.push(`outcomeMismatches=${report.outcomeMismatches}`);
  }
  if (num("duplicateReaderRows") !== pins.duplicateReaderRows) {
    failures.push(`duplicateReaderRows=${report.duplicateReaderRows}`);
  }
  if (num("crossEntityLeaks") !== pins.crossEntityLeaks) {
    failures.push(`crossEntityLeaks=${report.crossEntityLeaks}`);
  }

  if (num("seriesSameEntityMapped") !== num("retrievableSeries") + num("seriesMissingFromReader")) {
    failures.push(
      `same-entity mapped ${report.seriesSameEntityMapped}`
      + ` != retrievable+missing ${report.retrievableSeries}+${report.seriesMissingFromReader}`,
    );
  }

  const mappedTotal = num("seriesSameEntityMapped")
    + num("seriesMissingEntityMapping")
    + num("seriesAmbiguousEntityMapping")
    + num("seriesCrossEntityMismatch");
  if (mappedTotal !== num("balanceComparisonRows")) {
    failures.push(
      `entity mapping classes ${mappedTotal} != balanceComparisonRows=${report.balanceComparisonRows}`,
    );
  }

  return failures;
}

export function reportBalanceEntityComparisonRead({
  database = DEFAULT_DATABASE,
  dryRun = false,
  log = console.log,
  pins = AUDITED_BALANCE_ENTITY_COMPARISON_PINS,
  assertDatabase = true,
} = {}) {
  if (assertDatabase) assertLocalBalanceEntityComparisonReadDatabase(database);
  const coverage = loadBalanceEntityComparisonRead(database);
  const failures = evaluateBalanceEntityComparisonRead(coverage, pins);
  const result = {
    ...coverage,
    dryRun,
    ok: failures.length === 0,
    failures,
    pins,
  };
  log(JSON.stringify(result));
  if (!dryRun && failures.length > 0) {
    throw new Error(`balance entity-comparison read failed: ${failures.join("; ")}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  reportBalanceEntityComparisonRead({
    database,
    dryRun: args.includes("--dry-run"),
  });
}
