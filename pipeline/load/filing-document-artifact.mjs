// Fetch one stored registry.filing_document URL and link the immutable bytes.
// This is not the Golden runner. It does not insert evidence.evidence rows.

import { pipelineCodeVersion } from "./run.mjs";
import { artifactBlock } from "./sql.mjs";
import { lit, num, queryRows, runScript } from "../lib/db.mjs";
import { assertFilingDocumentUrl, fetchGoldenFilingDocuments } from "../p5-golden-fetch.mjs";

function filingDocumentId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`invalid filing_document_id: ${value}`);
  return id;
}

export function readFilingDocumentUrl(database, id) {
  const filingDocumentIdValue = filingDocumentId(id);
  const rows = queryRows(database, `SELECT document_url FROM registry.filing_document WHERE id = ${num(filingDocumentIdValue)};`);
  if (rows.length !== 1) throw new Error(`filing_document ${filingDocumentIdValue} is not stored`);
  const url = rows[0][0];
  assertFilingDocumentUrl(url);
  return url;
}

export async function fetchStoredFilingDocument({
  documentUrl, dataDir, client, sessionId, log: logFn = console.log,
}) {
  assertFilingDocumentUrl(documentUrl);
  if (!sessionId) throw new Error("filing-document fetch requires a session_id");
  return fetchGoldenFilingDocuments({
    dataDir, client, sessionId, urls: [documentUrl], log: logFn,
  });
}

export function linkFilingDocumentArtifact({ database, runId, filingDocumentId: id, entry }) {
  const filingDocumentIdValue = filingDocumentId(id);
  const run = num(runId);
  if (!entry?.sha256 || !entry.storage_key || entry.http_status !== 200) {
    return { artifact_id: null, link_inserted: 0, filing_document_artifact_id: null };
  }
  const sql = `
BEGIN;
CREATE TEMP TABLE _ctx (k text PRIMARY KEY, v bigint) ON COMMIT DROP;
CREATE FUNCTION pg_temp.ctx(key text) RETURNS bigint LANGUAGE sql STABLE AS $f$ SELECT v FROM _ctx WHERE k = key $f$;
${artifactBlock("artifact", { ...entry, source_type: "SEC_FILING_DOCUMENT" }, runId)}
WITH ins AS (
  INSERT INTO registry.filing_document_artifact (filing_document_id, artifact_id, run_id)
  SELECT ${num(filingDocumentIdValue)}, pg_temp.ctx('artifact'), ${run}
  WHERE NOT EXISTS (
    SELECT 1 FROM registry.filing_document_artifact x
    WHERE x.filing_document_id = ${num(filingDocumentIdValue)} AND x.artifact_id = pg_temp.ctx('artifact'))
  RETURNING id
)
SELECT json_build_object(
  'artifact_id', pg_temp.ctx('artifact'),
  'link_inserted', (SELECT count(*) FROM ins),
  'filing_document_artifact_id', COALESCE(
    (SELECT id FROM ins),
    (SELECT a.id FROM registry.filing_document_artifact a
      WHERE a.filing_document_id = ${num(filingDocumentIdValue)} AND a.artifact_id = pg_temp.ctx('artifact'))));
COMMIT;`;
  const line = runScript(database, sql).find((row) => row.startsWith("{"));
  return JSON.parse(line);
}

export async function fetchAndLinkFilingDocument({
  database, filingDocumentId: id, dataDir, client, sessionId, log: logFn = console.log,
}) {
  const filingDocumentIdValue = filingDocumentId(id);
  const documentUrl = readFilingDocumentUrl(database, filingDocumentIdValue);
  const codeVersion = pipelineCodeVersion();
  const runRows = queryRows(database, `INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('FILING_DOCUMENT_FETCH', ${lit(codeVersion)},
        jsonb_build_object('filing_document_id', ${num(filingDocumentIdValue)}), now())
RETURNING id;`);
  const runId = Number(runRows[0][0]);
  const fetched = await fetchStoredFilingDocument({
    documentUrl, dataDir, client, sessionId, log: logFn,
  });
  const entry = fetched.entries_by_url[documentUrl];
  const linked = linkFilingDocumentArtifact({
    database, runId, filingDocumentId: filingDocumentIdValue, entry,
  });
  return {
    filing_document_id: filingDocumentIdValue,
    document_url: documentUrl,
    run_id: runId,
    http_status: entry?.http_status ?? null,
    sha256: entry?.sha256 ?? null,
    storage_key: entry?.storage_key ?? null,
    requests: fetched.requests,
    reused_from_log: fetched.reused_from_log,
    artifact_id: linked.artifact_id == null ? null : Number(linked.artifact_id),
    link_inserted: Number(linked.link_inserted),
    filing_document_artifact_id: linked.filing_document_artifact_id == null
      ? null
      : Number(linked.filing_document_artifact_id),
  };
}
