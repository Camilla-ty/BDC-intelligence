#!/usr/bin/env node
// Phase 8 Golden Borrower Gate. Validation only. No universe scan, fetch, Q14 change, UI, or events.
//
//   node pipeline/golden-gate.mjs [-- --db NAME] [-- --locators PATH]

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, REPO_ROOT } from "./lib/config.mjs";
import { lit, queryRows } from "./lib/db.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { registerRules } from "./load/rules.mjs";
import {
  GOLDEN_IDENTIFIER_SHA256,
  chainNotesFromEvidence,
  collectGoldenGateEvidence,
  evaluateCriteria,
  evaluateNegativeControls,
  INTERPRETATION,
  overallGateStatus,
  outcomesShaPayload,
  renderGoldenGateReport,
} from "./load/golden-gate.mjs";

const GOLDEN_DIR = path.join(REPO_ROOT, ".data", "validation", "golden");

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function readLocators(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
  const locators = [];
  const seen = new Set();
  for (const line of lines) {
    const row = JSON.parse(line);
    const id = row.position_observation_id;
    if (!Number.isSafeInteger(id)) throw new Error(`locator line missing position_observation_id: ${file}`);
    if (seen.has(id)) throw new Error("Golden Gate: locator file has duplicate position_observation_id values");
    seen.add(id);
    if (typeof row.accession_number !== "string" || row.accession_number === "") {
      throw new Error("Golden Gate: locator missing accession_number");
    }
    locators.push({
      position_observation_id: id,
      accession_number: row.accession_number,
      table_load_id: Number(row.table_load_id),
      line_number: Number(row.line_number),
      reported_date: row.reported_date,
      registrant_cik: String(row.registrant_cik),
    });
  }
  return locators;
}

