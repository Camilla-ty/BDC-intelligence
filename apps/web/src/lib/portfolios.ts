// Maps portfolio-listing rows into display models. No financial arithmetic.
// A missing principal or maturity stays Unknown. Line counts are disclosed rows, not amounts.

export const EDGAR_ARCHIVES_PREFIX = "https://www.sec.gov/Archives/edgar/data/";
export const EDGAR_VIEWER_PREFIX = "https://www.sec.gov/ix?doc=/Archives/edgar/data/";
export const PAGE_SIZE = 50;

export const DATE_NOTE = "A date that is not listed was not observed. It is not zero exposure.";
export const LINE_COUNT_NOTE =
  "Disclosed line count is the number of stored schedule-of-investments lines. It is not a borrower count, a portfolio total, or current holdings.";
export const LINE_TEXT_NOTE = "Disclosed line text is the stored identifier. It is not a resolved borrower or instrument.";
export const CURRENCY_NOTE = "Currency Unknown";
export const EMPTY_PERIOD_NOTE = "A release with no schedule-of-investments rows is unavailable, not a zero portfolio.";
export const VALUATION_NOTE = "Cost and fair value remain an open question and are not shown.";
export const RATE_NOTE = "Interest rate, spread, PIK rate, cash rate, floor, and percent of net assets stay unresolved and are not shown.";
export const BLOCKED_NOTE = "Current holdings, a unique portfolio, portfolio totals, borrower counts, and quarter-over-quarter changes are blocked.";
export const IDENTITY_NOTE = "Borrower identity and instrument identity are not resolved on these lines.";
export const SEARCH_NOTE = "Results match the CIK or the single reported name. A partial name is not a resolved entity.";
export const EMPTY_SEARCH = "No stored registrant matches this text.";
export const EMPTY_LIST = "No stored portfolio registrants are available.";
export const CIK_NOTE = "CIK identifies the filing registrant, not a portfolio borrower.";

export type RegistrantRow = {
  registrant_cik: string;
  name_state: string;
  name_raw: string | null;
  ticker_state: string;
  ticker_raw: string | null;
  file_number_state: string;
  file_number_raw: string | null;
  reported_date_count: number;
};

export type NameSourceRow = {
  source_type_code: string;
  raw_value: string;
  documentation_status: string | null;
};

export type DateRow = {
  reported_date: string;
  disclosed_line_count: number;
  point_in_time_line_count: number;
  duration_line_count: number;
};

export type LineRow = {
  position_observation_id: string;
  reported_date: string;
  duration_kind: string;
  period_role: string;
  disclosed_line_text: string;
  accession_number: string;
  evidence_level: string;
  principal_state: string;
  principal_raw: string | null;
  principal_currency_state: string;
  maturity_state: string;
  maturity_raw: string | null;
  instrument_type_state: string;
  instrument_type_raw: string | null;
  industry_state: string;
  industry_raw: string | null;
  affiliation_state: string;
  affiliation_raw: string | null;
  geography_state: string;
  geography_raw: string | null;
  acquisition_date_state: string;
  acquisition_date_raw: string | null;
  restricted_state: string;
  restricted_raw: string | null;
  reference_uri_state: string;
  reference_uri_raw: string | null;
  form_state: string;
  form_raw: string | null;
  filed_date_state: string;
  filed_date_raw: string | null;
  inline_url_state: string;
  inline_url: string | null;
  document_name: string | null;
  document_url: string | null;
  release_state: string;
  release_label: string | null;
};

export type PortfolioSummary = {
  cik: string;
  name: string;
  nameState: string;
  reportedDates: string;
};

export type ReportedDate = {
  reportedDate: string;
  disclosedLines: string;
  pointInTimeLines: string;
  durationLines: string;
};

export type AttributeDisplay = {
  label: string;
  text: string;
};

export type PortfolioLine = {
  id: string;
  disclosedLineText: string;
  duration: string;
  periodRole: string;
  principal: string;
  currency: string | null;
  maturity: string;
  attributes: AttributeDisplay[];
  accessionNumber: string;
  documentUrl: string | null;
  inlineUrl: string | null;
  form: string;
  filedDate: string;
  evidence: string;
  release: string;
};

const FORBIDDEN_KEY = /cost|fair|spread|pik|interest|total|borrower_count|instrument_id|legal_entity/i;

export function assertPortfolioFields(row: object) {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`portfolio field is not displayable: ${key}`);
  }
}

