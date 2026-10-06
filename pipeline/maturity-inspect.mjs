#!/usr/bin/env node
// Maturity inspection for whole filings selected by accession number. Binding, NOT_BOUND
// reasons, supersession, and evidence come unchanged from load/maturity-inspection-batch.mjs.
// Filing HTML is fetched only when no artifact is linked to the primary document; that fetch
// needs SEC_USER_AGENT. This script does not read .env.local.
//
//   node pipeline/maturity-inspect.mjs --accession ACCESSION [--accession ACCESSION ...] [--db NAME] [--data-dir DIR]

import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE, DEFAULT_DATA_DIR } from "./lib/config.mjs";
import { lit, num, queryRows } from "./lib/db.mjs";
import { createSecClient, requireUserAgent } from "./lib/http.mjs";
import { createStore } from "./lib/store.mjs";
import { fetchAndLinkFilingDocument } from "./load/filing-document-artifact.mjs";
import {
  RULE_VERSION, bindFilingPositions, commitInspectionPublication, ensureRule,
  formatInspectionErrors, inspectFilingPositions, recordMaturityRunFailure,
} from "./load/maturity-inspection-batch.mjs";
import { pipelineCodeVersion } from "./load/run.mjs";
import { listIxContextRows } from "./normalize/ix-context-row.mjs";

const ACCESSION = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;

export function parseAccessions(args) {
  const accessions = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--accession") continue;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("--accession needs a value");
    accessions.push(value);
  }
  return validateAccessions(accessions);
}

export function validateAccessions(accessions) {
  if (accessions.length === 0) throw new Error("at least one --accession is required");
  for (const accession of accessions) {
    if (!ACCESSION.test(accession)) throw new Error(`not an accession number: ${accession}`);
  }
  if (new Set(accessions).size !== accessions.length) throw new Error("an accession is listed more than once");
  return accessions;
}

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function selectFiling(database, accession) {
  const filings = queryRows(database, `SELECT id FROM registry.filing WHERE accession_number = ${lit(accession)}`);
  if (filings.length !== 1) throw new Error(`${accession}: accession is not in registry.filing`);
  const filingId = Number(filings[0][0]);

  const located = queryRows(database, `SELECT p.id, r.line_number, o.id, p.reported_date::text
    FROM obs.position_observation p
    JOIN obs.soi_row_observation o ON o.id = p.origin_soi_row_observation_id
    JOIN raw.tabular_row r ON r.id = o.tabular_row_id
    WHERE p.filing_id = ${num(filingId)}
    ORDER BY p.id`);
  if (located.length === 0) throw new Error(`${accession}: no positions found`);

  const documents = queryRows(database, `SELECT id FROM registry.filing_document
    WHERE filing_id = ${num(filingId)} AND named_by = 'SUBMISSIONS_PRIMARY_DOCUMENT'`);
  if (documents.length !== 1) {
    throw new Error(`${accession}: expected one primary filing document, found ${documents.length}`);
  }

  const positions = located.map(([id, lineNumber, originId, reportedDate]) => ({
    positionId: Number(id),
    lineNumber: Number(lineNumber),
    accession,
    originId: Number(originId),
    reportedDate: reportedDate || null,
    fields: [],
  }));
  const byId = new Map(positions.map((position) => [position.positionId, position]));
  const fields = queryRows(database, `SELECT fv.position_observation_id, fv.field_code, fv.raw_value,
      fv.normalized_numeric::text
    FROM obs.current_position_field_value fv
    JOIN obs.position_observation p ON p.id = fv.position_observation_id
    WHERE p.filing_id = ${num(filingId)}
    ORDER BY fv.position_observation_id, fv.field_code, fv.source_column_label`);
  for (const [positionId, fieldCode, rawValue, normalized] of fields) {
    byId.get(Number(positionId))?.fields.push({
      field_code: fieldCode,
      raw_value: rawValue,
      normalized_numeric: normalized === "" ? null : normalized,
    });
  }
  return { accession, filingId, filingDocumentId: Number(documents[0][0]), positions };
}

function linkedArtifacts(database, filingDocumentId) {
  return queryRows(database, `SELECT a.id, a.storage_key, a.sha256
    FROM registry.filing_document_artifact fda
    JOIN raw.artifact a ON a.id = fda.artifact_id
    WHERE fda.filing_document_id = ${num(filingDocumentId)}`);
}