function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function runGoldenGate({
  database, locatorsPath, selectionPath, reportPath, jsonPath, log: logFn = console.log,
}) {
  const locators = readLocators(locatorsPath);
  const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
  const identifierSha256 = selection?.selected?.identifier_sha256;
  if (identifierSha256 !== GOLDEN_IDENTIFIER_SHA256) {
    throw new Error("Golden Gate: stage_a_selection.json identifier_sha256 does not match the approved Golden identifier");
  }

  const locatorsSha = sha256Bytes(readFileSync(locatorsPath));
  const selectionSha = sha256Bytes(readFileSync(selectionPath));
  const selectionMeta = {
    identifier_sha256: identifierSha256,
    n_registrants: selection.selected.n_registrants,
    n_reported_dates: selection.selected.n_reported_dates,
    n_observations: selection.selected.n_observations,
    n_accessions: selection.selected.n_accessions,
    locators_sha256: locatorsSha,
    selection_sha256: selectionSha,
  };

  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('GOLDEN_GATE', '${codeVersion}', '${locatorsSha}',
        jsonb_build_object('locators', ${lit(path.relative(REPO_ROOT, locatorsPath))},
                           'n_locators', ${locators.length},
                           'identifier_sha256', ${lit(identifierSha256)},
                           'selection_sha256', ${lit(selectionSha)}), now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);

  const evidence1 = collectGoldenGateEvidence({
    database, locators, identifierSha256, selectionMeta,
  });
  const criteria1 = evaluateCriteria(evidence1);
  const evidence2 = collectGoldenGateEvidence({
    database, locators, identifierSha256, selectionMeta,
  });
  const criteria2 = evaluateCriteria(evidence2);

  const sha1 = sha256Bytes(Buffer.from(JSON.stringify(outcomesShaPayload(criteria1))));
  const sha2 = sha256Bytes(Buffer.from(JSON.stringify(outcomesShaPayload(criteria2))));
  const identical = sha1 === sha2;
  const overall = identical ? overallGateStatus(criteria1) : "FAIL";
  const reproducibility = { runs: 2, identical, sha1, sha2 };

  const criteria = identical ? criteria1 : [
    ...criteria1,
    {
      id: "gate_reproducibility",
      status: "FAIL",
      evidence: { sha1, sha2 },
      notes: "Two consecutive Golden Gate evaluations produced different criterion statuses.",
    },
  ];
  const negativeControls = evaluateNegativeControls(evidence1);
  const queriedAt = new Date().toISOString();
  const metric = {
    ...evidence1.metric,
    supporting_distinct_bdcs: evidence1.chain.distinct_registrant_ciks,
    supporting_distinct_dates: evidence1.chain.distinct_reported_dates,
  };

  const report = {
    phase: "8",
    step: "golden_gate",
    database,
    run_id: runId,
    queried_at: queriedAt,
    identifier_sha256: identifierSha256,
    rule: { code: "validation.golden_gate", version: "4", rule_version_id: rules["validation.golden_gate"] },
    overall,
    criteria,
    negative_controls: negativeControls,
    chain_notes: chainNotesFromEvidence(evidence1),
    interpretation: INTERPRETATION,
    metric,
    universe: evidence1.universe,
    evidence: evidence1,
    reproducibility,
    expected: {
      soi_row_observation_count: 1_955_396,
      position_observation_count: 1_442_423,
      position_field_value_count: 6_538_911,
      golden_name_observations: 181,
      p6_entity_matched: 181,
      p7_instrument_matched: 0,
      p7_continuity_series: 0,
      q14_authoritative_cost_fv: 0,
    },
    golden_slice_only: true,
    phase_9_not_started: true,
    phase_10_not_started: true,
  };

  const markdown = renderGoldenGateReport({
    queriedAt,
    database,
    runId,
    identifierSha256,
    overall,
    criteria,
    negativeControls,
    reproducibility,
    chainNotes: report.chain_notes,
    metric,
    universe: evidence1.universe,
    interpretation: INTERPRETATION,
  });

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportPath, markdown);

  const counts = {
    overall,
    n_pass: criteria.filter((c) => c.status === "PASS").length,
    n_blocked: criteria.filter((c) => c.status === "BLOCKED").length,
    n_fail: criteria.filter((c) => c.status === "FAIL").length,
    n_not_applicable: criteria.filter((c) => c.status === "NOT APPLICABLE").length,
    golden_observation_count: metric.from_locators,
    identical_runs: identical,
  };
  const outcomeStatus = overall === "FAIL" ? "FAILED" : "SUCCEEDED";
  const errorSummary = overall === "FAIL"
    ? criteria.filter((c) => c.status === "FAIL").map((c) => c.id).join(", ")
    : null;
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts, error_summary)
VALUES (${runId}, '${outcomeStatus}', now(), '${JSON.stringify(counts).replace(/'/g, "''")}'::jsonb,
        ${errorSummary == null ? "NULL" : lit(errorSummary)});`);

  logFn(JSON.stringify({
    run_id: runId,
    overall,
    ...counts,
    report: path.relative(REPO_ROOT, reportPath),
    json: path.relative(REPO_ROOT, jsonPath),
  }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const locatorsPath = opt(args, "--locators") ?? path.join(GOLDEN_DIR, "stage_a_locators.jsonl");
  const selectionPath = opt(args, "--selection") ?? path.join(GOLDEN_DIR, "stage_a_selection.json");
  const reportPath = opt(args, "--report") ?? path.join(GOLDEN_DIR, "GOLDEN_GATE_REPORT.md");
  const jsonPath = opt(args, "--json") ?? path.join(GOLDEN_DIR, "golden_gate.json");
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  if (!existsSync(locatorsPath) || !existsSync(selectionPath)) {
    console.error("golden-gate: missing Stage A locator/selection files under .data/validation/golden/");
    process.exit(1);
  }
  const result = await runGoldenGate({ database, locatorsPath, selectionPath, reportPath, jsonPath });
  if (result.overall === "FAIL") process.exit(1);
}