export function displayState(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "Unknown";
  if (value === "UNKNOWN") return "Unknown";
  if (value === "UNRESOLVED") return "Unresolved";
  if (value === "REPORTED") return "Reported";
  if (value === "MULTIPLE_VALUES") return "Multiple values";
  if (value === "LINKED") return "Linked";
  if (value === "BLOCKED") return "Blocked";
  return value;
}

function countLabel(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) return "Unknown";
  return String(n);
}

export function secUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  if (url.startsWith(EDGAR_ARCHIVES_PREFIX) || url.startsWith(EDGAR_VIEWER_PREFIX)) return url;
  return null;
}

function reportedValue(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}

export function listPortfolios(rows: RegistrantRow[], query: string): PortfolioSummary[] {
  for (const row of rows) assertPortfolioFields(row);
  const needle = query.trim().toLowerCase();
  const summaries: PortfolioSummary[] = [];
  for (const row of rows) {
    const name = row.name_state === "REPORTED" && row.name_raw ? row.name_raw : displayState(row.name_state);
    const haystack = `${row.registrant_cik} ${row.name_state === "REPORTED" ? row.name_raw ?? "" : ""}`.toLowerCase();
    if (needle !== "" && !haystack.includes(needle)) continue;
    summaries.push({
      cik: row.registrant_cik,
      name,
      nameState: displayState(row.name_state),
      reportedDates: countLabel(row.reported_date_count),
    });
  }
  summaries.sort((a, b) => a.cik.localeCompare(b.cik));
  return summaries;
}

export function reportedDates(rows: DateRow[]): ReportedDate[] {
  return rows
    .map((row) => ({
      reportedDate: row.reported_date,
      disclosedLines: countLabel(row.disclosed_line_count),
      pointInTimeLines: countLabel(row.point_in_time_line_count),
      durationLines: countLabel(row.duration_line_count),
    }))
    .sort((a, b) => a.reportedDate.localeCompare(b.reportedDate));
}

function durationLabel(kind: string): string {
  if (kind === "POINT_IN_TIME") return "Point in time";
  if (kind === "DURATION") return "Duration";
  return "Unknown";
}

function attribute(label: string, state: string, raw: string | null): AttributeDisplay {
  return { label, text: reportedValue(state, raw) };
}

export function portfolioLine(row: LineRow): PortfolioLine {
  assertPortfolioFields(row);
  const principalReported = row.principal_state === "REPORTED" && row.principal_raw != null && row.principal_raw.trim() !== "";
  return {
    id: row.position_observation_id,
    disclosedLineText: row.disclosed_line_text,
    duration: durationLabel(row.duration_kind),
    periodRole: displayState(row.period_role),
    principal: reportedValue(row.principal_state, row.principal_raw),
    currency: principalReported ? CURRENCY_NOTE : null,
    maturity: reportedValue(row.maturity_state, row.maturity_raw),
    attributes: [
      attribute("Instrument type", row.instrument_type_state, row.instrument_type_raw),
      attribute("Industry", row.industry_state, row.industry_raw),
      attribute("Issuer affiliation", row.affiliation_state, row.affiliation_raw),
      attribute("Geography", row.geography_state, row.geography_raw),
      attribute("Acquisition date", row.acquisition_date_state, row.acquisition_date_raw),
      attribute("Restricted", row.restricted_state, row.restricted_raw),
      attribute("Reference URI", row.reference_uri_state, row.reference_uri_raw),
    ],
    accessionNumber: row.accession_number,
    documentUrl: secUrl(row.document_url),
    inlineUrl: row.inline_url_state === "REPORTED" ? secUrl(row.inline_url) : null,
    form: reportedValue(row.form_state, row.form_raw),
    filedDate: reportedValue(row.filed_date_state, row.filed_date_raw),
    evidence: row.evidence_level === "L1_STRUCTURED_DATASET" ? "Structured SEC data set" : displayState(row.evidence_level),
    release: reportedValue(row.release_state, row.release_label),
  };
}

export function pageWindow(page: number, lineCount: number): {
  page: number;
  start: number;
  end: number;
  pastEnd: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
} {
  const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const start = (safePage - 1) * PAGE_SIZE;
  const pastEnd = lineCount > 0 && start >= lineCount;
  const end = pastEnd ? start : Math.min(start + PAGE_SIZE, lineCount);
  return {
    page: safePage,
    start,
    end,
    pastEnd,
    hasPrevious: safePage > 1 && !pastEnd,
    hasNext: !pastEnd && end < lineCount,
  };
}
