#!/usr/bin/env node
// P5-min for the Stage A golden locator list only. Fetches stored filing_document URLs,
// loads L2 artifacts, and records exact-string checks. Does not scan SOI. Does not run soi:load.
//
//   node --env-file-if-exists=.env.local pipeline/p5-golden.mjs [-- --db NAME] [-- --locators PATH]

import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, DEFAULT_DATA_DIR, REPO_ROOT } from "./lib/config.mjs";
import { lit, queryRows } from "./lib/db.mjs";
import { createSecClient, requireUserAgent } from "./lib/http.mjs";
import {
  applyP5Verifications, goldenEvidenceReport, listGoldenFilingDocuments, loadGoldenFilingDocuments,
  snapshotP5Min,
} from "./load/p5-min.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { registerRules } from "./load/rules.mjs";
import { fetchGoldenFilingDocuments } from "./p5-golden-fetch.mjs";

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

export async function runP5Golden({
  database,
  locatorsPath,
  selectionPath,
  reportPath,
  dataDir = DEFAULT_DATA_DIR,
  client = null,
  sessionId = null,
  log: logFn = console.log,
}) {
  const ids = readLocators(locatorsPath);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw new Error("P5-min: locator file has duplicate position_observation_id values");
  const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
  const identifierSha256 = selection?.selected?.identifier_sha256;
  if (!/^[0-9a-f]{64}$/.test(identifierSha256 ?? "")) {
    throw new Error("P5-min: stage_a_selection.json is missing selected.identifier_sha256");
  }

  const before = snapshotP5Min(database, unique);
  const locatorsSha = createHash("sha256").update(readFileSync(locatorsPath)).digest("hex");
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, input_sha256, parameters, started_at)
VALUES ('P5_GOLDEN', '${codeVersion}', '${locatorsSha}',
        jsonb_build_object('locators', ${lit(path.relative(REPO_ROOT, locatorsPath))},
                           'n_locators', ${unique.length},
                           'identifier_sha256', ${lit(identifierSha256)}), now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const rules = registerRules(database, runId);

  const documents = listGoldenFilingDocuments(database, unique);
  if (documents.length === 0) throw new Error("P5-min: no registry.filing_document rows for Golden locators");
  const urls = documents.map((d) => d.document_url);
  const sid = sessionId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const secClient = client ?? createSecClient({ userAgent: requireUserAgent() });
  const fetchSummary = await fetchGoldenFilingDocuments({
    dataDir, client: secClient, sessionId: sid, urls, log: logFn,
  });

  const loaded = loadGoldenFilingDocuments({
    database, runId, rules, documents, fetchEntriesByUrl: fetchSummary.entries_by_url,
  });
  const verified = applyP5Verifications({
    database, positionObservationIds: unique, runId, rules, dataDir, documents,
  });
  const after = snapshotP5Min(database, unique);
  const evidence = goldenEvidenceReport(database, unique);

  const soiUnchanged = after.soi_row_observation_count === before.soi_row_observation_count
    && after.max_soi_row_observation_id === before.max_soi_row_observation_id;
  const positionUnchanged = after.position_observation_count === before.position_observation_count
    && after.max_position_observation_id === before.max_position_observation_id;
  const fieldUnchanged = after.position_field_value_count === before.position_field_value_count
    && after.max_position_field_value_id === before.max_position_field_value_id;
  const derivedUnchanged = after.derived_value_input_count === before.derived_value_input_count;
  if (!soiUnchanged || !positionUnchanged || !fieldUnchanged || !derivedUnchanged) {
    throw new Error("P5-min: SOI, position, field-value, or derived-input rows changed");
  }

  const costN = evidence.economic_fields.by_field?.COST?.n ?? 0;
  const fvN = evidence.economic_fields.by_field?.FAIR_VALUE?.n ?? 0;
  const q14Blocked = evidence.q14.derived_inputs === 0
    && evidence.q14.authoritative_cost_fv === 0
    && evidence.q14.open_question_cost_fv === costN + fvN;

  const counts = {
    documents: documents.length,
    fetch: {
      requested: fetchSummary.requested,
      requests: fetchSummary.requests,
      reused_from_log: fetchSummary.reused_from_log,
      stored: fetchSummary.stored,
      not_found: fetchSummary.not_found,
    },
    loaded,
    verified,
    evidence_status: evidence.economic_fields,
    identifier_name: evidence.identifier_name,
  };
  queryRows(database, `INSERT INTO ops.run_outcome (run_id, status, finished_at, counts)
VALUES (${runId}, 'SUCCEEDED', now(), '${JSON.stringify(counts).replace(/'/g, "''")}'::jsonb);`);

  const report = {
    phase: "8",
    step: "p5_min",
    database,
    run_id: runId,
    queried_at: new Date().toISOString(),
    identifier_sha256: identifierSha256,
    n_golden_position_observations: unique.length,
    n_golden_accessions: evidence.n_accessions,
    n_filing_documents: evidence.n_filing_documents,
    documents_successfully_fetched: loaded.loaded,
    documents_unavailable: loaded.unavailable,
    fetch: counts.fetch,
    loaded,
    l2_artifacts: evidence.l2_artifacts,
    verified,
    identifier_name: evidence.identifier_name,
    field_values: evidence.economic_fields,
    absent_reported_fields: evidence.absent_reported_fields,
    q14: evidence.q14,
    q14_remains_blocked: q14Blocked,
    snapshot_before: before,
    snapshot_after: after,
    non_golden_soi_unchanged: soiUnchanged && positionUnchanged && fieldUnchanged,
    derived_inputs_unchanged: derivedUnchanged,
    golden_slice_only: true,
    filing_string_rule: { code: "validation.golden_filing_string", version: "1", rule_version_id: rules["validation.golden_filing_string"] },
    p5_load_rule: { code: "pipeline.p5_golden", version: "1", rule_version_id: rules["pipeline.p5_golden"] },
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  logFn(JSON.stringify({
    run_id: runId,
    n_golden_position_observations: unique.length,
    n_golden_accessions: evidence.n_accessions,
    fetch: counts.fetch,
    loaded,
    l2_artifacts: evidence.l2_artifacts,
    identifier_name: evidence.identifier_name,
    field_values: evidence.economic_fields,
    q14: evidence.q14,
    q14_remains_blocked: q14Blocked,
    non_golden_soi_unchanged: report.non_golden_soi_unchanged,
    report: path.relative(REPO_ROOT, reportPath),
  }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const locatorsPath = opt(args, "--locators") ?? path.join(GOLDEN_DIR, "stage_a_locators.jsonl");
  const selectionPath = opt(args, "--selection") ?? path.join(GOLDEN_DIR, "stage_a_selection.json");
  const reportPath = opt(args, "--report") ?? path.join(GOLDEN_DIR, "p5_min_report.json");
  const database = opt(args, "--db") ?? DEFAULT_DATABASE;
  const dataDir = opt(args, "--data-dir") ?? DEFAULT_DATA_DIR;
  if (!existsSync(locatorsPath) || !existsSync(selectionPath)) {
    console.error("p5-golden: missing Stage A locator/selection files under .data/validation/golden/");
    process.exit(1);
  }
  await runP5Golden({ database, locatorsPath, selectionPath, reportPath, dataDir });
}
