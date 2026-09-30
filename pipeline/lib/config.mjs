// Phase 2–3 pipeline constants. Every URL and host here is documented or observed in
// docs/SOURCE_SCHEMAS.md (sections 1, 2, 3.2, 6, 7, 7.1, 8).

import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Raw SEC bytes and the fetch log live only here (git-ignored). Tests pass their own directory.
export const DEFAULT_DATA_DIR = path.join(REPO_ROOT, ".data", "sec");
export const DEFAULT_DATABASE = "bdc_local";

export const ALLOWED_HOSTS = new Set(["www.sec.gov", "data.sec.gov"]);
export const MIN_INTERVAL_MS = 1100;
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_MS = [2000, 4000, 8000];
export const STOP_STATUSES = new Set([403, 429]);
export const ACCEPT_ENCODING = "gzip, deflate";

export const DATASETS_PAGE_URL = "https://www.sec.gov/data-research/sec-markets-data/bdc-data-sets";
export const BDC_REPORT_PAGE_URL = "https://www.sec.gov/data-research/sec-markets-data/opendatasetsshtmlbdc";

export const SUBMISSIONS_BASE = "https://data.sec.gov/submissions/";
export const SUBMISSIONS_PAGE_NAME = /^CIK[0-9]{10}-submissions-[0-9]{3}\.json$/;

export function padCik(cik) {
  const s = String(cik);
  if (!/^[0-9]{1,10}$/.test(s)) throw new Error(`not a CIK: ${s}`);
  return s.padStart(10, "0");
}

export function submissionsUrl(cik) {
  return `${SUBMISSIONS_BASE}CIK${padCik(cik)}.json`;
}

// Observed URL rule for additional pages (SOURCE_SCHEMAS 7.1): the directory of the main file
// plus the files[].name entry. Names outside the observed pattern are not fetched.
export function submissionsPageUrl(name) {
  if (!SUBMISSIONS_PAGE_NAME.test(name)) return null;
  return `${SUBMISSIONS_BASE}${name}`;
}

// Loaded BDC Report years (Phase 2 decision: 2020-2026; 2012-2019 layouts differ, section 6.1).
export const BDC_REPORT_LOADED_YEARS = { from: 2020, to: 2026 };

export const VERIFIED_BDC_REPORT_HEADER = Object.freeze([
  "File_No", "CIK", "Registrant_Name", "Address_1", "Address_2", "City", "State", "Zip_Code", "Filing Date", "Filing Type",
]);

// SUB header as documented (in-archive readme) plus the observed undocumented fileNumber at
// position 30 (SOURCE_SCHEMAS 4.1). Any other header is schema drift.
export const VERIFIED_SUB_HEADER = Object.freeze([
  "adsh", "cik", "name", "countryba", "stprba", "cityba", "zipba", "bas1", "bas2", "baph", "countryma", "stprma",
  "cityma", "zipma", "mas1", "mas2", "countryinc", "stprinc", "ein", "former", "changed", "afs", "wksi", "fye",
  "form", "period", "fy", "fp", "filed", "fileNumber", "accepted", "prevrpt", "detail", "instance", "pubfloatusd",
  "floatdate", "inlineurl",
]);

export const SUB_MEMBER_PATH = "datasets/sub.tsv";

// SOI member sits at the archive root, not under datasets/ (SOURCE_SCHEMAS 3.3).
export const SOI_MEMBER_PATH = "soi.tsv";

// Documented preset columns in documented order (SOURCE_SCHEMAS 5.1). Dynamic columns may
// follow; a header that does not start with this list is schema drift.
export const VERIFIED_SOI_PRESET_HEADER = Object.freeze([
  "adsh", "cik", "name", "ddate", "qtrs", "form", "filed", "period", "inlineurl", "cstm",
  "Industry Sector Axis", "Investment, Identifier Axis", "Investment, Issuer Affiliation Axis",
  "Investment Type Axis", "Investment Interest Rate", "Investment, Basis Spread, Variable Rate",
  "Investment Maturity Date", "Investment Owned, Balance, Principal Amount",
  "Investment Owned, Cost", "Investment Owned, Fair Value",
  "Investment Owned, Net Assets, Percentage",
]);

export const SUBMISSIONS_FILING_KEYS = Object.freeze([
  "accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "act", "form", "fileNumber", "filmNumber",
  "items", "core_type", "size", "isXBRL", "isInlineXBRL", "isXBRLNumeric", "primaryDocument", "primaryDocDescription",
]);
