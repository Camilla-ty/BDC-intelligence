import test from "node:test";
import assert from "node:assert/strict";
import {
  buildP11Audit, classifyCapabilities, fieldCoverage, releaseCoverage, renderP11Report,
} from "../normalize/p11-readiness.mjs";

test("a missing field on an existing population is UNKNOWN", () => {
  const states = fieldCoverage({ population: 10, reported: 4 });
  assert.deepEqual(states, { REPORTED: 4, UNKNOWN: 6, UNRESOLVED: 0, UNAVAILABLE: 0 });
  assert.equal(states.UNKNOWN + states.REPORTED, 10);
});

test("coverage states may not exceed the population", () => {
  assert.throws(() => fieldCoverage({ population: 3, reported: 4 }), /exceed/);
});

test("an empty SOI period is UNAVAILABLE and has no numeric maturity count", () => {
  const row = releaseCoverage({
    release_label: "2099_06",
    cadence: "MONTHLY",
    coverage_state: "EMPTY_PERIOD",
    positions: 0,
    maturity_reported: 0,
    principal_reported: 0,
    type_reported: 0,
    reported_dates: 0,
  });
  assert.equal(row.position_observations, "UNAVAILABLE");
  assert.equal(row.maturity_date, "UNAVAILABLE");
  assert.equal(JSON.stringify(row).includes("\"REPORTED\":0"), false);
});

test("a covered release with no maturity row keeps those positions UNKNOWN", () => {
  const row = releaseCoverage({
    release_label: "2099q4",
    cadence: "QUARTERLY",
    coverage_state: "COVERED",
    positions: 5,
    maturity_reported: 0,
    principal_reported: 2,
    type_reported: 0,
    reported_dates: 1,
  });
  assert.equal(row.maturity_date.REPORTED, 0);
  assert.equal(row.maturity_date.UNKNOWN, 5);
  assert.equal(row.principal_amount.UNKNOWN, 3);
});

test("disclosed principal zero stays inside REPORTED", () => {
  const audit = buildP11Audit(fixture({
    principal: { reported: 8, unresolved: 0, disclosed_zero: 3 },
  }));
  assert.equal(audit.attributes.principal_amount.REPORTED, 8);
  assert.equal(audit.attributes.principal_amount.disclosed_numeric_zero_inside_reported, 3);
  assert.equal(audit.attributes.principal_amount.UNKNOWN, 2);
});

test("universe maturity with a golden gap is partial, and the instrument queue stays blocked", () => {
  const audit = buildP11Audit(fixture());
  assert.equal(audit.golden.broader_dataset_has_usable_maturity, true);
  assert.equal(audit.capabilities.maturity_wall, "PARTIALLY_SUPPORTED");
  assert.equal(audit.capabilities.upcoming_maturities, "PARTIALLY_SUPPORTED");
  assert.equal(audit.capabilities.refinancing_pipeline, "BLOCKED");
  assert.equal(audit.capabilities.borrower_level_maturity, "BLOCKED");
  assert.equal(audit.capabilities.bdc_level_maturity, "PARTIALLY_SUPPORTED");
  assert.equal(audit.attributes.legal_entity.MATCHED, 2);
  assert.equal(audit.attributes.legal_entity.UNAVAILABLE, 8);
  assert.equal(audit.attributes.instrument_resolution.UNRESOLVED, 2);
  const text = renderP11Report(audit);
  assert.match(text, /PARTIALLY_SUPPORTED/);
  assert.match(text, /EMPTY_PERIOD/);
  assert.doesNotMatch(text, /\$\s?\d/);
  assert.doesNotMatch(text, /zero exposure/);
});

