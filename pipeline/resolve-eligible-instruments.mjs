#!/usr/bin/env node
// Apply P4, P6 company-cell entity resolution, and P7 to a bounded set of observations
// that already have a SOI identifier and a reported instrument type.
//
//   node pipeline/resolve-eligible-instruments.mjs [-- --db NAME] [--dry-run] [--allow-hosted]
//
// A hosted database is refused unless --allow-hosted is passed. --dry-run only
// reads and prints the selection and the planned legal-entity outcomes.

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
import { applyP6CompanyCell, planP6CompanyCell } from "./load/p6-company-cell.mjs";
import { applyP7Min } from "./load/p7-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { ensureAndLinkRuleForRun } from "./load/rules.mjs";

export const RESOLUTION_RULES = [
  { code: "norm.borrower_name", version: "1" },
  { code: "resolution.entity_exact_company_cell_name", version: "1" },
  { code: "resolution.instrument_exact_identifier_and_type", version: "1" },
  { code: "resolution.instrument_unknown_attributes", version: "1" },
  { code: "resolution.position_same_registrant_and_instrument", version: "1" },
  { code: "resolution.position_unresolved_without_instrument", version: "1" },
];

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

export function assertResolutionDatabase(database, { allowHosted = false } = {}) {
  if (pipelineConnectionTarget().mode !== "local") {
    if (!allowHosted) throw new Error("eligible instrument resolution refuses a hosted database");
    return;
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("eligible instrument resolution refuses a database other than the local database");
  }
}

function linkResolutionRules(database, runId) {
  const ids = {};
  for (const rule of RESOLUTION_RULES) ids[rule.code] = ensureAndLinkRuleForRun(database, runId, rule).id;
  return ids;
}

function dryRunSummary(eligible, selected, entityPlan) {
  return {
    mode: "dry-run",
    n_eligible: eligible.length,
    n_selected: selected.length,
    selected_ids: selected.map((row) => row.id),
    n_groups: groupsOf(selected).length,
    groups: groupsOf(selected).map(([identifierRaw, groupIds]) => {
      const rows = selected.filter((row) => groupIds.includes(row.id));
      return {
        identifier_raw: identifierRaw,
        ids: groupIds,
        registrant_ids: [...new Set(rows.map((row) => row.registrantId))].sort((left, right) => left - right),
        reported_dates: [...new Set(rows.map((row) => row.reportedDate))].sort(),
      };
    }),
    registrant_ids: [...new Set(selected.map((row) => row.registrantId))].sort((left, right) => left - right),
    reported_dates: [...new Set(selected.map((row) => row.reportedDate))].sort(),
    entity_plan: {
      already_decided: entityPlan.alreadyDecided,
      matched: entityPlan.decisions.filter((decision) => decision.state === "MATCHED").length,
      unresolved: entityPlan.decisions.filter((decision) => decision.state === "UNRESOLVED").length,
      planned_legal_entities: entityPlan.newEntities.map((entity) => entity.aliasText),
      observations: entityPlan.decisions.map((decision) => ({
        id: decision.positionObservationId,
        state: decision.state,
        method: decision.method,
        company_name: decision.companyName,
        legal_entity: decision.legalEntityId ?? (decision.newEntityAlias == null ? null : `new: ${decision.newEntityAlias}`),
      })),
    },
  };
}

export function resolveBoundedEligibleInstruments({
  database, allowHosted = false, dryRun = false, log: logFn = console.log,
}) {
  assertResolutionDatabase(database, { allowHosted });
  const eligible = loadEligibleInstrumentObservations(database);
  const selected = selectBoundedEligibleObservations(eligible);
  if (selected.length === 0) throw new Error("no eligible instrument observations are stored");
  if (dryRun) {
    const summary = dryRunSummary(eligible, selected, planP6CompanyCell(database, selected.map((row) => row.id)));
    logFn(JSON.stringify(summary));
    return summary;
  }
  const ids = selected.map((row) => row.id);
  const beforeNames = snapshotP4Min(database, ids);
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('ELIGIBLE_INSTRUMENT_RESOLUTION', ${lit(codeVersion)},
        jsonb_build_object('mode', 'bounded', 'n_eligible', ${num(eligible.length)}, 'n_selected', ${num(ids.length)}),
        now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = linkResolutionRules(database, runId);
  const groups = [];
  for (const [identifierRaw, groupIds] of groupsOf(selected)) {
    const identifierSha256 = createHash("sha256").update(identifierRaw, "utf8").digest("hex");
    const names = applyP4Min({
      database, positionObservationIds: groupIds, runId, rules, identifierSha256,
    });
    const entity = applyP6CompanyCell({
      database, positionObservationIds: groupIds, runId, rules,
    });
    const instrument = applyP7Min({
      database, positionObservationIds: groupIds, runId, rules, identifierSha256,
    });
    groups.push({
      n: groupIds.length,
      names,
      entity,
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
  const args = process.argv.slice(2);
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  resolveBoundedEligibleInstruments({
    database,
    allowHosted: args.includes("--allow-hosted"),
    dryRun: args.includes("--dry-run"),
  });
}
