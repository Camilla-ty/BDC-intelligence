import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { BDC_REPORT_PAGE_URL, DATASETS_PAGE_URL } from "../lib/config.mjs";
import { readFetchLog } from "../lib/fetch-log.mjs";
import { runFetch } from "../fetch.mjs";
import { defaultSources } from "./synthetic.mjs";

test("fetch walks listing pages and submissions using a fake client, never the network", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "bdc-fetch-"));
  const sources = defaultSources();
  const bodies = new Map([
    [DATASETS_PAGE_URL, Buffer.from(sources.datasetsPage)],
    [BDC_REPORT_PAGE_URL, Buffer.from(sources.reportPage)],
    ["https://www.sec.gov/files/investment/data/other/business-development-company-report/TEST-ONLY-2026.csv", sources.csvLoaded],
    ["https://www.sec.gov/files/investment/data/other/business-development-company-report/TEST-ONLY-2019.csv", sources.csv2019],
    ["https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2099_12_bdc.zip", sources.zipFilled],
    ["https://www.sec.gov/files/datastandardsinnovation/data/business-development-company-bdc-data-sets/2099_11_bdc.zip", sources.zipEmpty],
    ["https://data.sec.gov/submissions/CIK9999999901.json", Buffer.from(sources.main1)],
    [`https://data.sec.gov/submissions/${sources.pageName}`, Buffer.from(sources.page1)],
    ["https://data.sec.gov/submissions/CIK9999999902.json", Buffer.from(sources.main2)],
  ]);
  const seen = [];
  const client = {
    get: async (url) => {
      seen.push(url);
      const body = bodies.get(url);
      if (!body) {
        return { status: 404, finalUrl: url, body: Buffer.alloc(0), contentType: null, lastModified: null, etag: null };
      }
      return {
        status: 200,
        finalUrl: url,
        body: Buffer.isBuffer(body) ? body : Buffer.from(body),
        contentType: "application/octet-stream",
        lastModified: null,
        etag: null,
      };
    },
  };
  try {
    const summary = await runFetch({ dataDir: dir, client, sessionId: "TEST-ONLY-SESSION", log: () => {} });
    assert.equal(summary.universe_ciks, 2);
    assert.equal(summary.dataset_zip_links, 2);
    assert.equal(summary.report_csv_links, 2);
    assert.equal(summary.page_names_not_matching_observed_rule, 0);
    assert.ok(seen.includes(`https://data.sec.gov/submissions/${sources.pageName}`));
    assert.equal(seen.some((u) => /0000000099/.test(u)), false);
    const { entries } = readFetchLog(dir);
    assert.equal(entries.filter((e) => e.http_status === 200).length, 9);
    const resumed = await runFetch({ dataDir: dir, client, sessionId: "TEST-ONLY-SESSION", log: () => {} });
    assert.equal(resumed.reused_in_session, 9);
    assert.equal(resumed.requests, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
