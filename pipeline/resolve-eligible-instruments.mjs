#!/usr/bin/env node
// Apply P4, P6 company-cell entity resolution, and P7 to a bounded set of observations
// that already have a SOI identifier and a reported instrument type.
//
//   node pipeline/resolve-eligible-instruments.mjs [-- --db NAME] [--dry-run] [--allow-hosted] [--data-dir DIR]
//   node pipeline/resolve-eligible-instruments.mjs [-- --db NAME] --unique-dates [--limit N] [--dry-run] [--allow-hosted] [--data-dir DIR]
//
// A hosted database is refused unless --allow-hosted is passed. Bounded --dry-run only
// reads and prints the selection, the planned legal-entity outcomes, the instrument-type
// footnote normalization, and the planned instrument and continuity outcomes. Unique-date
// --dry-run only reads and prints selection and batch counters (no writes).

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import {
  loadEligibleInstrumentObservations,
  planUniqueDateBatches,
  selectBoundedEligibleObservations,
  selectUniqueDateEligibleObservations,
} from "./load/eligible-instrument-scope.mjs";
import { applyP4Min, snapshotP4Min } from "./load/p4-min.mjs";
import { applyP6CompanyCell, planP6CompanyCell } from "./load/p6-company-cell.mjs";
import { applyP7Min, planP7Min } from "./load/p7-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { ensureAndLinkRuleForRun } from "./load/rules.mjs";

export const RESOLUTION_RULES = [
  { code: "norm.borrower_name", version: "1" },
  { code: "resolution.entity_exact_company_cell_name", version: "2" },
  { code: "norm.instrument_type_footnote_ref", version: "1" },
  { code: "resolution.instrument_exact_identifier_and_type", version: "2" },
  { code: "resolution.instrument_unknown_attributes", version: "2" },
  { code: "resolution.position_same_registrant_and_instrument", version: "2" },
  { code: "resolution.position_unresolved_without_instrument", version: "2" },
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

export function assertResolutionDatabase(database, {
  allowHosted = false,
  allowNonDefaultLocalDatabase = false,
} = {}) {
  if (pipelineConnectionTarget().mode !== "local") {
    if (!allowHosted) throw new Error("eligible instrument resolution refuses a hosted database");
    return;
  }
  if (database !== DEFAULT_DATABASE && !allowNonDefaultLocalDatabase) {
    throw new Error("eligible instrument resolution refuses a database other than the local database");
  }
}

function linkResolutionRules(database, runId) {
  const ids = {};
  for (const rule of RESOLUTION_RULES) ids[rule.code] = ensureAndLinkRuleForRun(database, runId, rule).id;
  return ids;
}

function instrumentPlanSummary(groupPlans) {
  const observations = groupPlans.flatMap((plan) => plan.observations ?? []);
  const keys = new Map();
  for (const row of observations) {
    if (row.continuity_type_text == null || row.registrant_id == null) continue;
    const key = JSON.stringify([row.registrant_id, row.identifier, row.continuity_type_text]);
    if (!keys.has(key)) keys.set(key, []);
    keys.get(key).push(row);
  }
  const count = (pick, value) => observations.filter((row) => pick(row) === value).length;
  return {
    not_planned: groupPlans.filter((plan) => plan.not_planned).map((plan) => plan.not_planned),
    type_states: Object.fromEntries(["NOT_APPLICABLE", "NO_CANDIDATE", "VERIFIED", "UNVERIFIED"]
      .map((state) => [state, count((row) => row.type?.state, state)])),
    already_decided_continuity: count((row) => row.continuity?.already_decided, true),
    planned_continuity_matched: observations.filter((row) => row.continuity && !row.continuity.already_decided
      && row.continuity.state === "MATCHED").length,
    planned_continuity_unresolved: observations.filter((row) => row.continuity && !row.continuity.already_decided
      && row.continuity.state === "UNRESOLVED").length,
    planned_new_instruments: observations.filter((row) => row.instrument?.new_instrument).length,
    planned_new_positions: new Set(observations.filter((row) => row.continuity?.new_position)
      .map((row) => row.continuity.position_id)).size,
    observations,
    continuity_keys: [...keys.values()].map((rows) => ({
      registrant_id: rows[0].registrant_id,
      identifier: rows[0].identifier,
      continuity_type_text: rows[0].continuity_type_text,
      ids: rows.map((row) => row.position_observation_id),
      raw_types: rows.map((row) => row.type?.raw_text ?? null),
      current_position_ids: [...new Set(rows.map((row) => row.continuity?.position_id).filter(Boolean))],
    })),
  };
}

function planInstruments(database, selected, dataDir) {
  return groupsOf(selected).map(([identifierRaw, groupIds]) => {
    try {
      return planP7Min({
        database,
        positionObservationIds: groupIds,
        identifierSha256: createHash("sha256").update(identifierRaw, "utf8").digest("hex"),
        dataDir,
      });
    } catch (error) {
      return { not_planned: { ids: groupIds, reason: error.message } };
    }
  });
}

function dryRunSummary(eligible, selected, entityPlan, groupPlans) {
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
    instrument_plan: instrumentPlanSummary(groupPlans),
  };
}

