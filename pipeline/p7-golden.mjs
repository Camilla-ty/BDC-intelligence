#!/usr/bin/env node
// P7-min for the Stage A golden locator list only. Instrument identity + per-BDC continuity.
// Does not scan SOI. Does not fetch. Does not start the Golden Gate.
//
//   node pipeline/p7-golden.mjs [-- --db NAME] [-- --locators PATH]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, REPO_ROOT } from "./lib/config.mjs";
import { lit, queryRows } from "./lib/db.mjs";
import { applyP7Min, goldenInstrumentReport, snapshotP7Min } from "./load/p7-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { registerRules } from "./load/rules.mjs";

const GOLDEN_DIR = path.join(REPO_ROOT, ".data", "validation", "golden");

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function readLocators(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
  const ids = [];
  for (const line of lines) {
    const row = JSON.parse(line);
    if (!Number.isSafeInteger(row.position_observation_id)) {
      throw new Error(`locator line missing position_observation_id: ${file}`);
    }
    ids.push(row.position_observation_id);
  }
  return ids;
}

export async function runP7Golden({
  database, locatorsPath, selectionPath, reportPath, log: logFn = console.log,
}) {
  const ids = readLocators(locatorsPath);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("P7-min: locator file has duplicate position_observation_id values");
  const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
  const identifierSha256 = selection?.selected?.identifier_sha256;
  if (!/^[0-9a-f]{64}$/.test(identifierSha256 ?? "")) {
    throw new Error("P7-min: stage_a_selection.json is missing selected.identifier_sha256");
  }

  const before = snapshotP7Min(database, unique);
  const locatorsSha = createHash("sha256").update(readFileSync(locatorsPath)).digest("hex");
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('P7_GOLDEN', '${codeVersion}', '${locatorsSha}',
        jsonb_build_object('locators', ${lit(path.relative(REPO_ROOT, locatorsPath))},
                           'n_locators', ${unique.length},
                           'identifier_sha256', ${lit(identifierSha256)}), now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const inserted = applyP7Min({
    database,
    positionObservationIds: unique,
    runId,
    rules,
    identifierSha256,
  });
  const after = snapshotP7Min(database, unique);
  const evidence = goldenInstrumentReport(database, unique);

  const soiUnchanged = after.soi_row_observation_count === before.soi_row_observation_count
    && after.max_soi_row_observation_id === before.max_soi_row_observation_id
    && after.position_observation_count === before.position_observation_count
    && after.max_position_observation_id === before.max_position_observation_id
    && after.position_field_value_count === before.position_field_value_count
    && after.max_position_field_value_id === before.max_position_field_value_id
    && after.borrower_name_observation_count === before.borrower_name_observation_count
    && after.legal_entity_count === before.legal_entity_count
    && after.entity_resolution_count === before.entity_resolution_count;
  if (!soiUnchanged) throw new Error("P7-min: SOI/position/field/entity rows changed");
  if (after.economic_group_count !== 0) throw new Error("P7-min: economic group was written");
  if (after.derived_value_input_count !== before.derived_value_input_count) {
    throw new Error("P7-min: derived inputs changed (Q14 firewall)");
  }
  if (evidence.instrument_decision_problems !== 0) throw new Error("P7-min: instrument decision problems");
  if (evidence.continuity_decision_problems !== 0) throw new Error("P7-min: continuity decision problems");
  if (evidence.fuzzy_matched !== 0) throw new Error("P7-min: fuzzy or LLM MATCHED decisions exist");
  if (evidence.identity_cik_columns !== 0) throw new Error("P7-min: identity tables have a CIK column");
  if (evidence.instrument_head_forks !== 0 || evidence.continuity_head_forks !== 0) {
    throw new Error("P7-min: resolution head forks");
  }
  if (evidence.cross_bdc_series_merge !== 0) throw new Error("P7-min: a continuity series merged distinct registrants");
  if (evidence.q14_derived_inputs !== 0) throw new Error("P7-min: COST/FV entered derived inputs");

  const counts = {
    instrument_matched_inserted: inserted.instrument_matched_inserted,
    instrument_unresolved_inserted: inserted.instrument_unresolved_inserted,
    distinct_matched_instruments: inserted.distinct_matched_instruments,
    distinct_continuity_series: inserted.distinct_continuity_series,
    series_gap_dates: inserted.series_gap_dates,
  };
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(counts).replace(/'/g, "''")}'::jsonb);`);

  const report = {
    phase: "8",
    step: "p7_min",
    database,
    run_id: runId,
    queried_at: new Date().toISOString(),
    identifier_sha256: identifierSha256,
    n_golden_position_observations: unique.length,
    instrument_match_rule: { code: "resolution.instrument_exact_identifier_and_type", version: "1", rule_version_id: rules["resolution.instrument_exact_identifier_and_type"] },
    instrument_unresolved_rule: { code: "resolution.instrument_unknown_attributes", version: "1", rule_version_id: rules["resolution.instrument_unknown_attributes"] },
    continuity_match_rule: { code: "resolution.position_same_registrant_and_instrument", version: "1", rule_version_id: rules["resolution.position_same_registrant_and_instrument"] },
    continuity_unresolved_rule: { code: "resolution.position_unresolved_without_instrument", version: "1", rule_version_id: rules["resolution.position_unresolved_without_instrument"] },
    inserted,
    instrument_validation: evidence,
    snapshot_before: before,
    snapshot_after: after,
    non_golden_soi_unchanged: soiUnchanged,
    economic_group_unused: after.economic_group_count === 0,
    q14_firewall: after.derived_value_input_count === before.derived_value_input_count && evidence.q14_derived_inputs === 0,
    golden_slice_only: true,
    golden_gate_not_started: true,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logFn(JSON.stringify({
    run_id: runId,
    n_golden_position_observations: unique.length,
    instrument_matched: evidence.instrument_matched,
    instrument_unresolved: evidence.instrument_unresolved,
    distinct_matched_instruments: evidence.distinct_matched_instruments,
    distinct_continuity_series: evidence.distinct_continuity_series,
    coverage_holes: evidence.coverage_holes,
    series_gap_dates: inserted.series_gap_dates,
    fuzzy_matched: evidence.fuzzy_matched,
    cross_bdc_series_merge: evidence.cross_bdc_series_merge,
    q14_firewall: report.q14_firewall,
    non_golden_soi_unchanged: soiUnchanged,
    report: path.relative(REPO_ROOT, reportPath),
  }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const locatorsPath = opt(args, "--locators") ?? path.join(GOLDEN_DIR, "stage_a_locators.jsonl");
  const selectionPath = opt(args, "--selection") ?? path.join(GOLDEN_DIR, "stage_a_selection.json");
  const reportPath = opt(args, "--report") ?? path.join(GOLDEN_DIR, "p7_min_report.json");
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  if (!existsSync(locatorsPath) || !existsSync(selectionPath)) {
    console.error("p7-golden: missing Stage A locator/selection files under .data/validation/golden/");
    process.exit(1);
  }
  await runP7Golden({ database, locatorsPath, selectionPath, reportPath });
}
