import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { readFetchLog } from "../lib/fetch-log.mjs";
import { fetchGoldenFilingDocuments } from "../p5-golden-fetch.mjs";

test("P5 fetch uses only supplied Archives URLs and records 404 without storing bytes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-p5-fetch-"));
  const ok = "https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/test-only.htm";
  const missing = "https://www.sec.gov/Archives/edgar/data/9999999901/000000000000000001/missing-only.htm";
  const seen = [];
  const client = {
    get: async (url) => {
      seen.push(url);
      if (url === ok) {
        return {
          status: 200, finalUrl: url, body: Buffer.from("<html>TEST ONLY 100</html>"),
          contentType: "text/html", lastModified: null, etag: null,
        };
      }
      return { status: 404, finalUrl: url, body: Buffer.alloc(0), contentType: null, lastModified: null, etag: null };
    },
  };
  try {
    const first = await fetchGoldenFilingDocuments({
      dataDir: dir, client, sessionId: "TEST-ONLY-P5", urls: [ok, missing, ok], log: () => {},
    });
    assert.equal(first.requested, 2);
    assert.equal(first.requests, 2);
    assert.equal(first.stored, 1);
    assert.equal(first.not_found, 1);
    assert.deepEqual(seen, [ok, missing]);
    assert.equal(first.entries_by_url[ok].http_status, 200);
    assert.equal(first.entries_by_url[ok].sha256 != null, true);
    assert.equal(first.entries_by_url[missing].http_status, 404);
    assert.equal(first.entries_by_url[missing].sha256, null);
    const { entries } = readFetchLog(dir);
    assert.equal(entries.every((e) => e.source_type === "SEC_FILING_DOCUMENT"), true);

    const second = await fetchGoldenFilingDocuments({
      dataDir: dir, client, sessionId: "TEST-ONLY-P5-B", urls: [ok, missing], log: () => {},
    });
    assert.equal(second.requests, 0);
    assert.equal(second.reused_from_log, 2);
    assert.equal(seen.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("P5 fetch refuses a URL that is not an Archives filing document", async () => {
  await assert.rejects(
    () => fetchGoldenFilingDocuments({
      dataDir: path.join(tmpdir(), "bdc-p5-unused"),
      client: { get: async () => { throw new Error("must not fetch"); } },
      sessionId: "TEST-ONLY",
      urls: ["https://www.sec.gov/files/TEST-ONLY/nope.zip"],
      log: () => {},
    }),
    /Archives filing-document URL/,
  );
});
