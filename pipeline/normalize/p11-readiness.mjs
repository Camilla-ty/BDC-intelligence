// P11 readiness classification. Pure. No database writes and no financial arithmetic.
// A missing field on an existing position observation is UNKNOWN. It is not zero.
// EMPTY_PERIOD has no position population. It is UNAVAILABLE, not a zero count.

export const COVERAGE_STATES = ["REPORTED", "UNKNOWN", "UNRESOLVED", "UNAVAILABLE"];
export const CAPABILITY_STATES = ["SUPPORTED", "PARTIALLY_SUPPORTED", "BLOCKED"];

function nonNegativeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

// Remainder of an existing population is UNKNOWN. The caller does not pass a guessed value.
export function fieldCoverage({ population, reported, unresolved = 0, unavailable = 0 }) {
  const pop = nonNegativeInteger("population", population);
  const rep = nonNegativeInteger("reported", reported);
  const unr = nonNegativeInteger("unresolved", unresolved);
  const una = nonNegativeInteger("unavailable", unavailable);
  const unknown = pop - rep - unr - una;
  if (unknown < 0) throw new Error("coverage states exceed the population");
  return { REPORTED: rep, UNKNOWN: unknown, UNRESOLVED: unr, UNAVAILABLE: una };
}

export function releaseCoverage(row) {
  if (row.coverage_state === "EMPTY_PERIOD" || row.coverage_state !== "COVERED") {
    return {
      release_label: row.release_label,
      cadence: row.cadence,
      soi_coverage_state: row.coverage_state,
      position_observations: "UNAVAILABLE",
      maturity_date: "UNAVAILABLE",
      principal_amount: "UNAVAILABLE",
      instrument_type: "UNAVAILABLE",
      reported_dates: "UNAVAILABLE",
    };
  }
  const positions = nonNegativeInteger("positions", row.positions);
  return {
    release_label: row.release_label,
    cadence: row.cadence,
    soi_coverage_state: "COVERED",
    position_observations: positions,
    maturity_date: fieldCoverage({ population: positions, reported: row.maturity_reported }),
    principal_amount: fieldCoverage({ population: positions, reported: row.principal_reported }),
    instrument_type: fieldCoverage({ population: positions, reported: row.type_reported }),
    reported_dates: nonNegativeInteger("reported_dates", row.reported_dates),
  };
}

function complete(states) {
  return states.REPORTED > 0 && states.UNKNOWN === 0 && states.UNRESOLVED === 0 && states.UNAVAILABLE === 0;
}

// Observation-level features can use REPORTED dates only.
// An instrument queue needs a MATCHED instrument. A borrower total needs a MATCHED legal entity.
export function classifyCapabilities(input) {
  const maturity = input.maturity;
  const hasMaturity = maturity.REPORTED > 0;
  const maturityComplete = complete(maturity);
  const principalComplete = complete(input.principal);
  const instrumentsComplete = input.instrumentMatched === input.positionObservations && input.positionObservations > 0;
  const entitiesComplete = input.entityMatched === input.positionObservations && input.positionObservations > 0;
  const pipelineSupported = hasMaturity && maturityComplete && principalComplete && instrumentsComplete && entitiesComplete;

  let maturityWall = "BLOCKED";
  if (hasMaturity) maturityWall = maturityComplete ? "SUPPORTED" : "PARTIALLY_SUPPORTED";

  let upcoming = "BLOCKED";
  if (hasMaturity) upcoming = maturityComplete ? "SUPPORTED" : "PARTIALLY_SUPPORTED";

  let pipeline = "BLOCKED";
  if (pipelineSupported) pipeline = "SUPPORTED";
  else if (input.instrumentMatched > 0 && hasMaturity) pipeline = "PARTIALLY_SUPPORTED";

  let borrower = "BLOCKED";
  if (input.matchedEntityWithMaturity > 0) {
    borrower = input.entityMatched === input.matchedEntityWithMaturity && maturityComplete ? "SUPPORTED" : "PARTIALLY_SUPPORTED";
  }

  let bdc = "BLOCKED";
  if (input.registrantsWithMaturity > 0) {
    const everyRegistrant = input.registrantsWithMaturity === input.registrantsWithPositions;
    bdc = everyRegistrant && maturityComplete ? "SUPPORTED" : "PARTIALLY_SUPPORTED";
  }

  return {
    maturity_wall: maturityWall,
    upcoming_maturities: upcoming,
    refinancing_pipeline: pipeline,
    borrower_level_maturity: borrower,
    bdc_level_maturity: bdc,
  };
}

