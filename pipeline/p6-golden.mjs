#!/usr/bin/env node
// P6-min for the Stage A golden locator list only. Exact normalized-name MATCHED.
// Does not scan SOI. Does not fetch. Does not start P7.
//
//   node pipeline/p6-golden.mjs [-- --db NAME] [-- --locators PATH]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, REPO_ROOT } from "./lib/config.mjs";
import { lit, queryRows } from "./lib/db.mjs";
import {
  applyP6Min, goldenEntityReport, listSameFilingNearNameControls, snapshotP6Min,
} from "./load/p6-min.mjs";
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

export async function runP6Golden({
  database, locatorsPath, selectionPath, reportPath, log: logFn = console.log,
}) {
  const ids = readLocators(locatorsPath);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("P6-min: locator file has duplicate position_observation_id values");
  const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
  const identifierSha256 = selection?.selected?.identifier_sha256;
  if (!/^[0-9a-f]{64}$/.test(identifierSha256 ?? "")) {
    throw new Error("P6-min: stage_a_selection.json is missing selected.identifier_sha256");
  }

  const before = snapshotP6Min(database, unique);
  const locatorsSha = createHash("sha256").update(readFileSync(locatorsPath)).digest("hex");
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('P6_GOLDEN', '${codeVersion}', '${locatorsSha}',
        jsonb_build_object('locators', ${lit(path.relative(REPO_ROOT, locatorsPath))},
                           'n_locators', ${unique.length},
                           'identifier_sha256', ${lit(identifierSha256)}), now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const nearNameIds = listSameFilingNearNameControls(database, unique);
  const inserted = applyP6Min({
    database,
    positionObservationIds: unique,
    runId,
    rules,
    identifierSha256,
    nearNamePositionObservationIds: nearNameIds,
  });
  const after = snapshotP6Min(database, unique);
  const evidence = goldenEntityReport(database, unique, inserted.legal_entity_id);

  const soiUnchanged = after.soi_row_observation_count === before.soi_row_observation_count
    && after.max_soi_row_observation_id === before.max_soi_row_observation_id
    && after.position_observation_count === before.position_observation_count
    && after.max_position_observation_id === before.max_position_observation_id
    && after.position_field_value_count === before.position_field_value_count
    && after.max_position_field_value_id === before.max_position_field_value_id;
  if (!soiUnchanged) throw new Error("P6-min: non-golden SOI/position/field rows changed");
  if (after.economic_group_count !== 0 || after.group_membership_count !== 0) {
    throw new Error("P6-min: economic group was written without disclosed affiliation evidence");
  }
  if (after.instrument_resolution_count !== before.instrument_resolution_count) {
    throw new Error("P6-min: instrument resolution changed (P7 is out of scope)");
  }
  if (evidence.golden_decision_problems !== 0) throw new Error("P6-min: Golden entity decision problems");
  if (evidence.fuzzy_matched !== 0) throw new Error("P6-min: fuzzy or LLM MATCHED decisions exist");
  if (evidence.identity_cik_columns !== 0) throw new Error("P6-min: identity tables have a CIK column");
  if (evidence.head_forks !== 0) throw new Error("P6-min: entity-resolution head forks");

  const counts = {
    legal_entity_id: inserted.legal_entity_id,
    matched_inserted: inserted.matched_inserted,
    near_name_unresolved_inserted: inserted.near_name_unresolved_inserted,
    near_name_candidates_inserted: inserted.near_name_candidates_inserted,
    live_near_name_controls: nearNameIds.length,
  };
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(counts).replace(/'/g, "''")}'::jsonb);`);

  const report = {
    phase: "8",
    step: "p6_min",
    database,
    run_id: runId,
    queried_at: new Date().toISOString(),
    identifier_sha256: identifierSha256,
    n_golden_position_observations: unique.length,
    exact_name_rule: { code: "resolution.entity_exact_normalized_name", version: "1", rule_version_id: rules["resolution.entity_exact_normalized_name"] },
    near_name_rule: { code: "resolution.entity_near_name_candidate", version: "1", rule_version_id: rules["resolution.entity_near_name_candidate"] },
    inserted,
    live_near_name_control_ids_count: nearNameIds.length,
    entity_validation: evidence,
    snapshot_before: before,
    snapshot_after: after,
    non_golden_soi_unchanged: soiUnchanged,
    economic_group_unused: after.economic_group_count === 0 && after.group_membership_count === 0,
    p7_not_started: after.instrument_resolution_count === 0,
    golden_slice_only: true,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logFn(JSON.stringify({
    run_id: runId,
    n_golden_position_observations: unique.length,
    legal_entity_id: inserted.legal_entity_id,
    matched_inserted: inserted.matched_inserted,
    golden_matched_to_entity: evidence.golden_matched_to_entity,
    near_name_unresolved: evidence.near_name_unresolved,
    live_near_name_controls: nearNameIds.length,
    fuzzy_matched: evidence.fuzzy_matched,
    economic_group_unused: report.economic_group_unused,
    p7_not_started: report.p7_not_started,
    non_golden_soi_unchanged: soiUnchanged,
    report: path.relative(REPO_ROOT, reportPath),
  }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const locatorsPath = opt(args, "--locators") ?? path.join(GOLDEN_DIR, "stage_a_locators.jsonl");
  const selectionPath = opt(args, "--selection") ?? path.join(GOLDEN_DIR, "stage_a_selection.json");
  const reportPath = opt(args, "--report") ?? path.join(GOLDEN_DIR, "p6_min_report.json");
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  if (!existsSync(locatorsPath) || !existsSync(selectionPath)) {
    console.error("p6-golden: missing Stage A locator/selection files under .data/validation/golden/");
    process.exit(1);
  }
  await runP6Golden({ database, locatorsPath, selectionPath, reportPath });
}
