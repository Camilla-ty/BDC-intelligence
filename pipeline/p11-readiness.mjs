#!/usr/bin/env node
// P11 readiness audit. SELECT only. Writes .data/validation/p11/. Does not load SEC data.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, REPO_ROOT } from "./lib/config.mjs";
import { queryRows } from "./lib/db.mjs";
import { buildP11Audit, renderP11Report } from "./normalize/p11-readiness.mjs";

const OUT_DIR = path.join(REPO_ROOT, ".data", "validation", "p11");
const GOLDEN_JSON = path.join(REPO_ROOT, ".data", "validation", "golden", "golden_gate.json");
const GOLDEN_MD = path.join(REPO_ROOT, ".data", "validation", "golden", "GOLDEN_GATE_REPORT.md");

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function integer(value, label) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} is not a count: ${value}`);
  return n;
}

function sha256(file) {
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function foldField(rows, code) {
  const mine = rows.filter((row) => row[0] === code);
  let reported = 0;
  let unresolved = 0;
  let disclosedZero = 0;
  for (const row of mine) {
    const valueState = row[1];
    const scaleState = row[2];
    const stored = integer(row[3], code);
    const withDate = integer(row[4], code);
    const withNumeric = integer(row[5], code);
    const withText = integer(row[6], code);
    const numericZero = integer(row[7], code);
    if (valueState !== "REPORTED") throw new Error(`${code} has stored value_state ${valueState}`);
    const usable = code === "MATURITY_DATE" ? withDate : code === "PRINCIPAL_AMOUNT" ? withNumeric : withText;
    if (scaleState === "UNRESOLVED" || usable !== stored) unresolved += stored - usable;
    else reported += usable;
    if (code === "PRINCIPAL_AMOUNT") disclosedZero += numericZero;
  }
  return { reported, unresolved, disclosed_zero: disclosedZero };
}

function stateCount(rows, state) {
  const found = rows.find((row) => row[0] === state);
  return found ? integer(found[1], state) : 0;
}

export function measureP11(database) {
  const before = queryRows(database, `SELECT
    (SELECT count(*) FROM obs.soi_row_observation),
    (SELECT count(*) FROM obs.position_observation),
    (SELECT count(*) FROM obs.position_field_value);`);
  const [soiRows, positions, fieldValues] = before[0].map((value, i) => integer(value, `universe ${i}`));

  const fieldRows = queryRows(database, `SELECT field_code, value_state::text, scale_state::text,
    count(*),
    count(*) FILTER (WHERE normalized_date IS NOT NULL),
    count(*) FILTER (WHERE normalized_numeric IS NOT NULL),
    count(*) FILTER (WHERE btrim(coalesce(normalized_text, '')) <> ''),
    count(*) FILTER (WHERE normalized_numeric = 0)
  FROM obs.position_field_value
  WHERE field_code IN ('MATURITY_DATE', 'PRINCIPAL_AMOUNT', 'INSTRUMENT_TYPE')
  GROUP BY 1, 2, 3
  ORDER BY 1, 2, 3;`);

  const noIdentifier = integer(queryRows(database, `SELECT count(*) FROM obs.current_soi_row_classification WHERE row_kind = 'NO_IDENTIFIER_ROW';`)[0][0], "no identifier");
  const dateRow = queryRows(database, `SELECT count(*) FILTER (WHERE reported_date IS NULL), count(DISTINCT reported_date) FROM obs.position_observation;`)[0];
  const reportedDateMissing = integer(dateRow[0], "null reported date");
  const distinctDates = integer(dateRow[1], "distinct dates");

  const golden = queryRows(database, `SELECT
    (SELECT count(*) FROM obs.borrower_name_observation),
    (SELECT count(*) FROM obs.borrower_name_observation b
       JOIN obs.position_field_value fv ON fv.position_observation_id = b.position_observation_id
        AND fv.field_code = 'MATURITY_DATE' AND fv.value_state = 'REPORTED' AND fv.normalized_date IS NOT NULL),
    (SELECT count(*) FROM obs.borrower_name_observation b
       JOIN obs.position_field_value fv ON fv.position_observation_id = b.position_observation_id
        AND fv.field_code = 'PRINCIPAL_AMOUNT' AND fv.value_state = 'REPORTED' AND fv.normalized_numeric IS NOT NULL),
    (SELECT count(*) FROM obs.borrower_name_observation b
       JOIN obs.position_field_value fv ON fv.position_observation_id = b.position_observation_id
        AND fv.field_code = 'INSTRUMENT_TYPE' AND fv.value_state = 'REPORTED' AND btrim(coalesce(fv.normalized_text, '')) <> '');`)[0];

  const entityRows = queryRows(database, `SELECT state::text, count(*) FROM resolution.current_entity_resolution GROUP BY 1 ORDER BY 1;`);
  const instrumentRows = queryRows(database, `SELECT state::text, count(*) FROM resolution.current_instrument_resolution GROUP BY 1 ORDER BY 1;`);

  const linkRows = queryRows(database, `WITH filing_status AS (
    SELECT filing_id,
           CASE
             WHEN bool_or(registrant_link_status = 'MULTIPLE') THEN 'MULTIPLE'
             WHEN bool_or(registrant_link_status = 'LINKED') THEN 'LINKED'
             ELSE 'UNKNOWN'
           END AS status
    FROM registry.current_filing_registrant
    GROUP BY filing_id
  )
  SELECT coalesce(fs.status, 'UNKNOWN'), count(*)
  FROM obs.position_observation p
  LEFT JOIN filing_status fs ON fs.filing_id = p.filing_id
  GROUP BY 1
  ORDER BY 1;`);

  const overlap = queryRows(database, `WITH flags AS (
    SELECT position_observation_id,
           bool_or(field_code = 'MATURITY_DATE' AND normalized_date IS NOT NULL) AS has_maturity,
           bool_or(field_code = 'PRINCIPAL_AMOUNT' AND normalized_numeric IS NOT NULL) AS has_principal,
           bool_or(field_code = 'INSTRUMENT_TYPE' AND btrim(coalesce(normalized_text, '')) <> '') AS has_type
    FROM obs.position_field_value
    WHERE field_code IN ('MATURITY_DATE', 'PRINCIPAL_AMOUNT', 'INSTRUMENT_TYPE')
      AND value_state = 'REPORTED'
    GROUP BY position_observation_id
  )
  SELECT count(*) FILTER (WHERE has_maturity AND has_principal),
         count(*) FILTER (WHERE has_maturity AND has_type),
         count(*) FILTER (WHERE has_maturity AND has_principal AND has_type)
  FROM flags;`)[0];

  const years = queryRows(database, `SELECT extract(year FROM normalized_date)::int, count(*)
    FROM obs.position_field_value
    WHERE field_code = 'MATURITY_DATE' AND value_state = 'REPORTED' AND normalized_date IS NOT NULL
    GROUP BY 1 ORDER BY 1;`).map((row) => ({
    year: integer(row[0], "maturity year"),
    reported_observations: integer(row[1], "maturity year count"),
  }));

  const span = queryRows(database, `SELECT min(normalized_date)::text, max(normalized_date)::text
    FROM obs.position_field_value
    WHERE field_code = 'MATURITY_DATE' AND value_state = 'REPORTED' AND normalized_date IS NOT NULL;`)[0];

  const q14Rows = queryRows(database, `SELECT column_label, mapping_status::text, coalesce(open_question_ref, '')
    FROM ref.current_column_mapping
    WHERE open_question_ref = 'Q14'
    ORDER BY column_label;`);
  const derivedInputs = integer(queryRows(database, `SELECT count(*)
    FROM derived.derived_value_input i
    JOIN obs.position_field_value fv ON fv.id = i.field_value_id
    JOIN ref.source_column_mapping m ON m.id = fv.column_mapping_id
    WHERE m.open_question_ref = 'Q14';`)[0][0], "q14 inputs");

  const gate = queryRows(database, `SELECT o.run_id::text, o.counts->>'overall', o.counts->>'n_pass',
      o.counts->>'n_blocked', o.counts->>'n_fail', o.counts->>'golden_observation_count'
    FROM ops.run_outcome o
    JOIN ops.run r ON r.id = o.run_id
    WHERE r.run_kind = 'GOLDEN_GATE' AND o.status = 'SUCCEEDED'
    ORDER BY o.run_id DESC
    LIMIT 1;`)[0];

  const releases = queryRows(database, `WITH flags AS (
      SELECT position_observation_id,
             bool_or(field_code = 'MATURITY_DATE' AND normalized_date IS NOT NULL) AS has_maturity,
             bool_or(field_code = 'PRINCIPAL_AMOUNT' AND normalized_numeric IS NOT NULL) AS has_principal,
             bool_or(field_code = 'INSTRUMENT_TYPE' AND btrim(coalesce(normalized_text, '')) <> '') AS has_type
      FROM obs.position_field_value
      WHERE field_code IN ('MATURITY_DATE', 'PRINCIPAL_AMOUNT', 'INSTRUMENT_TYPE')
        AND value_state = 'REPORTED'
      GROUP BY position_observation_id
    ),
    located AS (
      SELECT d.release_label, p.reported_date, f.has_maturity, f.has_principal, f.has_type
      FROM obs.position_observation p
      JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
      JOIN raw.tabular_row t ON t.id = o.tabular_row_id
      JOIN raw.table_load tl ON tl.id = t.table_load_id
      JOIN registry.dataset_release_artifact a ON a.artifact_id = tl.artifact_id
      JOIN registry.dataset_release d ON d.id = a.dataset_release_id
      LEFT JOIN flags f ON f.position_observation_id = p.id
    ),
    rolled AS (
      SELECT release_label, count(*) AS positions,
             count(*) FILTER (WHERE has_maturity) AS maturity_reported,
             count(*) FILTER (WHERE has_principal) AS principal_reported,
             count(*) FILTER (WHERE has_type) AS type_reported,
             count(DISTINCT reported_date) AS reported_dates
      FROM located
      GROUP BY release_label
    )
    SELECT d.release_label, d.cadence, c.coverage_state::text,
           r.positions, r.maturity_reported, r.principal_reported, r.type_reported, r.reported_dates
    FROM registry.dataset_release d
    LEFT JOIN ops.current_coverage c
      ON c.dataset_release_id = d.id AND c.registrant_id IS NULL AND c.coverage_aspect = 'SOI_HOLDINGS'
    LEFT JOIN rolled r ON r.release_label = d.release_label
    ORDER BY d.release_label;`).map((row) => ({
    release_label: row[0],
    cadence: row[1],
    coverage_state: row[2],
    positions: row[3] === "" ? null : integer(row[3], "release positions"),
    maturity_reported: row[4] === "" ? null : integer(row[4], "release maturity"),
    principal_reported: row[5] === "" ? null : integer(row[5], "release principal"),
    type_reported: row[6] === "" ? null : integer(row[6], "release type"),
    reported_dates: row[7] === "" ? null : integer(row[7], "release dates"),
  }));

  const reportedDates = queryRows(database, `SELECT p.reported_date::text, count(*),
      count(m.position_observation_id)
    FROM obs.position_observation p
    LEFT JOIN obs.position_field_value m
      ON m.position_observation_id = p.id
     AND m.field_code = 'MATURITY_DATE'
     AND m.value_state = 'REPORTED'
     AND m.normalized_date IS NOT NULL
    GROUP BY p.reported_date
    ORDER BY p.reported_date;`).map((row) => ({
    reported_date: row[0],
    positions: integer(row[1], "date positions"),
    maturity_reported: integer(row[2], "date maturity"),
  }));

  const registrants = queryRows(database, `WITH filing_reg AS (
      SELECT DISTINCT filing_id, lpad(cik::text, 10, '0') AS cik
      FROM registry.current_filing_registrant
      WHERE registrant_link_status = 'LINKED'
    ),
    flags AS (
      SELECT position_observation_id,
             bool_or(field_code = 'MATURITY_DATE' AND normalized_date IS NOT NULL) AS has_maturity,
             bool_or(field_code = 'PRINCIPAL_AMOUNT' AND normalized_numeric IS NOT NULL) AS has_principal,
             bool_or(field_code = 'INSTRUMENT_TYPE' AND btrim(coalesce(normalized_text, '')) <> '') AS has_type
      FROM obs.position_field_value
      WHERE field_code IN ('MATURITY_DATE', 'PRINCIPAL_AMOUNT', 'INSTRUMENT_TYPE')
        AND value_state = 'REPORTED'
      GROUP BY position_observation_id
    )
    SELECT fr.cik, count(*),
           count(*) FILTER (WHERE f.has_maturity),
           count(*) FILTER (WHERE f.has_principal),
           count(*) FILTER (WHERE f.has_type)
    FROM obs.position_observation p
    JOIN filing_reg fr ON fr.filing_id = p.filing_id
    LEFT JOIN flags f ON f.position_observation_id = p.id
    GROUP BY fr.cik
    ORDER BY fr.cik;`).map((row) => ({
    cik: row[0],
    positions: integer(row[1], "registrant positions"),
    maturity_reported: integer(row[2], "registrant maturity"),
    principal_reported: integer(row[3], "registrant principal"),
    type_reported: integer(row[4], "registrant type"),
  }));

  const after = queryRows(database, `SELECT
    (SELECT count(*) FROM obs.soi_row_observation),
    (SELECT count(*) FROM obs.position_observation),
    (SELECT count(*) FROM obs.position_field_value);`)[0].map((value, i) => integer(value, `after ${i}`));
  if (after[0] !== soiRows || after[1] !== positions || after[2] !== fieldValues) {
    throw new Error("SOI, position, or field-value counts changed during the audit");
  }

  const link = Object.fromEntries(linkRows.map((row) => [row[0], integer(row[1], row[0])]));
  const entityMatched = stateCount(entityRows, "MATCHED");
  const entityUnresolved = stateCount(entityRows, "UNRESOLVED");
  const entityProbable = stateCount(entityRows, "PROBABLE");
  const entityRejected = stateCount(entityRows, "REJECTED");
  const instrumentMatched = stateCount(instrumentRows, "MATCHED");
  const instrumentUnresolved = stateCount(instrumentRows, "UNRESOLVED");
  const instrumentProbable = stateCount(instrumentRows, "PROBABLE");
  const instrumentRejected = stateCount(instrumentRows, "REJECTED");
  const q14Open = q14Rows.length > 0 && q14Rows.every((row) => row[1] === "OPEN_QUESTION" && row[2] === "Q14");

  return {
    database,
    queried_at: new Date().toISOString(),
    universe: {
      soi_rows: soiRows,
      position_observations: positions,
      field_values: fieldValues,
      no_identifier_rows: noIdentifier,
      releases: releases.length,
    },
    maturity: foldField(fieldRows, "MATURITY_DATE"),
    principal: foldField(fieldRows, "PRINCIPAL_AMOUNT"),
    instrument_type: foldField(fieldRows, "INSTRUMENT_TYPE"),
    reported_date: { reported: positions - reportedDateMissing, unresolved: 0, distinct: distinctDates },
    registrant: {
      linked: link.LINKED ?? 0,
      multiple: link.MULTIPLE ?? 0,
      unknown: link.UNKNOWN ?? 0,
      unavailable: 0,
    },
    legal_entity: {
      matched: entityMatched,
      probable: entityProbable,
      unresolved: entityUnresolved,
      rejected: entityRejected,
      unavailable: positions - entityMatched - entityProbable - entityUnresolved - entityRejected,
    },
    instrument_resolution: {
      matched: instrumentMatched,
      probable: instrumentProbable,
      unresolved: instrumentUnresolved,
      rejected: instrumentRejected,
      unavailable: positions - instrumentMatched - instrumentProbable - instrumentUnresolved - instrumentRejected,
    },
    overlap: {
      maturity_and_principal: integer(overlap[0], "overlap principal"),
      maturity_and_type: integer(overlap[1], "overlap type"),
      maturity_principal_and_type: integer(overlap[2], "overlap all"),
    },
    golden: {
      observations: integer(golden[0], "golden observations"),
      maturity_reported: integer(golden[1], "golden maturity"),
      principal_reported: integer(golden[2], "golden principal"),
      type_reported: integer(golden[3], "golden type"),
    },
    registrants_with_positions: registrants.length,
    registrants_with_maturity: registrants.filter((row) => row.maturity_reported > 0).length,
    maturity_span: { earliest: span[0], latest: span[1] },
    maturity_years: years,
    q14: {
      status: q14Open && derivedInputs === 0 ? "OPEN_QUESTION" : "CHANGED",
      derived_inputs: derivedInputs,
      mappings: q14Rows.map((row) => ({ column_label: row[0], mapping_status: row[1], open_question_ref: row[2] })),
    },
    golden_gate: gate ? {
      run_id: integer(gate[0], "gate run"),
      overall: gate[1],
      n_pass: integer(gate[2], "gate pass"),
      n_blocked: integer(gate[3], "gate blocked"),
      n_fail: integer(gate[4], "gate fail"),
      golden_observation_count: integer(gate[5], "gate observations"),
    } : null,
    releases,
    reported_dates: reportedDates,
    registrants,
  };
}

function main() {
  const database = opt(process.argv.slice(2), "--db") ?? DEFAULT_DATABASE;
  const goldenBefore = { json: sha256(GOLDEN_JSON), markdown: sha256(GOLDEN_MD) };
  const measured = measureP11(database);
  const audit = buildP11Audit(measured);
  const goldenAfter = { json: sha256(GOLDEN_JSON), markdown: sha256(GOLDEN_MD) };
  if (goldenBefore.json !== goldenAfter.json || goldenBefore.markdown !== goldenAfter.markdown) {
    throw new Error("Golden Gate report files changed during the audit");
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const readiness = {
    ...audit,
    golden_gate_files: goldenAfter,
    reported_dates: undefined,
    registrants: undefined,
    releases: audit.releases.map((row) => ({
      release_label: row.release_label,
      soi_coverage_state: row.soi_coverage_state,
      position_observations: row.position_observations,
      maturity_reported: row.maturity_date === "UNAVAILABLE" ? "UNAVAILABLE" : row.maturity_date.REPORTED,
      maturity_unknown: row.maturity_date === "UNAVAILABLE" ? "UNAVAILABLE" : row.maturity_date.UNKNOWN,
    })),
    maturity_years: undefined,
  };
  const matrix = {
    phase: audit.phase,
    queried_at: audit.queried_at,
    releases: audit.releases,
    reported_dates: audit.reported_dates,
    maturity_years: audit.maturity_years,
    registrants: audit.registrants,
  };
  writeFileSync(path.join(OUT_DIR, "p11_readiness.json"), `${JSON.stringify(readiness, null, 2)}\n`);
  writeFileSync(path.join(OUT_DIR, "p11_coverage_matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`);
  writeFileSync(path.join(OUT_DIR, "P11_READINESS_REPORT.md"), renderP11Report(audit));
  const failed = audit.golden_gate?.overall !== "PASS" || audit.q14.status !== "OPEN_QUESTION";
  console.log(JSON.stringify({
    soi_rows: audit.population.soi_rows,
    position_observations: audit.population.position_observations,
    field_values: audit.population.field_values,
    maturity_reported: audit.attributes.maturity_date.REPORTED,
    capabilities: audit.capabilities,
    golden_gate: audit.golden_gate?.overall ?? null,
    q14: audit.q14.status,
    report: path.relative(REPO_ROOT, path.join(OUT_DIR, "P11_READINESS_REPORT.md")),
  }));
  if (failed) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
