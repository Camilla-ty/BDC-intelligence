// Fetch stored registry.filing_document.document_url values only (P5-min).
// Never constructs SEC URLs. Reuses fetch-log entries for the same URL.

import { DEFAULT_DATA_DIR } from "./lib/config.mjs";
import { createFetchLog } from "./lib/fetch-log.mjs";
import { isAllowedUrl } from "./lib/http.mjs";
import { createStore } from "./lib/store.mjs";

const ARCHIVES_PREFIX = "https://www.sec.gov/Archives/edgar/data/";

export function assertFilingDocumentUrl(url) {
  if (typeof url !== "string" || !url.startsWith(ARCHIVES_PREFIX)) {
    throw new Error("P5-min: document_url is not a stored Archives filing-document URL");
  }
  if (!isAllowedUrl(url)) throw new Error(`P5-min: refused URL host: ${url}`);
}

export async function fetchGoldenFilingDocuments({
  dataDir = DEFAULT_DATA_DIR,
  client,
  sessionId,
  urls,
  log: logFn = console.log,
}) {
  if (!client) throw new Error("P5-min fetch requires an SEC client");
  if (!sessionId) throw new Error("P5-min fetch requires a session_id");
  const unique = [];
  const seen = new Set();
  for (const url of urls) {
    assertFilingDocumentUrl(url);
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }

  const store = createStore(dataDir);
  const fetchLog = createFetchLog(dataDir);
  const done = new Map(fetchLog.entries().map((e) => [e.url, e]));
  const counts = { requested: unique.length, requests: 0, reused_from_log: 0, stored: 0, not_found: 0 };

  for (let i = 0; i < unique.length; i += 1) {
    const url = unique[i];
    if (done.has(url)) {
      counts.reused_from_log += 1;
      continue;
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
    const entry = fetchLog.append({
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
      source_type: "SEC_FILING_DOCUMENT",
      context: { kind: "p5_golden_filing_document" },
    });
    done.set(url, entry);
    if ((i + 1) % 10 === 0 || i + 1 === unique.length) {
      logFn(JSON.stringify({
        progress: i + 1,
        of: unique.length,
        requests: counts.requests,
        reused_from_log: counts.reused_from_log,
        stored: counts.stored,
        not_found: counts.not_found,
      }));
    }
  }

  const entries_by_url = {};
  for (const url of unique) entries_by_url[url] = done.get(url);
  return { ...counts, entries_by_url };
}
