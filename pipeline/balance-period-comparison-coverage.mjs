#!/usr/bin/env node
// Read-only coverage gate for registry.position_period_comparison on the audited
// balance slice after P4 → P7 continuity → P6. Reuses the view's stored deltas
// and comparison states. Does not write, invent arithmetic, or infer exits.
//
//   node pipeline/balance-period-comparison-coverage.mjs [--dry-run] [--db bdc_local]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import { SOI_FACT_GROUP_RULE } from "./normalize/soi-observation-group.mjs";

// Audited-slice pins. Sources (do not invent):
// - eligibleSeries / seriesWithComparison / balanceComparisonRows = 170
//   from pipeline/p7-balance-candidates.mjs EXPECTED_MULTI_DATE (series with
//   n = 2 and n_dates = 2 under MATCHED instrument + continuity). Each such
//   series is exactly one consecutive pair in registry.position_period_comparison.
// - seriesMissingComparison = 0 (full coverage of those 170 pairs).
// - legacyComparisons = 42 from p7-balance-candidates.mjs isolationSnapshot
//   (comparisons with no balance fact-group endpoint).
// - totalComparisons = 212 from pipeline/p6-balance-endpoints.mjs
//   EXPECTED_COMPARISONS (42 legacy + 170 balance after P7 continuity).
// COMPARABLE vs INSUFFICIENT_DATA counts are reported only; no audited pin exists.
export const AUDITED_BALANCE_COMPARISON_PINS = Object.freeze({
  eligibleSeries: 170,
  seriesWithComparison: 170,
  seriesMissingComparison: 0,
  balanceComparisonRows: 170,
  legacyComparisons: 42,
  totalComparisons: 212,
});

