// Maps maturity-wall rows into display models. No financial arithmetic.
// Year counts arrive from the database. A missing maturity stays Unknown.

import { displayState, secUrl, CURRENCY_NOTE, assertPortfolioFields } from "@/lib/portfolios";

export const WALL_NOTE =
  "A year count is the number of disclosed lines with one reported maturity date in that year.";
export const UNKNOWN_MATURITY_NOTE =
  "A disclosed line with no maturity date stays Unknown. It is omitted from the year counts, and it is not zero maturity.";
export const BOUNDARY_NOTE =
  "Borrower-level maturity, current holdings, instrument identity, a refinancing pipeline, and portfolio totals stay blocked.";
export const MULTIPLE_MATURITY_NOTE =
  "More than one maturity date on a line stays Multiple values. Those lines are not placed in a year.";

export type CoverageRow = {
  reported_date: string;
  disclosed_line_count: number;
  maturity_reported_count: number;
  maturity_unknown_count: number;
  maturity_multiple_count: number;
};

export type YearRow = {
  reported_date: string;
  maturity_year: number;
  disclosed_line_count: number;
};

export type MaturityLineRow = {
  position_observation_id: string;
  disclosed_line_text: string;
  principal_state: string;
  principal_raw: string | null;
  principal_currency_state: string;
  maturity_state: string;
  maturity_raw: string | null;
  maturity_year: number | null;
  accession_number: string;
  evidence_level: string;
  form_state: string;
  form_raw: string | null;
  filed_date_state: string;
  filed_date_raw: string | null;
  inline_url_state: string;
  inline_url: string | null;
  document_url: string | null;
  release_state: string;
  release_label: string | null;
};

export type MaturityDate = {
  reportedDate: string;
  disclosedLines: string;
  reportedMaturityLines: string;
  unknownMaturityLines: string;
  multipleMaturityLines: string;
};

export type MaturityYear = {
  reportedDate: string;
  maturityYear: string;
  disclosedLines: string;
};

export type MaturityLine = {
  id: string;
  disclosedLineText: string;
  principal: string;
  currency: string | null;
  maturity: string;
  accessionNumber: string;
  documentUrl: string | null;
  inlineUrl: string | null;
  form: string;
  filedDate: string;
  evidence: string;
  release: string;
};

function countLabel(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) return "Unknown";
  return String(n);
}

function reportedValue(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}

export function maturityDates(rows: CoverageRow[]): MaturityDate[] {
  return rows
    .map((row) => ({
      reportedDate: row.reported_date,
      disclosedLines: countLabel(row.disclosed_line_count),
      reportedMaturityLines: countLabel(row.maturity_reported_count),
      unknownMaturityLines: countLabel(row.maturity_unknown_count),
      multipleMaturityLines: countLabel(row.maturity_multiple_count),
    }))
    .sort((a, b) => a.reportedDate.localeCompare(b.reportedDate));
}

export function maturityYears(rows: YearRow[]): MaturityYear[] {
  return rows
    .map((row) => ({
      reportedDate: row.reported_date,
      maturityYear: countLabel(row.maturity_year),
      disclosedLines: countLabel(row.disclosed_line_count),
    }))
    .sort((a, b) => a.reportedDate.localeCompare(b.reportedDate) || Number(a.maturityYear) - Number(b.maturityYear));
}

export function maturityLine(row: MaturityLineRow): MaturityLine {
  assertPortfolioFields(row);
  const principalReported = row.principal_state === "REPORTED" && row.principal_raw != null && row.principal_raw.trim() !== "";
  return {
    id: row.position_observation_id,
    disclosedLineText: row.disclosed_line_text,
    principal: reportedValue(row.principal_state, row.principal_raw),
    currency: principalReported ? CURRENCY_NOTE : null,
    maturity: reportedValue(row.maturity_state, row.maturity_raw),
    accessionNumber: row.accession_number,
    documentUrl: secUrl(row.document_url),
    inlineUrl: row.inline_url_state === "REPORTED" ? secUrl(row.inline_url) : null,
    form: reportedValue(row.form_state, row.form_raw),
    filedDate: reportedValue(row.filed_date_state, row.filed_date_raw),
    evidence: row.evidence_level === "L1_STRUCTURED_DATASET" ? "Structured SEC data set" : displayState(row.evidence_level),
    release: reportedValue(row.release_state, row.release_label),
  };
}
