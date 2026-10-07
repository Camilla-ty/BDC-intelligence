#!/usr/bin/env node
// Apply existing P4, P6, and P7 to a bounded set of observations that already
// have a SOI identifier and a reported instrument type. Match rules are unchanged.
//
//   node pipeline/resolve-eligible-instruments.mjs [-- --db NAME]

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import {
  loadEligibleInstrumentObservations,
  selectBoundedEligibleObservations,
} from "./load/eligible-instrument-scope.mjs";
import { applyP4Min, snapshotP4Min } from "./load/p4-min.mjs";
import { applyP6Min } from "./load/p6-min.mjs";
import { applyP7Min } from "./load/p7-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { registerRules } from "./load/rules.mjs";

function opt(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function groupsOf(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.identifierRaw)) groups.set(row.identifierRaw, []);
    groups.get(row.identifierRaw).push(row.id);
  }
  return [...groups.entries()].sort((left, right) => Math.min(...left[1]) - Math.min(...right[1]));
}

export function resolveBoundedEligibleInstruments({ database, log: logFn = console.log }) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("eligible instrument resolution refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("eligible instrument resolution refuses a database other than the local database");
  }
  const eligible = loadEligibleInstrumentObservations(database);
  const selected = selectBoundedEligibleObservations(eligible);
  if (selected.length === 0) throw new Error("no eligible instrument observations are stored");
  const ids = selected.map((row) => row.id);
  const beforeNames = snapshotP4Min(database, ids);
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('ELIGIBLE_INSTRUMENT_RESOLUTION', ${lit(codeVersion)},
        jsonb_build_object('mode', 'bounded', 'n_eligible', ${num(eligible.length)}, 'n_selected', ${num(ids.length)}),
        now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);
  const groups = [];
  for (const [identifierRaw, groupIds] of groupsOf(selected)) {
    const identifierSha256 = createHash("sha256").update(identifierRaw, "utf8").digest("hex");
    const names = applyP4Min({
      database, positionObservationIds: groupIds, runId, rules, identifierSha256,
    });
    const entity = applyP6Min({
      database,
      positionObservationIds: groupIds,
      runId,
      rules,
      identifierSha256,
      nearNamePositionObservationIds: [],
    });
    const instrument = applyP7Min({
      database, positionObservationIds: groupIds, runId, rules, identifierSha256,
    });
    groups.push({
      n: groupIds.length,
      names,
      legal_entity_id: entity.legal_entity_id,
      matched_inserted: entity.matched_inserted,
      instrument,
    });
  }
  const afterNames = snapshotP4Min(database, ids);
  if (afterNames.non_golden_borrower_name_count !== beforeNames.non_golden_borrower_name_count) {
    throw new Error("eligible instrument resolution changed borrower names outside the selected observations");
  }
  const summary = {
    run_id: runId,
    n_eligible: eligible.length,
    n_selected: ids.length,
    selected_ids: ids,
    groups,
    non_selected_names_unchanged: true,
  };
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify({
    n_eligible: eligible.length,
    n_selected: ids.length,
    n_groups: groups.length,
  }))}::jsonb);`);
  logFn(JSON.stringify(summary));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const database = opt(process.argv.slice(2), "--db") ?? DEFAULT_DATABASE;
  resolveBoundedEligibleInstruments({ database });
}
