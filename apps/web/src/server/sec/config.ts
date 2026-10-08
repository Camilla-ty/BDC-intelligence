// SEC hosts and submissions URL rules from docs/SOURCE_SCHEMAS.md (S5, S9, 7.1).
// Same conventions as pipeline/lib/config.mjs; kept in the web package so Next.js
// does not import the pipeline tree.

export const ALLOWED_HOSTS = new Set(["www.sec.gov", "data.sec.gov"]);
export const MIN_INTERVAL_MS = 1100;
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_MS = [2000, 4000, 8000] as const;
export const STOP_STATUSES = new Set([403, 429]);
export const ACCEPT_ENCODING = "gzip, deflate";

export const SUBMISSIONS_BASE = "https://data.sec.gov/submissions/";
export const SUBMISSIONS_PAGE_NAME = /^CIK[0-9]{10}-submissions-[0-9]{3}\.json$/;
export const ARCHIVES_PREFIX = "https://www.sec.gov/Archives/edgar/data/";

export const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;

export const SUBMISSIONS_FILING_KEYS = [
  "accessionNumber",
  "filingDate",
  "reportDate",
  "acceptanceDateTime",
  "act",
  "form",
  "fileNumber",
  "filmNumber",
  "items",
  "core_type",
  "size",
  "isXBRL",
  "isInlineXBRL",
  "isXBRLNumeric",
  "primaryDocument",
  "primaryDocDescription",
] as const;

export const ARCC_CIK = "0001287750";
export const ARCC_NAME = "Ares Capital Corporation";
export const ARCC_TICKER = "ARCC";

export function padCik(cik: string): string {
  const s = String(cik);
  if (!/^[0-9]{1,10}$/.test(s)) throw new Error(`not a CIK: ${s}`);
  return s.padStart(10, "0");
}

export function submissionsUrl(cik: string): string {
  return `${SUBMISSIONS_BASE}CIK${padCik(cik)}.json`;
}

/** Observed URL rule (SOURCE_SCHEMAS 7.1). Names outside the pattern are not fetched. */
export function submissionsPageUrl(name: string): string | null {
  if (!SUBMISSIONS_PAGE_NAME.test(name)) return null;
  return `${SUBMISSIONS_BASE}${name}`;
}