export function buildP11Audit(measured) {
  const positions = measured.universe.position_observations;
  const maturity = fieldCoverage({
    population: positions,
    reported: measured.maturity.reported,
    unresolved: measured.maturity.unresolved ?? 0,
  });
  const principal = fieldCoverage({
    population: positions,
    reported: measured.principal.reported,
    unresolved: measured.principal.unresolved ?? 0,
  });
  const instrumentType = fieldCoverage({
    population: positions,
    reported: measured.instrument_type.reported,
    unresolved: measured.instrument_type.unresolved ?? 0,
  });
  const reportedDate = fieldCoverage({
    population: positions,
    reported: measured.reported_date.reported,
    unresolved: measured.reported_date.unresolved ?? 0,
  });
  const registrant = {
    REPORTED: measured.registrant.linked,
    UNKNOWN: measured.registrant.unknown,
    UNRESOLVED: measured.registrant.multiple,
    UNAVAILABLE: measured.registrant.unavailable,
  };
  for (const state of COVERAGE_STATES) nonNegativeInteger(`registrant.${state}`, registrant[state]);
  const registrantSum = COVERAGE_STATES.reduce((sum, state) => sum + registrant[state], 0);
  if (registrantSum !== positions) throw new Error("registrant states do not cover every position observation");

  const legalEntity = {
    REPORTED: 0,
    UNKNOWN: 0,
    UNRESOLVED: measured.legal_entity.unresolved,
    UNAVAILABLE: measured.legal_entity.unavailable,
    MATCHED: measured.legal_entity.matched,
    PROBABLE: measured.legal_entity.probable,
    REJECTED: measured.legal_entity.rejected,
  };
  const legalSum = legalEntity.UNRESOLVED + legalEntity.UNAVAILABLE + legalEntity.MATCHED + legalEntity.PROBABLE + legalEntity.REJECTED;
  if (legalSum !== positions) throw new Error("legal-entity states do not cover every position observation");

  const instrumentResolution = {
    REPORTED: 0,
    UNKNOWN: 0,
    UNRESOLVED: measured.instrument_resolution.unresolved,
    UNAVAILABLE: measured.instrument_resolution.unavailable,
    MATCHED: measured.instrument_resolution.matched,
    PROBABLE: measured.instrument_resolution.probable,
    REJECTED: measured.instrument_resolution.rejected,
  };
  const instrumentSum = instrumentResolution.UNRESOLVED + instrumentResolution.UNAVAILABLE
    + instrumentResolution.MATCHED + instrumentResolution.PROBABLE + instrumentResolution.REJECTED;
  if (instrumentSum !== positions) throw new Error("instrument-resolution states do not cover every position observation");

  if (measured.universe.position_observations + measured.universe.no_identifier_rows !== measured.universe.soi_rows) {
    throw new Error("SOI rows do not equal position observations plus rows with no identifier");
  }

  const releases = measured.releases.map(releaseCoverage);
  const coveredPositions = releases
    .filter((row) => row.soi_coverage_state === "COVERED")
    .reduce((sum, row) => sum + row.position_observations, 0);
  if (coveredPositions !== positions) throw new Error("COVERED releases do not account for every position observation");

  const yearSum = measured.maturity_years.reduce((sum, row) => sum + row.reported_observations, 0);
  if (yearSum !== maturity.REPORTED) throw new Error("maturity year counts do not equal REPORTED maturity");

  const capabilities = classifyCapabilities({
    positionObservations: positions,
    maturity,
    principal,
    instrumentMatched: instrumentResolution.MATCHED,
    entityMatched: legalEntity.MATCHED,
    matchedEntityWithMaturity: measured.golden.maturity_reported > 0 ? measured.legal_entity.matched : 0,
    registrantsWithPositions: measured.registrants_with_positions,
    registrantsWithMaturity: measured.registrants_with_maturity,
  });

  // Golden name observations are the only legal-entity decisions. A REPORTED maturity
  // on that set is the only borrower-level maturity this database can support.
  if (measured.golden.observations !== legalEntity.MATCHED) {
    throw new Error("MATCHED legal entities and golden name observations differ");
  }

  return {
    phase: "11-readiness",
    audit: "p11_maturity_coverage",
    version: "1",
    database: measured.database,
    queried_at: measured.queried_at,
    population: {
      soi_rows: measured.universe.soi_rows,
      position_observations: positions,
      field_values: measured.universe.field_values,
      no_identifier_rows: {
        count: measured.universe.no_identifier_rows,
        maturity_date: "UNAVAILABLE",
        principal_amount: "UNAVAILABLE",
        instrument_type: "UNAVAILABLE",
        reason: "NO_IDENTIFIER_ROW has no position observation. The row is not zero maturity or zero principal.",
      },
      dataset_releases: measured.universe.releases,
    },
    attributes: {
      maturity_date: {
        ...maturity,
        disclosed_zero_is_not_applicable: true,
        note: "REPORTED requires value_state REPORTED and a normalized date. A position with no row is UNKNOWN.",
      },
      principal_amount: {
        ...principal,
        disclosed_numeric_zero_inside_reported: measured.principal.disclosed_zero,
        note: "A disclosed numeric zero stays inside REPORTED. A position with no row is UNKNOWN.",
      },
      instrument_type: {
        ...instrumentType,
        note: "A REPORTED type is the stored Investment Type Axis text. It is not a MATCHED instrument.",
      },
      reported_date: {
        ...reportedDate,
        distinct_dates: measured.reported_date.distinct,
        note: "Every position observation stores the SOI ddate that parsed. Dates with no row in a series are absent.",
      },
      registrant: {
        ...registrant,
        registrants_with_positions: measured.registrants_with_positions,
        registrants_with_reported_maturity: measured.registrants_with_maturity,
        note: "REPORTED means the filing registrant link is LINKED. CIK identifies the registrant, not the borrower. MULTIPLE would be UNRESOLVED.",
      },
      legal_entity: {
        ...legalEntity,
        note: "MATCHED stays MATCHED. It is not relabeled REPORTED. A position with no resolution decision is UNAVAILABLE. It is not inferred as UNRESOLVED.",
      },
      instrument_resolution: {
        ...instrumentResolution,
        note: "UNRESOLVED is a stored decision. A position with no decision is UNAVAILABLE. Instrument type does not create a MATCHED instrument.",
      },
    },
    overlap: measured.overlap,
    golden: {
      observations: measured.golden.observations,
      maturity_reported: measured.golden.maturity_reported,
      principal_reported: measured.golden.principal_reported,
      instrument_type_reported: measured.golden.type_reported,
      entity_matched: measured.legal_entity.matched,
      instrument_unresolved: measured.instrument_resolution.unresolved,
      broader_dataset_has_usable_maturity: maturity.REPORTED > 0 && measured.golden.maturity_reported === 0,
    },
    maturity_span: measured.maturity_span,
    maturity_years: measured.maturity_years,
    q14: measured.q14,
    golden_gate: measured.golden_gate,
    capabilities,
    releases,
    reported_dates: measured.reported_dates.map((row) => ({
      reported_date: row.reported_date,
      position_observations: row.positions,
      maturity_date: fieldCoverage({ population: row.positions, reported: row.maturity_reported }),
    })),
    registrants: measured.registrants.map((row) => ({
      registrant_cik: row.cik,
      position_observations: row.positions,
      maturity_date: fieldCoverage({ population: row.positions, reported: row.maturity_reported }),
      principal_amount: fieldCoverage({ population: row.positions, reported: row.principal_reported }),
      instrument_type: fieldCoverage({ population: row.positions, reported: row.type_reported }),
    })),
  };
}