function decidedInstrumentIds(database, ids) {
  if (ids.length === 0) return [];
  const rows = queryRows(database, `
SELECT d.position_observation_id::text
FROM resolution.current_instrument_resolution d
WHERE d.position_observation_id IN (${ids.join(",")});`);
  return rows.map((row) => Number(row[0]));
}

function multiPeriodSeriesCount(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.registrantId}\u0000${row.identifierRaw}\u0000${row.instrumentType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.reportedDate);
  }
  let count = 0;
  for (const dates of groups.values()) {
    if (new Set(dates).size === dates.length && new Set(dates).size >= 2) count += 1;
  }
  return count;
}

export function resolveBoundedEligibleInstruments({
  database,
  allowHosted = false,
  allowNonDefaultLocalDatabase = false,
  dryRun = false,
  dataDir = DEFAULT_DATA_DIR,
  log: logFn = console.log,
}) {
  assertResolutionDatabase(database, { allowHosted, allowNonDefaultLocalDatabase });
  const eligible = loadEligibleInstrumentObservations(database);
  const selected = selectBoundedEligibleObservations(eligible);
  if (selected.length === 0) throw new Error("no eligible instrument observations are stored");
  if (dryRun) {
    const summary = dryRunSummary(
      eligible,
      selected,
      planP6CompanyCell(database, selected.map((row) => row.id)),
      planInstruments(database, selected, dataDir),
    );
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
      database, positionObservationIds: groupIds, runId, rules, identifierSha256, dataDir,
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

export function resolveUniqueDateEligibleInstruments({
  database,
  limit = null,
  allowHosted = false,
  allowNonDefaultLocalDatabase = false,
  dryRun = false,
  dataDir = DEFAULT_DATA_DIR,
  log: logFn = console.log,
}) {
  assertResolutionDatabase(database, { allowHosted, allowNonDefaultLocalDatabase });
  const eligible = loadEligibleInstrumentObservations(database);
  const unique = selectUniqueDateEligibleObservations(eligible);
  const uniqueIds = new Set(unique.map((row) => row.id));
  const decided = decidedInstrumentIds(database, unique.map((row) => row.id));
  const planned = planUniqueDateBatches(eligible, { alreadyDecidedIds: decided, limit });
  const plannedRows = planned.flat();
  const crossRegistrant = planned.filter((group) => {
    const byType = new Map();
    for (const row of group) {
      if (!byType.has(row.instrumentType)) byType.set(row.instrumentType, new Set());
      byType.get(row.instrumentType).add(row.registrantId);
    }
    return [...byType.values()].some((registrants) => registrants.size > 1);
  }).length;
  const summary = {
    mode: dryRun ? "unique-date-dry-run" : "unique-date",
    n_eligible: eligible.length,
    n_unique_date: unique.length,
    n_duplicate_date_excluded: eligible.filter((row) => !uniqueIds.has(row.id)).length,
    n_already_decided: decided.length,
    n_groups: planned.length,
    n_selected: plannedRows.length,
    n_multi_period_series: multiPeriodSeriesCount(plannedRows),
    n_cross_registrant_type_groups: crossRegistrant,
    selected_ids: plannedRows.map((row) => row.id),
  };
  if (dryRun || planned.length === 0) {
    logFn(JSON.stringify(summary));
    return summary;
  }
  const ids = summary.selected_ids;
  const beforeNames = snapshotP4Min(database, ids);
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('ELIGIBLE_INSTRUMENT_RESOLUTION', ${lit(codeVersion)},
        jsonb_build_object('mode', 'unique-date', 'n_eligible', ${num(eligible.length)},
          'n_selected', ${num(ids.length)}, 'n_groups', ${num(planned.length)}),
        now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = linkResolutionRules(database, runId);
  const groups = [];
  for (const group of planned) {
    const identifierRaw = group[0].identifierRaw;
    const groupIds = group.map((row) => row.id);
    const identifierSha256 = createHash("sha256").update(identifierRaw, "utf8").digest("hex");
    const names = applyP4Min({
      database, positionObservationIds: groupIds, runId, rules, identifierSha256,
    });
    const entity = applyP6CompanyCell({
      database, positionObservationIds: groupIds, runId, rules,
    });
    const instrument = applyP7Min({
      database, positionObservationIds: groupIds, runId, rules, identifierSha256, dataDir,
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
  summary.run_id = runId;
  summary.groups = groups;
  summary.non_selected_names_unchanged = true;
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify({
    n_eligible: eligible.length,
    n_selected: ids.length,
    n_groups: groups.length,
    mode: "unique-date",
  }))}::jsonb);`);
  logFn(JSON.stringify(summary));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  const shared = {
    database,
    allowHosted: args.includes("--allow-hosted"),
    dryRun: args.includes("--dry-run"),
    dataDir: opt(args, "--data-dir") ?? DEFAULT_DATA_DIR,
  };
  if (args.includes("--unique-dates")) {
    const limitText = opt(args, "--limit");
    const limit = limitText == null ? null : Number(limitText);
    resolveUniqueDateEligibleInstruments({ ...shared, limit });
  } else {
    resolveBoundedEligibleInstruments(shared);
  }
}
