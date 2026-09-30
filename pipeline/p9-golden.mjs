#!/usr/bin/env node
// P9-min for the Stage A golden locator list only. Does not rewrite the Golden Gate report.
//
//   node pipeline/p9-golden.mjs [-- --db NAME] [-- --locators PATH]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, REPO_ROOT } from "./lib/config.mjs";
import { lit, queryRows } from "./lib/db.mjs";
import { applyP9Min, snapshotP9Min } from "./load/p9-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { registerRules } from "./load/rules.mjs";
import { EVENT_CATALOG } from "./normalize/observation-events.mjs";

const GOLDEN_DIR = path.join(REPO_ROOT, ".data", "validation", "golden");
const GOLDEN_IDENTIFIER_SHA256 = "853e2f1fb9712bb95c3d17679356a1cbb2ab25569a22d030f2a4ed6bbeb88090";

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

export async function runP9Golden({
  database, locatorsPath, selectionPath, reportPath, log: logFn = console.log,
}) {
  const ids = readLocators(locatorsPath);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("P9-min: locator file has duplicate position_observation_id values");
  const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
  const identifierSha256 = selection?.selected?.identifier_sha256;
  if (identifierSha256 !== GOLDEN_IDENTIFIER_SHA256) {
    throw new Error("P9-min: stage_a_selection.json identifier does not match the approved Golden identifier");
  }

  const gatePath = path.join(GOLDEN_DIR, "golden_gate.json");
  const gate = existsSync(gatePath) ? JSON.parse(readFileSync(gatePath, "utf8")) : null;

  const before = snapshotP9Min(database);
  const locatorsSha = createHash("sha256").update(readFileSync(locatorsPath)).digest("hex");
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('P9_GOLDEN', '${codeVersion}', '${locatorsSha}',
        jsonb_build_object('locators', ${lit(path.relative(REPO_ROOT, locatorsPath))},
                           'n_locators', ${unique.length},
                           'identifier_sha256', ${lit(identifierSha256)}), now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const inserted = applyP9Min({ database, positionObservationIds: unique, runId, rules });
  const again = applyP9Min({ database, positionObservationIds: unique, runId, rules });
  const after = snapshotP9Min(database);

  const unchanged = after.soi_row_observation_count === before.soi_row_observation_count
    && after.max_soi_row_observation_id === before.max_soi_row_observation_id
    && after.position_observation_count === before.position_observation_count
    && after.max_position_observation_id === before.max_position_observation_id
    && after.position_field_value_count === before.position_field_value_count
    && after.max_position_field_value_id === before.max_position_field_value_id
    && after.derived_value_count === before.derived_value_count
    && after.derived_value_input_count === before.derived_value_input_count
    && after.instrument_count === before.instrument_count
    && after.economic_group_count === before.economic_group_count;
  if (!unchanged) throw new Error("P9-min: SOI, field values, instruments, or derived values changed");
  if (after.economic_group_count !== 0) throw new Error("P9-min: economic group was written");
  if (after.derived_value_input_count !== 0) throw new Error("P9-min: derived inputs changed");
  if (after.instrument_count !== 0) throw new Error("P9-min: an instrument was created");
  if (again.inserted !== 0) throw new Error("P9-min: second apply inserted rows");

  const report = {
    phase: "9",
    step: "p9_min",
    database,
    run_id: runId,
    queried_at: new Date().toISOString(),
    identifier_sha256: identifierSha256,
    rule: {
      code: "event.registrant_first_observed_name",
      version: "1",
      rule_version_id: rules["event.registrant_first_observed_name"],
    },
    catalog: EVENT_CATALOG,
    inserted,
    second_apply_inserted: again.inserted,
    snapshot_before: before,
    snapshot_after: after,
    provenance: "derived.observation_event.evidence_id = obs.position_observation.evidence_id; reported_date is copied from that observation; registrant is reached only through registry.current_filing_registrant LINKED",
    q14_status: "OPEN_QUESTION",
    q14_derived_inputs: after.derived_value_input_count,
    golden_gate_status: gate?.overall ?? null,
    golden_gate_preserved: true,
    non_golden_soi_unchanged: true,
    phase_10_not_started: true,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify({
    inserted: inserted.inserted,
    event_count: inserted.event_count,
    distinct_registrants: inserted.distinct_registrants,
    second_apply_inserted: again.inserted,
  }).replace(/'/g, "''")}'::jsonb);`);
  logFn(JSON.stringify({
    run_id: runId,
    inserted: inserted.inserted,
    event_count: inserted.event_count,
    distinct_registrants: inserted.distinct_registrants,
    skipped_unlinked: inserted.skipped_unlinked,
    second_apply_inserted: again.inserted,
    q14_derived_inputs: after.derived_value_input_count,
    golden_gate_status: report.golden_gate_status,
    report: path.relative(REPO_ROOT, reportPath),
  }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const locatorsPath = opt(args, "--locators") ?? path.join(GOLDEN_DIR, "stage_a_locators.jsonl");
  const selectionPath = opt(args, "--selection") ?? path.join(GOLDEN_DIR, "stage_a_selection.json");
  const reportPath = opt(args, "--report") ?? path.join(GOLDEN_DIR, "p9_min_report.json");
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  if (!existsSync(locatorsPath) || !existsSync(selectionPath)) {
    console.error("p9-golden: missing Stage A locator/selection files under .data/validation/golden/");
    process.exit(1);
  }
  await runP9Golden({ database, locatorsPath, selectionPath, reportPath });
}