export function renderP11Report(audit) {
  const a = audit.attributes;
  const lines = [
    "# P11 readiness / maturity coverage",
    "",
    `Queried ${audit.queried_at} from \`${audit.database}\`. Read-only. No SEC download, no reload, and no change to resolution, Q14, or the Golden Gate.`,
    "",
    "## Population",
    "",
    `| Item | Count |`,
    `| --- | ---: |`,
    `| SOI rows | ${audit.population.soi_rows} |`,
    `| Position observations | ${audit.population.position_observations} |`,
    `| Field values | ${audit.population.field_values} |`,
    `| SOI rows with no identifier | ${audit.population.no_identifier_rows.count} |`,
    `| Dataset releases | ${audit.population.dataset_releases} |`,
    "",
    `${audit.population.no_identifier_rows.count} SOI rows have no position observation. Maturity, principal, and instrument type on those rows are UNAVAILABLE. They are not zero.`,
    "",
    "## Attribute coverage on position observations",
    "",
    "| Attribute | REPORTED | UNKNOWN | UNRESOLVED | UNAVAILABLE | Other stored state |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    `| Maturity date | ${a.maturity_date.REPORTED} | ${a.maturity_date.UNKNOWN} | ${a.maturity_date.UNRESOLVED} | ${a.maturity_date.UNAVAILABLE} | |`,
    `| Principal amount | ${a.principal_amount.REPORTED} | ${a.principal_amount.UNKNOWN} | ${a.principal_amount.UNRESOLVED} | ${a.principal_amount.UNAVAILABLE} | disclosed numeric zero inside REPORTED: ${a.principal_amount.disclosed_numeric_zero_inside_reported} |`,
    `| Instrument type | ${a.instrument_type.REPORTED} | ${a.instrument_type.UNKNOWN} | ${a.instrument_type.UNRESOLVED} | ${a.instrument_type.UNAVAILABLE} | |`,
    `| Reported date | ${a.reported_date.REPORTED} | ${a.reported_date.UNKNOWN} | ${a.reported_date.UNRESOLVED} | ${a.reported_date.UNAVAILABLE} | distinct dates: ${a.reported_date.distinct_dates} |`,
    `| Filing registrant | ${a.registrant.REPORTED} | ${a.registrant.UNKNOWN} | ${a.registrant.UNRESOLVED} | ${a.registrant.UNAVAILABLE} | REPORTED here means link status LINKED |`,
    `| Legal entity | ${a.legal_entity.REPORTED} | ${a.legal_entity.UNKNOWN} | ${a.legal_entity.UNRESOLVED} | ${a.legal_entity.UNAVAILABLE} | MATCHED ${a.legal_entity.MATCHED}; PROBABLE ${a.legal_entity.PROBABLE}; REJECTED ${a.legal_entity.REJECTED} |`,
    `| Instrument resolution | ${a.instrument_resolution.REPORTED} | ${a.instrument_resolution.UNKNOWN} | ${a.instrument_resolution.UNRESOLVED} | ${a.instrument_resolution.UNAVAILABLE} | MATCHED ${a.instrument_resolution.MATCHED} |`,
    "",
    "A position with no maturity, principal, or instrument-type row is UNKNOWN. MATCHED legal entity stays MATCHED and is not renamed REPORTED. A position with no resolution decision is UNAVAILABLE.",
    "",
    `Registrants with at least one position: ${a.registrant.registrants_with_positions}. Registrants with at least one REPORTED maturity: ${a.registrant.registrants_with_reported_maturity}. The others have positions whose maturity is UNKNOWN.`,
    "",
    `REPORTED maturity and REPORTED principal on the same position: ${audit.overlap.maturity_and_principal}. REPORTED maturity and REPORTED instrument type: ${audit.overlap.maturity_and_type}. All three: ${audit.overlap.maturity_principal_and_type}.`,
    "",
    `Stored maturity dates run from ${audit.maturity_span.earliest} through ${audit.maturity_span.latest}. Every REPORTED date stays in the count, including dates outside 2020–2100. They are not rewritten.`,
    "",
    "## Golden slice and the rest of the SOI",
    "",
    `Golden name observations: ${audit.golden.observations}. REPORTED maturity on that set: ${audit.golden.maturity_reported}. REPORTED instrument type: ${audit.golden.instrument_type_reported}. REPORTED principal: ${audit.golden.principal_reported}. Legal entity MATCHED: ${audit.golden.entity_matched}. Instrument resolution UNRESOLVED: ${audit.golden.instrument_unresolved}.`,
    "",
    audit.golden.broader_dataset_has_usable_maturity
      ? `The Golden slice has no REPORTED maturity. The position population has ${a.maturity_date.REPORTED} REPORTED maturity dates. Those dates are usable stored observations. They do not make the Golden slice mature, and the Golden gap does not erase the rest of the file.`
      : "This measurement does not show REPORTED maturity outside the Golden slice.",
    "",
    "## Releases",
    "",
    "| Release | SOI coverage | Positions | Maturity REPORTED | Maturity UNKNOWN | Principal REPORTED | Type REPORTED |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const row of audit.releases) {
    if (row.position_observations === "UNAVAILABLE") {
      lines.push(`| ${row.release_label} | ${row.soi_coverage_state} | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE | UNAVAILABLE |`);
    } else {
      lines.push(`| ${row.release_label} | ${row.soi_coverage_state} | ${row.position_observations} | ${row.maturity_date.REPORTED} | ${row.maturity_date.UNKNOWN} | ${row.principal_amount.REPORTED} | ${row.instrument_type.REPORTED} |`);
    }
  }
  lines.push(
    "",
    "EMPTY_PERIOD is a stored empty SOI member. Its maturity is UNAVAILABLE. It is not a zero maturity count.",
    "",
    "## Capabilities",
    "",
    "| Feature | Status | Why |",
    "| --- | --- | --- |",
    `| Maturity Wall | ${audit.capabilities.maturity_wall} | REPORTED maturity dates can be counted by the stored year. Positions without a date stay UNKNOWN and are omitted. Fair value stays on Q14. |`,
    `| Upcoming Maturities | ${audit.capabilities.upcoming_maturities} | A horizon can filter REPORTED maturity dates. Dates that were not stored stay UNKNOWN. |`,
    `| Refinancing Pipeline | ${audit.capabilities.refinancing_pipeline} | A pipeline row is an instrument. MATCHED instruments: ${a.instrument_resolution.MATCHED}. UNRESOLVED decisions: ${a.instrument_resolution.UNRESOLVED}. |`,
    `| Borrower-level maturity | ${audit.capabilities.borrower_level_maturity} | MATCHED legal entities: ${a.legal_entity.MATCHED}. REPORTED maturity on that set: ${audit.golden.maturity_reported}. Other maturity rows have no legal-entity decision. |`,
    `| BDC-level maturity | ${audit.capabilities.bdc_level_maturity} | ${a.registrant.registrants_with_reported_maturity} of ${a.registrant.registrants_with_positions} registrants have a REPORTED maturity. CIK is the registrant. |`,
    "",
    "## Unchanged controls",
    "",
    `Golden Gate run ${audit.golden_gate.run_id}: ${audit.golden_gate.overall}. Pass ${audit.golden_gate.n_pass}, blocked ${audit.golden_gate.n_blocked}, fail ${audit.golden_gate.n_fail}. Golden observations ${audit.golden_gate.golden_observation_count}.`,
    "",
    `Q14: ${audit.q14.status}. Derived inputs from Q14 mappings: ${audit.q14.derived_inputs}.`,
    "",
    "Per-date and per-registrant counts are in `p11_coverage_matrix.json`. This audit does not implement the Refinancing Hub.",
    "",
  );
  return `${lines.join("\n")}`;
}
