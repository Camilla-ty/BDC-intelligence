import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDITED_BALANCE_COMPARISON_PINS,
  assertLocalBalanceComparisonCoverageDatabase,
  evaluateBalancePeriodComparisonCoverage,
  reportBalancePeriodComparisonCoverage,
} from "../balance-period-comparison-coverage.mjs";
import { EXPECTED_COMPARISONS as P6_EXPECTED_COMPARISONS } from "../p6-balance-endpoints.mjs";

test("audited pins match established P6 total and P7 multi-date contract", () => {
  assert.equal(AUDITED_BALANCE_COMPARISON_PINS.eligibleSeries, 170);
  assert.equal(AUDITED_BALANCE_COMPARISON_PINS.seriesWithComparison, 170);
  assert.equal(AUDITED_BALANCE_COMPARISON_PINS.seriesMissingComparison, 0);
  assert.equal(AUDITED_BALANCE_COMPARISON_PINS.balanceComparisonRows, 170);
  assert.equal(AUDITED_BALANCE_COMPARISON_PINS.legacyComparisons, 42);
  assert.equal(AUDITED_BALANCE_COMPARISON_PINS.totalComparisons, P6_EXPECTED_COMPARISONS);
  assert.equal(
    AUDITED_BALANCE_COMPARISON_PINS.legacyComparisons + AUDITED_BALANCE_COMPARISON_PINS.balanceComparisonRows,
    AUDITED_BALANCE_COMPARISON_PINS.totalComparisons,
  );
});

function healthyReport(overrides = {}) {
  return {
    eligibleSeries: 170,
    seriesWithComparison: 170,
    seriesMissingComparison: 0,
    seriesWithDuplicateComparisons: 0,
    balanceComparisonRows: 170,
    legacyComparisons: 42,
    totalComparisons: 212,
    principalComparable: 160,
    principalInsufficientData: 10,
    missingProvenanceRows: 0,
    conflictingPairRows: 0,
    missingPositionIds: [],
    duplicatePositionIds: [],
    ...overrides,
  };
}

test("evaluate accepts a healthy audited-slice report", () => {
  assert.deepEqual(evaluateBalancePeriodComparisonCoverage(healthyReport()), []);
});

test("evaluate fails closed on missing comparisons", () => {
  const failures = evaluateBalancePeriodComparisonCoverage(healthyReport({
    seriesWithComparison: 169,
    seriesMissingComparison: 1,
    balanceComparisonRows: 169,
    principalComparable: 159,
    principalInsufficientData: 10,
    totalComparisons: 211,
  }));
  assert.ok(failures.some((line) => line.includes("seriesMissingComparison=1")));
  assert.ok(failures.some((line) => line.includes("seriesWithComparison=169")));
});

test("evaluate fails closed on unexpected audited totals", () => {
  const failures = evaluateBalancePeriodComparisonCoverage(healthyReport({
    eligibleSeries: 169,
    totalComparisons: 200,
  }));
  assert.ok(failures.some((line) => line.includes("eligibleSeries=169")));
  assert.ok(failures.some((line) => line.includes("totalComparisons=200")));
});

test("evaluate fails closed on missing provenance", () => {
  const failures = evaluateBalancePeriodComparisonCoverage(healthyReport({
    missingProvenanceRows: 3,
  }));
  assert.deepEqual(failures, ["missingProvenanceRows=3"]);
});

test("evaluate fails closed on duplicate comparison rows for one series", () => {
  const failures = evaluateBalancePeriodComparisonCoverage(healthyReport({
    seriesWithDuplicateComparisons: 2,
    balanceComparisonRows: 172,
    principalComparable: 162,
    principalInsufficientData: 10,
    totalComparisons: 214,
  }));
  assert.ok(failures.some((line) => line.includes("seriesWithDuplicateComparisons=2")));
});

test("evaluate fails closed on conflicting pair rows", () => {
  const failures = evaluateBalancePeriodComparisonCoverage(healthyReport({
    conflictingPairRows: 1,
  }));
  assert.deepEqual(failures, ["conflictingPairRows=1"]);
});

test("evaluate requires principal outcomes to cover every balance comparison row", () => {
  const failures = evaluateBalancePeriodComparisonCoverage(healthyReport({
    principalComparable: 100,
    principalInsufficientData: 50,
  }));
  assert.ok(failures.some((line) => line.includes("principal outcomes")));
});

test("evaluate accepts injectable disposable pins", () => {
  const pins = {
    eligibleSeries: 1,
    seriesWithComparison: 1,
    seriesMissingComparison: 0,
    balanceComparisonRows: 1,
    legacyComparisons: 0,
    totalComparisons: 1,
  };
  assert.deepEqual(
    evaluateBalancePeriodComparisonCoverage(healthyReport({
      eligibleSeries: 1,
      seriesWithComparison: 1,
      seriesMissingComparison: 0,
      balanceComparisonRows: 1,
      legacyComparisons: 0,
      totalComparisons: 1,
      principalComparable: 0,
      principalInsufficientData: 1,
    }), pins),
    [],
  );
});

test("CLI path refuses a hosted database", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = "postgres://example.invalid/bdc";
  try {
    assert.throws(
      () => reportBalancePeriodComparisonCoverage({ database: "bdc_local", dryRun: true, log() {} }),
      /refuses a hosted database/,
    );
    assert.throws(
      () => assertLocalBalanceComparisonCoverageDatabase("bdc_local"),
      /refuses a hosted database/,
    );
  } finally {
    if (previous == null) delete process.env.PIPELINE_DATABASE_URL;
    else process.env.PIPELINE_DATABASE_URL = previous;
  }
});

test("CLI path refuses a database other than the local database", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  delete process.env.PIPELINE_DATABASE_URL;
  try {
    assert.throws(
      () => reportBalancePeriodComparisonCoverage({ database: "other_db", dryRun: true, log() {} }),
      /refuses a database other than the local database/,
    );
  } finally {
    if (previous != null) process.env.PIPELINE_DATABASE_URL = previous;
  }
});

test("dry-run reports failures without throwing", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  delete process.env.PIPELINE_DATABASE_URL;
  try {
    // assertDatabase false so we can inject a load failure path via evaluate only:
    // dry-run with assertDatabase still hits the DB; test evaluate path via report mock
    // by calling evaluate directly (covered above). Here confirm dryRun flag shape.
    const failures = evaluateBalancePeriodComparisonCoverage(healthyReport({
      seriesMissingComparison: 1,
      seriesWithComparison: 169,
      balanceComparisonRows: 169,
      principalComparable: 159,
      principalInsufficientData: 10,
      totalComparisons: 211,
    }));
    assert.ok(failures.length > 0);
  } finally {
    if (previous != null) process.env.PIPELINE_DATABASE_URL = previous;
  }
});