function opt(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function jsonRow(database, sql) {
  const rows = queryRows(database, sql);
  if (rows.length !== 1 || rows[0].length !== 1) throw new Error("expected one JSON row");
  return JSON.parse(rows[0][0]);
}

export function assertLocalBalanceComparisonCoverageDatabase(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("balance period-comparison coverage refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("balance period-comparison coverage refuses a database other than the local database");
  }
}

/**
 * Read coverage of multi-date MATCHED balance series against the period-comparison view.
 * No writes. Does not apply audited pins.
 */
export function loadBalancePeriodComparisonCoverage(database) {
  return jsonRow(database, `
WITH cand AS (
  SELECT m.position_observation_id, p.reported_date
  FROM obs.position_observation_group g
  JOIN ops.rule_version rv ON rv.id = g.rule_version_id
    AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
    AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
  JOIN obs.position_observation_group_member m
    ON m.group_id = g.id AND m.member_role = 'BALANCE'
  JOIN obs.position_observation p ON p.id = m.position_observation_id
),
series AS (
  SELECT d.position_id,
         count(*)::integer AS n,
         count(DISTINCT c.reported_date)::integer AS n_dates
  FROM cand c
  JOIN resolution.current_instrument_resolution i
    ON i.position_observation_id = c.position_observation_id
  JOIN resolution.current_position_continuity d
    ON d.position_observation_id = c.position_observation_id
  WHERE i.state = 'MATCHED' AND d.state = 'MATCHED'
    AND d.position_id IS NOT NULL
  GROUP BY d.position_id
),
eligible AS (
  SELECT position_id FROM series WHERE n = 2 AND n_dates = 2
),
balance_comparisons AS (
  SELECT c.position_id,
         c.earlier_position_observation_id,
         c.later_position_observation_id,
         c.earlier_accession_number,
         c.later_accession_number,
         c.earlier_observation_evidence_id,
         c.later_observation_evidence_id,
         c.principal_comparison_state,
         c.principal_delta,
         c.cost_comparison_state,
         c.fair_value_comparison_state
  FROM registry.position_period_comparison c
  JOIN eligible e ON e.position_id = c.position_id
),
per_position AS (
  SELECT e.position_id,
         count(c.position_id)::integer AS comparison_rows
  FROM eligible e
  LEFT JOIN balance_comparisons c ON c.position_id = e.position_id
  GROUP BY e.position_id
),
legacy_comparisons AS (
  SELECT c.position_id
  FROM registry.position_period_comparison c
  WHERE NOT EXISTS (
    SELECT 1
    FROM obs.position_observation_group g
    JOIN ops.rule_version rv ON rv.id = g.rule_version_id
      AND rv.rule_code = ${lit(SOI_FACT_GROUP_RULE.code)}
      AND rv.version = ${lit(SOI_FACT_GROUP_RULE.version)}
    JOIN obs.position_observation_group_member m
      ON m.group_id = g.id AND m.member_role = 'BALANCE'
     AND m.position_observation_id IN (c.earlier_position_observation_id, c.later_position_observation_id)
  )
)
SELECT json_build_object(
  'eligibleSeries', (SELECT count(*)::integer FROM eligible),
  'seriesWithComparison', (SELECT count(*)::integer FROM per_position WHERE comparison_rows >= 1),
  'seriesMissingComparison', (SELECT count(*)::integer FROM per_position WHERE comparison_rows = 0),
  'seriesWithDuplicateComparisons', (SELECT count(*)::integer FROM per_position WHERE comparison_rows > 1),
  'balanceComparisonRows', (SELECT count(*)::integer FROM balance_comparisons),
  'legacyComparisons', (SELECT count(*)::integer FROM legacy_comparisons),
  'totalComparisons', (SELECT count(*)::integer FROM registry.position_period_comparison),
  'principalComparable', (
    SELECT count(*)::integer FROM balance_comparisons
    WHERE principal_comparison_state = 'COMPARABLE'),
  'principalInsufficientData', (
    SELECT count(*)::integer FROM balance_comparisons
    WHERE principal_comparison_state = 'INSUFFICIENT_DATA'),
  'missingProvenanceRows', (
    SELECT count(*)::integer FROM balance_comparisons c
    WHERE c.earlier_accession_number IS NULL
       OR c.later_accession_number IS NULL
       OR nullif(btrim(c.earlier_accession_number), '') IS NULL
       OR nullif(btrim(c.later_accession_number), '') IS NULL
       OR c.earlier_observation_evidence_id IS NULL
       OR c.later_observation_evidence_id IS NULL),
  'conflictingPairRows', (
    SELECT count(*)::integer FROM (
      SELECT earlier_position_observation_id, later_position_observation_id
      FROM balance_comparisons
      GROUP BY earlier_position_observation_id, later_position_observation_id
      HAVING count(*) > 1
    ) x),
  'missingPositionIds', (
    SELECT coalesce(json_agg(position_id ORDER BY position_id::text), '[]'::json)
    FROM per_position WHERE comparison_rows = 0),
  'duplicatePositionIds', (
    SELECT coalesce(json_agg(position_id ORDER BY position_id::text), '[]'::json)
    FROM per_position WHERE comparison_rows > 1)
)::text;`);
}

/**
 * Fail-closed evaluation against pins. Does not invent COMPARABLE/INSUFFICIENT pins.
 */
export function evaluateBalancePeriodComparisonCoverage(report, pins = AUDITED_BALANCE_COMPARISON_PINS) {
  const failures = [];
  const num = (key) => Number(report[key]);

  if (num("eligibleSeries") !== pins.eligibleSeries) {
    failures.push(`eligibleSeries=${report.eligibleSeries} expected=${pins.eligibleSeries}`);
  }
  if (num("seriesWithComparison") !== pins.seriesWithComparison) {
    failures.push(`seriesWithComparison=${report.seriesWithComparison} expected=${pins.seriesWithComparison}`);
  }
  if (num("seriesMissingComparison") !== pins.seriesMissingComparison) {
    failures.push(`seriesMissingComparison=${report.seriesMissingComparison} expected=${pins.seriesMissingComparison}`);
  }
  if (num("balanceComparisonRows") !== pins.balanceComparisonRows) {
    failures.push(`balanceComparisonRows=${report.balanceComparisonRows} expected=${pins.balanceComparisonRows}`);
  }
  if (pins.legacyComparisons != null && num("legacyComparisons") !== pins.legacyComparisons) {
    failures.push(`legacyComparisons=${report.legacyComparisons} expected=${pins.legacyComparisons}`);
  }
  if (pins.totalComparisons != null && num("totalComparisons") !== pins.totalComparisons) {
    failures.push(`totalComparisons=${report.totalComparisons} expected=${pins.totalComparisons}`);
  }

  if (num("seriesWithDuplicateComparisons") !== 0) {
    failures.push(`seriesWithDuplicateComparisons=${report.seriesWithDuplicateComparisons}`);
  }
  if (num("conflictingPairRows") !== 0) {
    failures.push(`conflictingPairRows=${report.conflictingPairRows}`);
  }
  if (num("missingProvenanceRows") !== 0) {
    failures.push(`missingProvenanceRows=${report.missingProvenanceRows}`);
  }

  const outcomeSum = num("principalComparable") + num("principalInsufficientData");
  if (outcomeSum !== num("balanceComparisonRows")) {
    failures.push(
      `principal outcomes ${report.principalComparable}+${report.principalInsufficientData}`
      + ` != balanceComparisonRows=${report.balanceComparisonRows}`,
    );
  }

  return failures;
}

export function reportBalancePeriodComparisonCoverage({
  database = DEFAULT_DATABASE,
  dryRun = false,
  log = console.log,
  pins = AUDITED_BALANCE_COMPARISON_PINS,
  assertDatabase = true,
} = {}) {
  if (assertDatabase) assertLocalBalanceComparisonCoverageDatabase(database);
  const coverage = loadBalancePeriodComparisonCoverage(database);
  const failures = evaluateBalancePeriodComparisonCoverage(coverage, pins);
  const result = {
    ...coverage,
    dryRun,
    ok: failures.length === 0,
    failures,
    pins,
  };
  log(JSON.stringify(result));
  if (!dryRun && failures.length > 0) {
    throw new Error(`balance period-comparison coverage failed: ${failures.join("; ")}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  reportBalancePeriodComparisonCoverage({
    database,
    dryRun: args.includes("--dry-run"),
  });
}