async function establishArtifact({ database, filing, dataDir, getClient, sessionId, log }) {
  let rows = linkedArtifacts(database, filing.filingDocumentId);
  if (rows.length === 0) {
    const linked = await fetchAndLinkFilingDocument({
      database,
      filingDocumentId: filing.filingDocumentId,
      dataDir,
      client: getClient(),
      sessionId,
      log,
    });
    if (linked.http_status !== 200 || !linked.artifact_id) {
      throw new Error(`${filing.accession}: filing HTML artifact could not be established (HTTP ${linked.http_status ?? "none"})`);
    }
    rows = linkedArtifacts(database, filing.filingDocumentId);
  }
  if (rows.length !== 1) {
    throw new Error(`${filing.accession}: expected one filing HTML artifact, found ${rows.length}`);
  }
  const [artifactId, storageKey, sha256] = rows[0];
  let html;
  try {
    html = createStore(dataDir).read(storageKey, sha256).toString("utf8");
  } catch (caught) {
    throw new Error(`${filing.accession}: stored filing HTML could not be read: ${caught.message}`);
  }
  return { artifactId: Number(artifactId), html };
}

function provenanceCounts(database, positionIds) {
  const rows = queryRows(database, `SELECT provenance_state::text, count(*)
    FROM obs.maturity_provenance
    WHERE position_observation_id IN (${positionIds.map(num).join(",")})
    GROUP BY 1 ORDER BY 1`);
  return Object.fromEntries(rows.map(([state, n]) => [state, Number(n)]));
}

export async function runMaturityInspect({
  database,
  accessions,
  dataDir = DEFAULT_DATA_DIR,
  client = null,
  sessionId = null,
  log = console.log,
}) {
  validateAccessions(accessions);
  let runId;
  try {
  const sid = sessionId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  let secClient = client;
  const getClient = () => {
    secClient ??= createSecClient({ userAgent: requireUserAgent() });
    return secClient;
  };

  const filings = accessions.map((accession) => selectFiling(database, accession));
  for (const filing of filings) {
    Object.assign(filing, await establishArtifact({ database, filing, dataDir, getClient, sessionId: sid, log }));
  }

  const [runRow] = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
    VALUES ('MATURITY_INSPECTION_BATCH', ${lit(pipelineCodeVersion())},
      jsonb_build_object('accessions', ${lit(JSON.stringify(accessions))}::jsonb,
        'positions', ${num(filings.reduce((n, filing) => n + filing.positions.length, 0))},
        'rule_version', ${lit(RULE_VERSION)}), now())
    RETURNING id`);
  runId = Number(runRow[0]);
  const ruleId = ensureRule(database, runId);

  const prepared = [];
  for (const filing of filings) {
    const recorded = inspectFilingPositions(database, {
      positions: filing.positions,
      binds: bindFilingPositions(listIxContextRows(filing.html), filing.positions),
      artifactId: filing.artifactId,
      ruleId,
    });
    if (recorded.errors.length) {
      throw new Error(`${filing.accession}: ${formatInspectionErrors(recorded.errors)}`);
    }
    const actions = {};
    for (const { plan } of recorded.results) {
      const key = `${plan.action}:${plan.state}`;
      actions[key] = (actions[key] ?? 0) + 1;
    }
    prepared.push({
      filing,
      recorded,
      summary: {
        accession: filing.accession,
        positions: filing.positions.length,
        artifact_id: filing.artifactId,
        actions,
      },
    });
  }
  commitInspectionPublication(database, {
    runId,
    ruleId,
    filings: prepared.map(({ filing, recorded }) => ({
      artifactId: filing.artifactId,
      results: recorded.results,
      errors: recorded.errors,
    })),
    counts: { rule_version: RULE_VERSION, accessions: prepared.map(({ summary }) => summary) },
  });
  const results = prepared.map(({ filing, summary }) => {
    const reported = {
      ...summary,
      provenance: provenanceCounts(database, filing.positions.map((position) => position.positionId)),
    };
    log(JSON.stringify(reported));
    return reported;
  });
  return { run_id: runId, rule_id: ruleId, rule_version: RULE_VERSION, accessions: results };
  } catch (error) {
    if (runId !== undefined) {
      try {
        recordMaturityRunFailure(database, runId, error);
      } catch {
        // The original failure is the one that must surface.
      }
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    const accessions = parseAccessions(args);
    await runMaturityInspect({
      database: opt(args, "--db") ?? DEFAULT_DATABASE,
      dataDir: opt(args, "--data-dir") ?? DEFAULT_DATA_DIR,
      accessions,
    });
  } catch (caught) {
    console.error(`maturity-inspect: ${caught.message}`);
    process.exit(caught.exitCode === 2 ? 2 : 1);
  }
}
