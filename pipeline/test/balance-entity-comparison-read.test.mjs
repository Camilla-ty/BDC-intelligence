import test from "node:test";
import assert from "node:assert/strict";
import { AUDITED_BALANCE_COMPARISON_PINS } from "../balance-period-comparison-coverage.mjs";
import {
  AUDITED_BALANCE_ENTITY_COMPARISON_PINS,
  assertLocalBalanceEntityComparisonReadDatabase,
  evaluateBalanceEntityComparisonRead,
  reportBalanceEntityComparisonRead,
} from "../balance-entity-comparison-read.mjs";
import {
  EXPECTED_NEW_BATCHES,
  EXPECTED_REUSE_BATCHES,
  EXPECTED_TARGETS,
} from "../p6-balance-endpoints.mjs";

test("entity-read pins match P6 batch entities and prior comparison coverage", () => {
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.balanceComparisonRows, 170);
  assert.equal(
    AUDITED_BALANCE_ENTITY_COMPARISON_PINS.balanceComparisonRows,
    AUDITED_BALANCE_COMPARISON_PINS.balanceComparisonRows,
  );
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.retrievableSeries, 170);
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.seriesMissingFromReader, 0);
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.seriesMissingEntityMapping, 0);
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.seriesCrossEntityMismatch, 0);
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.seriesAmbiguousEntityMapping, 0);
  assert.equal(
    AUDITED_BALANCE_ENTITY_COMPARISON_PINS.distinctEntities,
    EXPECTED_NEW_BATCHES + EXPECTED_REUSE_BATCHES,
  );
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.distinctEntities, 100);
  assert.equal(AUDITED_BALANCE_ENTITY_COMPARISON_PINS.p6EndpointTargets, EXPECTED_TARGETS);
});

function healthyReport(overrides = {}) {
  return {
    balanceComparisonRows: 170,
    seriesSameEntityMapped: 170,
    seriesMissingEntityMapping: 0,
    seriesAmbiguousEntityMapping: 0,
    seriesCrossEntityMismatch: 0,
    distinctEntities: 100,
    retrievableSeries: 170,
    seriesMissingFromReader: 0,
    provenanceMismatches: 0,
    outcomeMismatches: 0,
    duplicateReaderRows: 0,
    crossEntityLeaks: 0,
    principalComparable: 170,
    principalInsufficientData: 0,
    readerRowsForEntities: 177,
    ...overrides,
  };
}

test("evaluate accepts a healthy audited entity-read report", () => {
  assert.deepEqual(evaluateBalanceEntityComparisonRead(healthyReport()), []);
});

test("evaluate fails closed on missing entity mapping", () => {
  const failures = evaluateBalanceEntityComparisonRead(healthyReport({
    seriesSameEntityMapped: 169,
    seriesMissingEntityMapping: 1,
    retrievableSeries: 169,
    distinctEntities: 99,
  }));
  assert.ok(failures.some((line) => line.includes("seriesMissingEntityMapping=1")));
});

test("evaluate fails closed on cross-entity mismatch", () => {
  const failures = evaluateBalanceEntityComparisonRead(healthyReport({
    seriesSameEntityMapped: 169,
    seriesCrossEntityMismatch: 1,
    retrievableSeries: 169,
  }));
  assert.ok(failures.some((line) => line.includes("seriesCrossEntityMismatch=1")));
});

test("evaluate fails closed on missing reader rows and provenance gaps", () => {
  const failures = evaluateBalanceEntityComparisonRead(healthyReport({
    retrievableSeries: 169,
    seriesMissingFromReader: 1,
    provenanceMismatches: 2,
  }));
  assert.ok(failures.some((line) => line.includes("seriesMissingFromReader=1")));
  assert.ok(failures.some((line) => line.includes("provenanceMismatches=2")));
});

test("evaluate fails closed on duplicate reader rows and cross-entity leaks", () => {
  const failures = evaluateBalanceEntityComparisonRead(healthyReport({
    duplicateReaderRows: 1,
    crossEntityLeaks: 1,
  }));
  assert.ok(failures.some((line) => line.includes("duplicateReaderRows=1")));
  assert.ok(failures.some((line) => line.includes("crossEntityLeaks=1")));
});

test("evaluate fails closed on unexpected entity totals", () => {
  const failures = evaluateBalanceEntityComparisonRead(healthyReport({
    distinctEntities: 99,
  }));
  assert.ok(failures.some((line) => line.includes("distinctEntities=99 expected=100")));
});

test("evaluate accepts injectable disposable pins", () => {
  const pins = {
    balanceComparisonRows: 1,
    retrievableSeries: 1,
    seriesMissingFromReader: 0,
    seriesMissingEntityMapping: 0,
    seriesCrossEntityMismatch: 0,
    seriesAmbiguousEntityMapping: 0,
    distinctEntities: 1,
    provenanceMismatches: 0,
    outcomeMismatches: 0,
    duplicateReaderRows: 0,
    crossEntityLeaks: 0,
  };
  assert.deepEqual(
    evaluateBalanceEntityComparisonRead(healthyReport({
      balanceComparisonRows: 1,
      seriesSameEntityMapped: 1,
      distinctEntities: 1,
      retrievableSeries: 1,
      principalComparable: 1,
      readerRowsForEntities: 1,
    }), pins),
    [],
  );
});

test("CLI path refuses a hosted database", () => {
  const previous = process.env.PIPELINE_DATABASE_URL;
  process.env.PIPELINE_DATABASE_URL = "postgres://example.invalid/bdc";
  try {
    assert.throws(
      () => reportBalanceEntityComparisonRead({ database: "bdc_local", dryRun: true, log() {} }),
      /refuses a hosted database/,
    );
    assert.throws(
      () => assertLocalBalanceEntityComparisonReadDatabase("bdc_local"),
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
      () => reportBalanceEntityComparisonRead({ database: "other_db", dryRun: true, log() {} }),
      /refuses a database other than the local database/,
    );
  } finally {
    if (previous != null) process.env.PIPELINE_DATABASE_URL = previous;
  }
});
