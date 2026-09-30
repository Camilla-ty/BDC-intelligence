#!/usr/bin/env node
// P4-min for the Stage A golden locator list only. Does not scan SOI. Does not fetch.
//
//   node pipeline/p4-golden.mjs [-- --db NAME] [-- --locators PATH] [-- --selection PATH]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, REPO_ROOT } from "./lib/config.mjs";
import { lit, queryRows } from "./lib/db.mjs";
import { applyP4Min, goldenInstrumentTypeCounts, snapshotP4Min } from "./load/p4-min.mjs";
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

export async function runP4Golden({
  database,
  locatorsPath,
  selectionPath,
  reportPath,
  log: logFn = console.log,
}) {
  const ids = readLocators(locatorsPath);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("P4-min: locator file has duplicate position_observation_id values");
  const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
  const identifierSha256 = selection?.selected?.identifier_sha256;
  if (!/^[0-9a-f]{64}$/.test(identifierSha256 ?? "")) {
    throw new Error("P4-min: stage_a_selection.json is missing selected.identifier_sha256");
  }

  const before = snapshotP4Min(database, unique);
  const locatorsSha = createHash("sha256").update(readFileSync(locatorsPath)).digest("hex");
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('P4_GOLDEN', '${codeVersion}', '${locatorsSha}',
        jsonb_build_object('locators', ${lit(path.relative(REPO_ROOT, locatorsPath))},
                           'n_locators', ${unique.length},
                           'identifier_sha256', ${lit(identifierSha256)}), now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const inserted = applyP4Min({
    database, positionObservationIds: unique, runId, rules, identifierSha256,
  });
  const after = snapshotP4Min(database, unique);
  const instrumentType = goldenInstrumentTypeCounts(database, unique);

  const soiUnchanged = after.soi_row_observation_count === before.soi_row_observation_count
    && after.max_soi_row_observation_id === before.max_soi_row_observation_id;
  const positionUnchanged = after.position_observation_count === before.position_observation_count
    && after.max_position_observation_id === before.max_position_observation_id;
  const fieldUnchanged = after.position_field_value_count === before.position_field_value_count
    && after.max_position_field_value_id === before.max_position_field_value_id;
  const nonGoldenUnchanged = after.non_golden_borrower_name_count === before.non_golden_borrower_name_count;
  if (!soiUnchanged || !positionUnchanged || !fieldUnchanged || !nonGoldenUnchanged) {
    throw new Error("P4-min: non-golden SOI/position/field rows changed");
  }

  const counts = {
    identifier_name_inserted: inserted.identifier_name_inserted,
    issuer_name_inserted: inserted.issuer_name_inserted,
    golden_borrower_name_count: after.golden_borrower_name_count,
  };
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(counts).replace(/'/g, "''")}'::jsonb);`);

  const report = {
    phase: "8",
    step: "p4_min",
    database,
    run_id: runId,
    queried_at: new Date().toISOString(),
    identifier_sha256: identifierSha256,
    n_golden_position_observations: unique.length,
    borrower_name_rule: { code: "norm.borrower_name", version: "1", rule_version_id: rules["norm.borrower_name"] },
    instrument_type_rule: { code: "norm.instrument_type", version: "1", rule_version_id: rules["norm.instrument_type"] },
    inserted,
    instrument_type: instrumentType,
    snapshot_before: before,
    snapshot_after: after,
    non_golden_soi_unchanged: soiUnchanged && positionUnchanged && fieldUnchanged && nonGoldenUnchanged,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logFn(JSON.stringify({
    run_id: runId,
    n_golden_position_observations: unique.length,
    inserted,
    golden_borrower_name_count: after.golden_borrower_name_count,
    instrument_type: instrumentType,
    non_golden_soi_unchanged: report.non_golden_soi_unchanged,
    report: path.relative(REPO_ROOT, reportPath),
  }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const locatorsPath = opt(args, "--locators") ?? path.join(GOLDEN_DIR, "stage_a_locators.jsonl");
  const selectionPath = opt(args, "--selection") ?? path.join(GOLDEN_DIR, "stage_a_selection.json");
  const reportPath = opt(args, "--report") ?? path.join(GOLDEN_DIR, "p4_min_report.json");
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  if (!existsSync(locatorsPath) || !existsSync(selectionPath)) {
    console.error("p4-golden: missing Stage A locator/selection files under .data/validation/golden/");
    process.exit(1);
  }
  await runP4Golden({ database, locatorsPath, selectionPath, reportPath });
}
