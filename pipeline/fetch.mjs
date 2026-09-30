#!/usr/bin/env node
// registry:fetch - downloads the Phase 2 sources into the git-ignored content-addressed store and
// appends one fetch-log entry per retrieval. Needs the network and SEC_USER_AGENT; never run in CI.
// Loading is separate (registry:load) and works offline from the store and the log.
//
//   npm run registry:fetch [-- --resume SESSION_ID] [-- --limit-ciks N] [-- --no-submissions]
//
// Order: Data Sets page, BDC Report page, every listed BDC Report CSV, every listed data set ZIP,
// then the submissions file of every CIK in the universe (BDC Report 2020-2026 CIKs plus all SUB
// CIKs) and each additional page named in its filings.files[].

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BDC_REPORT_LOADED_YEARS, BDC_REPORT_PAGE_URL, DATASETS_PAGE_URL, DEFAULT_DATA_DIR, SUB_MEMBER_PATH,
  submissionsPageUrl, submissionsUrl,
} from "./lib/config.mjs";
import { createFetchLog } from "./lib/fetch-log.mjs";
import { FairAccessStop, createSecClient, requireUserAgent } from "./lib/http.mjs";
import { createStore } from "./lib/store.mjs";
import { parseBdcReportCsv } from "./parse/bdc-report-csv.mjs";
import { parseBdcReportPage, parseDatasetsPage } from "./parse/pages.mjs";
import { parseSubTsv } from "./parse/sub.mjs";
import { inspectSubmissionsMain } from "./parse/submissions.mjs";
import { listMembers, readMember } from "./parse/zip.mjs";

export async function runFetch({ dataDir, client, sessionId, limitCiks = null, submissions = true, log: logFn = console.log }) {
  mkdirSync(dataDir, { recursive: true });
  const store = createStore(dataDir);
  const log = createFetchLog(dataDir);
  const done = new Map(log.entries().filter((e) => e.session_id === sessionId).map((e) => [e.url, e]));
  const counts = { requests: 0, reused_in_session: 0, stored: 0, not_found: 0 };

  async function fetchOne(url, sourceType, context) {
    if (done.has(url)) {
      counts.reused_in_session += 1;
      return done.get(url);
    }
    const requestedAt = new Date().toISOString();
    const r = await client.get(url);
    counts.requests += 1;
    let stored = null;
    if (r.status >= 200 && r.status <= 299) {
      stored = store.put(r.body);
      counts.stored += 1;
    } else {
      counts.not_found += 1;
    }
    const entry = log.append({
      session_id: sessionId,
      requested_at: requestedAt,
      url,
      final_url: r.finalUrl,
      http_status: r.status,
      content_type: r.contentType,
      last_modified: r.lastModified,
      etag: r.etag,
      byte_size: stored?.byteSize ?? null,
      sha256: stored?.sha256 ?? null,
      storage_key: stored?.storageKey ?? null,
      source_type: sourceType,
      context,
    });
    done.set(url, entry);
    return entry;
  }

  const bodyOf = (entry) => store.read(entry.storage_key, entry.sha256);
  const require200 = (entry, what) => {
    if (entry.http_status !== 200) throw new Error(`${what} returned HTTP ${entry.http_status}`);
    return entry;
  };

  const datasetsPage = require200(await fetchOne(DATASETS_PAGE_URL, "SEC_BDC_DATASETS_PAGE", { kind: "datasets_page" }), "Data Sets page");
  const reportPage = require200(await fetchOne(BDC_REPORT_PAGE_URL, "SEC_BDC_REPORT_PAGE", { kind: "bdc_report_page" }), "BDC Report page");

  const reportLinks = parseBdcReportPage(bodyOf(reportPage).toString("utf8")).links;
  const universe = new Set();
  for (const link of reportLinks) {
    const entry = await fetchOne(link.url, "SEC_BDC_REPORT_CSV", { kind: "bdc_report_csv", page_seq: reportPage.seq, year_label: link.yearLabel });
    if (entry.http_status !== 200) continue;
    const inRange = link.reportYear !== null
      && link.reportYear >= BDC_REPORT_LOADED_YEARS.from && link.reportYear <= BDC_REPORT_LOADED_YEARS.to;
    const parsed = parseBdcReportCsv(bodyOf(entry));
    if (inRange && parsed.headerMatches) {
      for (const row of parsed.rows) if (/^[0-9]{10}$/.test(row.cells[1])) universe.add(Number(row.cells[1]));
    }
  }

  const zipLinks = parseDatasetsPage(bodyOf(datasetsPage).toString("utf8")).links;
  for (const link of zipLinks) {
    const entry = await fetchOne(`https://www.sec.gov${link.href}`, "SEC_BDC_DATASET_ZIP", { kind: "dataset_zip", page_seq: datasetsPage.seq, release_label: link.label });
    if (entry.http_status !== 200) continue;
    const zipPath = store.pathFor(entry.storage_key);
    if (!listMembers(zipPath).includes(SUB_MEMBER_PATH)) continue;
    const sub = parseSubTsv(readMember(zipPath, SUB_MEMBER_PATH));
    if (!sub.headerMatches) continue;
    for (const row of sub.rows) {
      const cik = row.raw.split("\t")[1];
      if (/^[0-9]{1,10}$/.test(cik)) universe.add(Number(cik));
    }
  }

  const ciks = [...universe].sort((a, b) => a - b);
  const selected = limitCiks === null ? ciks : ciks.slice(0, limitCiks);
  let pageNamesSkipped = 0;
  if (submissions) {
    for (const cik of selected) {
      const main = await fetchOne(submissionsUrl(cik), "SEC_SUBMISSIONS_JSON", { kind: "submissions", cik });
      if (main.http_status !== 200) continue;
      const inspected = inspectSubmissionsMain(bodyOf(main), cik);
      for (const file of inspected.files) {
        const url = submissionsPageUrl(file.name);
        if (!url) {
          pageNamesSkipped += 1;
          continue;
        }
        await fetchOne(url, "SEC_SUBMISSIONS_PAGE_JSON", { kind: "submissions_page", cik, parent_seq: main.seq, name: file.name });
      }
    }
  }

  const summary = {
    session_id: sessionId,
    ...counts,
    report_csv_links: reportLinks.length,
    dataset_zip_links: zipLinks.length,
    universe_ciks: ciks.length,
    submissions_ciks_selected: submissions ? selected.length : 0,
    page_names_not_matching_observed_rule: pageNamesSkipped,
  };
  logFn(`registry:fetch: ${JSON.stringify(summary)}`);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  try {
    const userAgent = requireUserAgent();
    const sessionId = opt("--resume") ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
    await runFetch({
      dataDir: opt("--data-dir") ?? DEFAULT_DATA_DIR,
      client: createSecClient({ userAgent }),
      sessionId,
      limitCiks: opt("--limit-ciks") === null ? null : Number(opt("--limit-ciks")),
      submissions: !args.includes("--no-submissions"),
    });
  } catch (error) {
    console.error(`registry:fetch stopped: ${error.message}`);
    if (error instanceof FairAccessStop) console.error("Wait before retrying; resume with --resume <session id> to skip completed URLs.");
    process.exit(1);
  }
}