test("no stored maturity blocks every maturity feature", () => {
  const got = classifyCapabilities({
    positionObservations: 10,
    maturity: fieldCoverage({ population: 10, reported: 0 }),
    principal: fieldCoverage({ population: 10, reported: 10 }),
    instrumentMatched: 0,
    entityMatched: 0,
    matchedEntityWithMaturity: 0,
    registrantsWithPositions: 3,
    registrantsWithMaturity: 0,
  });
  assert.equal(got.maturity_wall, "BLOCKED");
  assert.equal(got.upcoming_maturities, "BLOCKED");
  assert.equal(got.refinancing_pipeline, "BLOCKED");
  assert.equal(got.borrower_level_maturity, "BLOCKED");
  assert.equal(got.bdc_level_maturity, "BLOCKED");
});

test("complete maturity, principal, instrument, and entity coverage is supported", () => {
  const population = 4;
  const full = fieldCoverage({ population, reported: population });
  const got = classifyCapabilities({
    positionObservations: population,
    maturity: full,
    principal: full,
    instrumentMatched: population,
    entityMatched: population,
    matchedEntityWithMaturity: population,
    registrantsWithPositions: 1,
    registrantsWithMaturity: 1,
  });
  assert.equal(got.maturity_wall, "SUPPORTED");
  assert.equal(got.upcoming_maturities, "SUPPORTED");
  assert.equal(got.refinancing_pipeline, "SUPPORTED");
  assert.equal(got.borrower_level_maturity, "SUPPORTED");
  assert.equal(got.bdc_level_maturity, "SUPPORTED");
});

function fixture(overrides = {}) {
  return {
    database: "test_db",
    queried_at: "2099-01-01T00:00:00.000Z",
    universe: {
      soi_rows: 12,
      position_observations: 10,
      field_values: 40,
      no_identifier_rows: 2,
      releases: 2,
    },
    maturity: { reported: 6, unresolved: 0 },
    principal: { reported: 8, unresolved: 0, disclosed_zero: 1 },
    instrument_type: { reported: 1, unresolved: 0 },
    reported_date: { reported: 10, unresolved: 0, distinct: 2 },
    registrant: { linked: 10, multiple: 0, unknown: 0, unavailable: 0 },
    legal_entity: { matched: 2, probable: 0, unresolved: 0, rejected: 0, unavailable: 8 },
    instrument_resolution: { matched: 0, probable: 0, unresolved: 2, rejected: 0, unavailable: 8 },
    overlap: { maturity_and_principal: 5, maturity_and_type: 1, maturity_principal_and_type: 1 },
    golden: { observations: 2, maturity_reported: 0, principal_reported: 1, type_reported: 0 },
    registrants_with_positions: 3,
    registrants_with_maturity: 2,
    maturity_span: { earliest: "2099-03-31", latest: "2100-06-30" },
    maturity_years: [{ year: 2099, reported_observations: 4 }, { year: 2100, reported_observations: 2 }],
    q14: { status: "OPEN_QUESTION", derived_inputs: 0 },
    golden_gate: { run_id: 1, overall: "PASS", n_pass: 1, n_blocked: 0, n_fail: 0, golden_observation_count: 2 },
    releases: [
      {
        release_label: "2099q4", cadence: "QUARTERLY", coverage_state: "COVERED",
        positions: 10, maturity_reported: 6, principal_reported: 8, type_reported: 1, reported_dates: 2,
      },
      {
        release_label: "2099_06", cadence: "MONTHLY", coverage_state: "EMPTY_PERIOD",
        positions: null, maturity_reported: null, principal_reported: null, type_reported: null, reported_dates: null,
      },
    ],
    reported_dates: [
      { reported_date: "2099-03-31", positions: 4, maturity_reported: 1 },
      { reported_date: "2099-06-30", positions: 6, maturity_reported: 5 },
    ],
    registrants: [
      { cik: "0000000001", positions: 7, maturity_reported: 4, principal_reported: 6, type_reported: 1 },
      { cik: "0000000002", positions: 3, maturity_reported: 2, principal_reported: 2, type_reported: 0 },
    ],
    ...overrides,
    principal: { reported: 8, unresolved: 0, disclosed_zero: 1, ...overrides.principal },
  };
}
