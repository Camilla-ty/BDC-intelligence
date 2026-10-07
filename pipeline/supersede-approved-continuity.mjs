#!/usr/bin/env node
// Approved historical continuity correction (docs/METHODOLOGY.md 7.8). Not P7 resolution.
//
//   node pipeline/supersede-approved-continuity.mjs [--db NAME] [--dry-run] [--allow-hosted] [--data-dir DIR]
//
// The pairs are the frozen APPROVED_CONTINUITY_SUPERSESSIONS allowlist; no argument can add or change
// one. A hosted database is refused unless --allow-hosted is passed. --dry-run only reads and prints
// the planned supersessions. A real run inserts one superseding continuity decision per planned pair
// and nothing when every pair is already applied.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE } from "./lib/config.mjs";
import { lit, num, pipelineConnectionTarget, queryRows } from "./lib/db.mjs";
import {
  APPROVED_CONTINUITY_SUPERSESSIONS, SUPERSESSION_RULE_CODE, SUPERSESSION_RULE_VERSION, SUPERSESSION_RUN_KIND,
} from "./normalize/continuity-supersession.mjs";
import { FOOTNOTE_REF_CODE, FOOTNOTE_REF_VERSION } from "./normalize/instrument-type-footnote-ref.mjs";
import {
  applyContinuitySupersession, planContinuitySupersession, summarizePlan,
} from "./load/continuity-supersession.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { RULES, ensureAndLinkRuleForRun, ruleDefinitionSha } from "./load/rules.mjs";

export const SUPERSESSION_RULES = [
  { code: SUPERSESSION_RULE_CODE, version: SUPERSESSION_RULE_VERSION },
  { code: FOOTNOTE_REF_CODE, version: FOOTNOTE_REF_VERSION },
];

const FLAGS = new Set(["--dry-run", "--allow-hosted"]);
const OPTIONS = new Set(["--db", "--data-dir"]);

export function parseArgs(args) {
  const out = { database: DEFAULT_DATABASE, dataDir: DEFAULT_DATA_DIR, dryRun: false, allowHosted: false };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (FLAGS.has(arg)) {
      if (arg === "--dry-run") out.dryRun = true;
      else out.allowHosted = true;
    } else if (OPTIONS.has(arg)) {
      const value = args[i + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--db") out.database = value;
      else out.dataDir = value;
      i += 1;
    } else {
      throw new Error(`unknown argument ${arg}; the approved pairs cannot be changed from the command line`);
    }
  }
  return out;
}

export function assertSupersessionDatabase(database, { allowHosted = false } = {}) {
  if (pipelineConnectionTarget().mode !== "local") {
    if (!allowHosted) throw new Error("approved continuity supersession refuses a hosted database");
    return;
  }
  if (database !== DEFAULT_DATABASE) {
    throw new Error("approved continuity supersession refuses a database other than the local database");
  }
}

function ruleIdentity() {
  const rule = RULES.find((item) => item.code === SUPERSESSION_RULE_CODE && item.version === SUPERSESSION_RULE_VERSION);
  return { code: rule.code, version: rule.version, definition_sha256: ruleDefinitionSha(rule) };
}

// The approved correction. The allowlist is always the frozen constant.
export function supersedeApprovedContinuity({
  database, allowHosted = false, dryRun = false, dataDir = DEFAULT_DATA_DIR, log: logFn = console.log,
}) {
  assertSupersessionDatabase(database, { allowHosted });
  return runContinuitySupersession({
    database, dryRun, dataDir, log: logFn, allowlist: APPROVED_CONTINUITY_SUPERSESSIONS,
  });
}

// Shared by the approved command and the synthetic integration test. validateAllowlist refuses protected
// observations; evaluatePair refuses any pair whose pinned facts differ from the stored facts.
export function runContinuitySupersession({ database, dryRun, dataDir, log: logFn, allowlist }) {
  const plan = planContinuitySupersession({ database, allowlist, dataDir });
  const summary = { rule: ruleIdentity(), ...summarizePlan(plan) };
  if (dryRun) {
    const out = { mode: "dry-run", ...summary };
    logFn(JSON.stringify(out));
    if (summary.n_blocked > 0) throw new Error(`dry-run: ${summary.n_blocked} pair(s) blocked`);
    return out;
  }
  if (summary.n_blocked > 0) {
    logFn(JSON.stringify({ mode: "refused", ...summary }));
    throw new Error(`approved continuity supersession refused: ${summary.n_blocked} pair(s) blocked`);
  }
  if (summary.n_planned === 0) {
    const out = { mode: "nothing-to-do", ...summary };
    logFn(JSON.stringify(out));
    return out;
  }
  const runId = Number(queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES (${lit(SUPERSESSION_RUN_KIND)}, ${lit(pipelineCodeVersion())},
        ${lit(JSON.stringify({
    rule: `${SUPERSESSION_RULE_CODE} v${SUPERSESSION_RULE_VERSION}`,
    pairs: allowlist.map((entry) => [entry.laterObservationId, entry.earlierObservationId]),
  }))}::jsonb, now())
RETURNING id;`)[0][0]);
  const rules = Object.fromEntries(SUPERSESSION_RULES.map((rule) => [rule.code, ensureAndLinkRuleForRun(database, runId, rule)]));
  const applied = applyContinuitySupersession({
    database, runId, ruleVersionId: rules[SUPERSESSION_RULE_CODE].id, plan,
  });
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${num(runId)}, 'SUCCEEDED', now(), ${lit(JSON.stringify({
    n_planned: summary.n_planned,
    n_already_applied: summary.n_already_applied,
    candidates: applied.candidates,
    comparisons: applied.comparisons,
    decisions: applied.decisions.length,
  }))}::jsonb);`);
  const out = { mode: "applied", run_id: runId, rule_version_id: rules[SUPERSESSION_RULE_CODE].id, ...summary, applied };
  logFn(JSON.stringify(out));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    supersedeApprovedContinuity(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
