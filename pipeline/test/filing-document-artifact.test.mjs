import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../lib/store.mjs";
import { fetchStoredFilingDocument } from "../load/filing-document-artifact.mjs";

const URL = "https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm";
const HTML = Buffer.from("<html>TEST ONLY filing document</html>");

test("a stored Archives URL is fetched once and can be opened by checksum", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-fd-fetch-"));
  const seen = [];
  const client = {
    get: async (url) => {
      seen.push(url);
      return {
        status: 200, finalUrl: url, body: HTML,
        contentType: "text/html", lastModified: null, etag: null,
      };
    },
  };
  try {
    const first = await fetchStoredFilingDocument({
      documentUrl: URL, dataDir: dir, client, sessionId: "TEST-ONLY-FD", log: () => {},
    });
    const entry = first.entries_by_url[URL];
    assert.equal(first.requests, 1);
    assert.equal(entry.http_status, 200);
    assert.equal(entry.source_type, "SEC_FILING_DOCUMENT");
    const opened = createStore(dir).read(entry.storage_key, entry.sha256);
    assert.deepEqual(opened, HTML);

    const second = await fetchStoredFilingDocument({
      documentUrl: URL, dataDir: dir, client, sessionId: "TEST-ONLY-FD-B", log: () => {},
    });
    assert.equal(second.requests, 0);
    assert.equal(second.reused_from_log, 1);
    assert.equal(second.entries_by_url[URL].sha256, entry.sha256);
    assert.equal(seen.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing filing document stores no bytes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-fd-miss-"));
  const missing = "https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/missing-only.htm";
  const client = {
    get: async (url) => ({
      status: 404, finalUrl: url, body: Buffer.alloc(0),
      contentType: null, lastModified: null, etag: null,
    }),
  };
  try {
    const result = await fetchStoredFilingDocument({
      documentUrl: missing, dataDir: dir, client, sessionId: "TEST-ONLY-FD", log: () => {},
    });
    assert.equal(result.not_found, 1);
    assert.equal(result.stored, 0);
    assert.equal(result.entries_by_url[missing].sha256, null);
    assert.equal(result.entries_by_url[missing].storage_key, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-Archives URL is refused before any request", async () => {
  let called = false;
  await assert.rejects(
    () => fetchStoredFilingDocument({
      documentUrl: "https://www.sec.gov/files/TEST-ONLY/nope.zip",
      dataDir: path.join(tmpdir(), "bdc-fd-unused"),
      client: { get: async () => { called = true; throw new Error("must not fetch"); } },
      sessionId: "TEST-ONLY",
      log: () => {},
    }),
    /Archives filing-document URL/,
  );
  assert.equal(called, false);
});
