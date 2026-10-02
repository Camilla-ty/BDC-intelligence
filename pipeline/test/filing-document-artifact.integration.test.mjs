import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  containerRunning, createDatabase, dockerAvailable, dropDatabase, query, startContainer, stopContainer,
} from "../../scripts/db/pg.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createStore } from "../lib/store.mjs";
import { fetchAndLinkFilingDocument } from "../load/filing-document-artifact.mjs";

const dbName = `bdc_fd_${process.pid}`;
const URL = "https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm";
const HTML = Buffer.from("<html>TEST ONLY filing document</html>");

function scalar(sql) {
  const found = query(dbName, sql);
  assert.equal(found.length, 1, sql);
  return found[0];
}

function withDb(fn) {
  return async (t) => {
    if (!dockerAvailable()) {
      if (process.env.CI) throw new Error("Docker is required in CI for pipeline database tests");
      t.skip("Docker is not available; pipeline database tests skipped");
      return;
    }
    let startedHere = false;
    if (!containerRunning()) {
      startedHere = startContainer();
      if (!containerRunning()) throw new Error("PostgreSQL container is not running");
    }
    const savedPipelineUrl = process.env.PIPELINE_DATABASE_URL;
    delete process.env.PIPELINE_DATABASE_URL;
    const dataDir = mkdtempSync(path.join(tmpdir(), "bdc-fd-"));
    try {
      dropDatabase(dbName);
      createDatabase(dbName);
      migrate(dbName);
      await fn(dataDir);
    } finally {
      try { dropDatabase(dbName); } catch { /* still clean the temp dir */ }
      rmSync(dataDir, { recursive: true, force: true });
      if (savedPipelineUrl === undefined) delete process.env.PIPELINE_DATABASE_URL;
      else process.env.PIPELINE_DATABASE_URL = savedPipelineUrl;
      if (startedHere) {
        try { stopContainer(); } catch { /* container may already be gone */ }
      }
    }
  };
}

test("a stored filing document is linked to one immutable artifact", withDb(async (dataDir) => {
  query(dbName, `
INSERT INTO ops.run (run_kind, code_version, parameters, started_at)
VALUES ('TEST', 'test', '{}'::jsonb, now());
INSERT INTO ops.rule_version (rule_code, rule_kind, version, definition_sha256, spec_reference, description, created_by)
VALUES ('test.filing_document', 'EXTRACTION', 'test-1', repeat('c', 64), 'pipeline/test (test only)', 'TEST ONLY rule', 'db tests');
INSERT INTO raw.artifact (source_url, final_url, source_type_code, http_status, byte_size, sha256, retrieved_at, storage_key, run_id)
VALUES ('https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/naming-only.htm',
        'https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/naming-only.htm',
        'SEC_FILING_DOCUMENT', 200, 1, repeat('c', 64), '2099-01-02T00:00:00Z', 'test-only/naming',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO evidence.evidence (evidence_level, artifact_id, locator_type, run_id)
VALUES ('L2_ORIGINAL_FILING', (SELECT id FROM raw.artifact WHERE sha256 = repeat('c', 64)), 'DOCUMENT',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'));
INSERT INTO registry.filing (accession_number, run_id, evidence_id)
VALUES ('0000000000-00-000001',
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'DOCUMENT'));
INSERT INTO registry.filing_document (filing_id, document_name, document_url, named_by, rule_version_id, run_id, evidence_id)
VALUES ((SELECT id FROM registry.filing WHERE accession_number = '0000000000-00-000001'),
        'test-only.htm', '${URL}', 'FILING_INDEX_JSON',
        (SELECT id FROM ops.rule_version WHERE rule_code = 'test.filing_document'),
        (SELECT id FROM ops.run WHERE run_kind = 'TEST'),
        (SELECT id FROM evidence.evidence WHERE locator_type = 'DOCUMENT'));
`);
  const filingDocumentId = Number(scalar("SELECT id FROM registry.filing_document"));
  const evidenceBefore = scalar("SELECT count(*) FROM evidence.evidence");
  const positionsBefore = scalar("SELECT count(*) FROM obs.position_observation");
  const seen = [];
  const client = {
    get: async (url) => {
      seen.push(url);
      assert.equal(url, URL);
      return {
        status: 200, finalUrl: url, body: HTML,
        contentType: "text/html", lastModified: null, etag: null,
      };
    },
  };

  const first = await fetchAndLinkFilingDocument({
    database: dbName, filingDocumentId, dataDir, client, sessionId: "TEST-ONLY-FD", log: () => {},
  });
  const opened = createStore(dataDir).read(first.storage_key, first.sha256);
  assert.deepEqual(opened, HTML);
  assert.equal(first.link_inserted, 1);
  assert.equal(seen.length, 1);
  assert.equal(scalar("SELECT count(*) FROM evidence.evidence"), evidenceBefore);
  assert.equal(scalar("SELECT count(*) FROM obs.position_observation"), positionsBefore);
  assert.equal(scalar(`SELECT count(*) FROM registry.filing_document_artifact WHERE filing_document_id = ${filingDocumentId}`), "1");
  assert.equal(scalar(`SELECT count(*) FROM raw.artifact WHERE source_url = '${URL}'`), "1");
  assert.equal(scalar(`SELECT sha256 || ' ' || storage_key FROM raw.artifact WHERE id = ${first.artifact_id}`),
    `${first.sha256} ${first.storage_key}`);

  const second = await fetchAndLinkFilingDocument({
    database: dbName, filingDocumentId, dataDir, client, sessionId: "TEST-ONLY-FD-B", log: () => {},
  });
  assert.equal(second.requests, 0);
  assert.equal(second.reused_from_log, 1);
  assert.equal(second.link_inserted, 0);
  assert.equal(second.artifact_id, first.artifact_id);
  assert.equal(second.filing_document_artifact_id, first.filing_document_artifact_id);
  assert.equal(second.sha256, first.sha256);
  assert.equal(seen.length, 1);
  assert.equal(scalar("SELECT count(*) FROM evidence.evidence"), evidenceBefore);
  assert.equal(scalar(`SELECT count(*) FROM raw.artifact WHERE source_url = '${URL}'`), "1");
  assert.equal(scalar(`SELECT count(*) FROM registry.filing_document_artifact WHERE filing_document_id = ${filingDocumentId}`), "1");
  console.log([
    `filing_document_id=${first.filing_document_id}`,
    `artifact_id=${first.artifact_id}`,
    `filing_document_artifact_id=${first.filing_document_artifact_id}`,
    `sha256=${first.sha256}`,
    `storage_key=${first.storage_key}`,
    `second_link_inserted=${second.link_inserted}`,
  ].join(" "));
}));
