#!/usr/bin/env node
// Group already loaded SOI fact rows. Reads raw axis cells and extracted field
// codes. Inserts obs.position_observation_group rows only. Does not update
// observations or run P4, P6, or P7.
//
//   node pipeline/group-soi-facts.mjs [--dry-run] [--db bdc_local]

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, REPO_ROOT } from "./lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import { loadEligibleInstrumentObservations } from "./load/eligible-instrument-scope.mjs";
import { ensureAndLinkRuleForRun } from "./load/rules.mjs";
import {
  AXIS_LABELS,
  SOI_FACT_GROUP_RULE,
  groupsToInsert,
  planFactGroups,
  selectDuplicateDatePopulation,
} from "./normalize/soi-observation-group.mjs";

function opt(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

export function assertLocalFactGroupDatabase(database) {
  if (pipelineConnectionTarget().mode !== "local") {
    throw new Error("SOI fact grouping refuses a hosted database");
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("SOI fact grouping refuses a database other than the local database");
  }
}

function codeVersion() {
  const hash = createHash("sha256");
  for (const file of ["pipeline/normalize/soi-observation-group.mjs", "pipeline/group-soi-facts.mjs"]) {
    hash.update(`${file}\n`).update(readFileSync(path.join(REPO_ROOT, file)));
  }
  return hash.digest("hex");
}

function loadFactRows(database, population) {
  if (population.length === 0) return [];
  const ids = population.map((row) => num(row.id)).join(", ");
  const loaded = queryRows(database, `
SELECT coalesce(json_agg(row_json ORDER BY id), '[]'::json)::text
FROM (
  SELECT p.id,
         json_build_object(
           'id', p.id,
           'filingId', p.filing_id,
           'reportedDate', p.reported_date::text,
           'identifierRaw', s.identifier_raw,
           'instrumentType', obs.cell_by_label(s.tabular_row_id, ${lit(AXIS_LABELS.type)}),
           'debt', obs.cell_by_label(s.tabular_row_id, ${lit(AXIS_LABELS.debt)}),
           'stock', obs.cell_by_label(s.tabular_row_id, ${lit(AXIS_LABELS.stock)}),
           'equity', obs.cell_by_label(s.tabular_row_id, ${lit(AXIS_LABELS.equity)}),
           'range', obs.cell_by_label(s.tabular_row_id, ${lit(AXIS_LABELS.range)}),
           'fields', (
             SELECT coalesce(json_agg(json_build_object(
                      'code', fv.field_code,
                      'evidenceId', fv.evidence_id
                    ) ORDER BY fv.field_code, fv.evidence_id), '[]'::json)
             FROM obs.current_position_field_value fv
             WHERE fv.position_observation_id = p.id
           )
         ) AS row_json
  FROM obs.position_observation p
  JOIN obs.soi_row_observation s ON s.id = p.origin_soi_row_observation_id
  WHERE p.id IN (${ids})
) facts;`);
  const parsed = JSON.parse(loaded[0][0]);
  const byId = new Map(population.map((row) => [row.id, row]));
  if (parsed.length !== population.length) {
    throw new Error(`fact load returned ${parsed.length} rows for ${population.length} observations`);
  }
  return parsed.map((row) => {
    const source = byId.get(Number(row.id));
    const evidenceByField = {};
    const fieldCodes = [];
    for (const field of row.fields) {
      fieldCodes.push(field.code);
      if (evidenceByField[field.code] == null) evidenceByField[field.code] = Number(field.evidenceId);
    }
    return {
      id: Number(row.id),
      filingId: Number(row.filingId),
      registrantId: source.registrantId,
      reportedDate: row.reportedDate,
      identifierRaw: row.identifierRaw,
      instrumentType: row.instrumentType,
      axes: {
        debt: row.debt,
        stock: row.stock,
        equity: row.equity,
        range: row.range,
      },
      fieldCodes,
      evidenceByField,
    };
  });
}

function evidenceMismatches(database, groups) {
  if (groups.length === 0) return 0;
  const values = groups.flatMap((group) => group.members.map((member) => `(${num(member.positionObservationId)}, ${num(member.evidenceId)})`)).join(",\n");
  const rows = queryRows(database, `
SELECT count(*)::text
FROM (VALUES
  ${values}
) AS m (position_observation_id, evidence_id)
WHERE NOT EXISTS (
  SELECT 1
  FROM obs.position_observation_source src
  JOIN obs.soi_row_observation s ON s.id = src.soi_row_observation_id
  JOIN evidence.evidence e ON e.id = m.evidence_id AND e.tabular_row_id = s.tabular_row_id
  WHERE src.position_observation_id = m.position_observation_id
    AND src.source_role = 'PRIMARY'
);`);
  return Number(rows[0][0]);
}

function existingKeys(database, ruleId) {
  const rows = queryRows(database, `
SELECT g.grouping_key
FROM obs.position_observation_group g
WHERE g.rule_version_id = ${num(ruleId)}
  AND g.grouping_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM obs.position_observation_group newer WHERE newer.supersedes_id = g.id
  );`);
  return rows.map((row) => row[0]);
}

function coverageSnapshot(database) {
  const rows = queryRows(database, `
SELECT
  (SELECT count(*) FROM registry.position_period_comparison)::text,
  (SELECT count(*) FROM registry.position_period_comparison c
    WHERE c.fair_value_changed OR c.principal_changed OR c.cost_changed OR c.maturity_changed)::text,
  (SELECT count(*) FROM obs.position_observation)::text,
  (SELECT count(*) FROM resolution.instrument_resolution_decision)::text;`);
  return {
    comparisons: Number(rows[0][0]),
    comparisonsChanged: Number(rows[0][1]),
    positionObservations: Number(rows[0][2]),
    instrumentDecisions: Number(rows[0][3]),
  };
}

function insertGroups(database, runId, ruleId, groups) {
  if (groups.length === 0) return 0;
  const groupValues = groups.map((group) => `(${num(group.filingId)}, 'UNRESOLVED'::ref.resolution_state, ${lit(group.rationale)}, ${num(ruleId)}, ${num(runId)}, ${lit(group.groupingKey)})`).join(",\n");
  const memberValues = groups.flatMap((group) => group.members.map((member) => `(${lit(group.groupingKey)}, ${num(member.positionObservationId)}, ${lit(member.role)}::obs.soi_fact_member_role, ${num(member.evidenceId)}, ${num(runId)})`)).join(",\n");
  const rows = queryRows(database, `
BEGIN;
WITH inserted AS (
  INSERT INTO obs.position_observation_group (filing_id, state, rationale, rule_version_id, run_id, grouping_key)
  SELECT v.filing_id, v.state, v.rationale, v.rule_version_id, v.run_id, v.grouping_key
  FROM (VALUES
    ${groupValues}
  ) AS v (filing_id, state, rationale, rule_version_id, run_id, grouping_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM obs.position_observation_group g
    WHERE g.rule_version_id = v.rule_version_id AND g.grouping_key = v.grouping_key
  )
  RETURNING id, grouping_key
),
members AS (
  INSERT INTO obs.position_observation_group_member (group_id, position_observation_id, member_role, evidence_id, run_id)
  SELECT inserted.id, m.position_observation_id, m.member_role, m.evidence_id, m.run_id
  FROM inserted
  JOIN (VALUES
    ${memberValues}
  ) AS m (grouping_key, position_observation_id, member_role, evidence_id, run_id)
    ON m.grouping_key = inserted.grouping_key
  RETURNING group_id
)
SELECT count(DISTINCT group_id)::text FROM members;
COMMIT;`);
  return Number(rows[0][0]);
}

export function groupSoiFacts({ database = DEFAULT_DATABASE, dryRun = false, log = console.log } = {}) {
  assertLocalFactGroupDatabase(database);
  const eligible = loadEligibleInstrumentObservations(database);
  const population = selectDuplicateDatePopulation(eligible);
  const facts = loadFactRows(database, population);
  const plan = planFactGroups(facts);
  const summary = {
    eligibleFactRows: population.length,
    eligibleDateGroups: plan.nDateGroups,
    groupsPlanned: plan.groups.length,
    balanceSpreadGroups: plan.groups.filter((group) => group.shape === "BALANCE_SPREAD").length,
    balanceSpreadPikGroups: plan.groups.filter((group) => group.shape === "BALANCE_SPREAD_PIK").length,
    memberRows: plan.groups.reduce((sum, group) => sum + group.members.length, 0),
    rejectedDateGroups: plan.nRejectedDateGroups,
    blocked: plan.blocked,
    dryRun,
  };
  if (dryRun) {
    log(JSON.stringify(summary));
    return summary;
  }
  const before = coverageSnapshot(database);
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('SOI_FACT_GROUP', ${lit(codeVersion())},
        jsonb_build_object('eligible_fact_rows', ${num(population.length)}, 'groups_planned', ${num(plan.groups.length)}),
        now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  try {
    const rule = ensureAndLinkRuleForRun(database, runId, SOI_FACT_GROUP_RULE);
    const pending = groupsToInsert(plan.groups, existingKeys(database, rule.id));
    const mismatches = evidenceMismatches(database, pending);
    if (mismatches > 0) {
      throw new Error(`${mismatches} fact-group members do not have evidence on the source row`);
    }
    const inserted = insertGroups(database, runId, rule.id, pending);
    const after = coverageSnapshot(database);
    const result = {
      ...summary,
      groupsInserted: inserted,
      groupsSkipped: plan.groups.length - pending.length,
      coverageBefore: before,
      coverageAfter: after,
      runId,
    };
    queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify(result))}::jsonb);`);
    log(JSON.stringify(result));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${num(runId)}, 'FAILED', now(), '{}'::jsonb, ${lit(message)});`);
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  groupSoiFacts({ database, dryRun: args.includes("--dry-run") });
}
