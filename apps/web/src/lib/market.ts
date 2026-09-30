// Maps market-coverage rows into display models. No financial arithmetic.
// A null coverage count stays Unavailable, Unknown, or No identified line. It is not zero.

import { displayState } from "@/lib/portfolios";
import { UNAVAILABLE_RELEASE, UNOBSERVED_DATE, UNOBSERVED_RELEASE } from "@/lib/states";

export const MISSING_DATE = UNOBSERVED_DATE;
export const MISSING_RELEASE = UNOBSERVED_RELEASE;
export const EMPTY_RELEASE = UNAVAILABLE_RELEASE;

export const COVERAGE_NOTE =
  "Each row is one registrant. Stored lines, a covered filing with no identified line, and unknown coverage stay separate. Unknown coverage is not zero exposure.";
export const RELEASE_NOTE =
  "Registrants observed is the number of registrants with stored lines in that release. A release that is unavailable has no count. A smaller count is a thinner extract, not a smaller market, and it does not record an exit.";
export const DATE_NOTE =
  "Registrants observed is co-presence on a stored reported date. A date that is not listed was not observed.";
export const LINE_NOTE =
  "Disclosed line count is the number of stored schedule-of-investments lines for that registrant and date. It is not a borrower count, a portfolio total, or a market total.";
export const CELL_NOTE =
  "A cell count is the number of disclosed lines with that stored cell. A line without the cell stays in the unknown count. The counts are not amounts, prices, or exposure.";
export const Q14_NOTE =
  "Adjusted cost basis and Initial fair value of Investment remain an open question. A cell count records that the labeled cell is stored. It is not cost or fair value.";
export const ABSENCE_NOTE =
  "A registrant that is not listed was not observed here. That absence is not zero exposure.";
export const BLOCKED_NOTE =
  "Market totals, market exposure, market distributions, cross-registrant amount comparisons, market-size trends, new or exited lines, and borrower counts are blocked.";
export const IDENTITY_NOTE = "Borrower identity and instrument identity are not resolved.";
export const SOURCE_NOTE = "SEC sources opens the disclosed lines and their filing links for that registrant and date.";
export const NO_IDENTIFIED_LINE = "No identified line";

const FORBIDDEN_KEY = /principal_raw|fair_value|spread|pik|interest_rate|normalized|borrower_count|instrument_id|legal_entity|amount|exposure|market_total/i;

export function assertMarketFields(row: object) {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`market field is not displayable: ${key}`);
  }
}

export type CoverageState =
  | "STORED_LINES"
  | "COVERED_NO_IDENTIFIED_LINE"
  | "UNKNOWN"
  | "OBSERVED"
  | "UNAVAILABLE";

export type RegistrantCoverageRow = {
  registrant_cik: string;
  name_state: string;
  name_raw: string | null;
  coverage_state: string;
};

export type ReleaseCoverageRow = {
  release_label: string;
  coverage_state: string;
  registrants_observed: number | null;
  reported_dates_observed: number | null;
};

export type DateCoverageRow = {
  reported_date: string;
  registrants_observed: number;
};

export type DateRegistrantRow = {
  registrant_cik: string;
  name_state: string;
  name_raw: string | null;
  disclosed_line_count: number;
  maturity_cell_line_count: number;
  maturity_unknown_line_count: number;
  principal_cell_line_count: number;
  principal_unknown_line_count: number;
  basis_cell_line_count: number;
  basis_unknown_line_count: number;
  initial_cell_line_count: number;
  initial_unknown_line_count: number;
};

export type ReleaseDateRow = {
  registrant_cik: string;
  name_state: string;
  name_raw: string | null;
  reported_date: string;
  disclosed_line_count: number;
};

export type RegistrantCoverage = {
  cik: string;
  name: string;
  state: string;
  href: string | null;
};

export type ReleaseCoverage = {
  label: string;
  state: string;
  registrants: string;
  reportedDates: string;
};

export type DateCoverage = {
  reportedDate: string;
  registrants: string;
};

export type DateRegistrant = {
  cik: string;
  name: string;
  disclosedLines: string;
  maturityCell: string;
  maturityUnknown: string;
  principalCell: string;
  principalUnknown: string;
  basisCell: string;
  basisUnknown: string;
  initialCell: string;
  initialUnknown: string;
  sourceHref: string;
};

export type ReleaseDate = {
  cik: string;
  name: string;
  reportedDate: string;
  disclosedLines: string;
  sourceHref: string;
};

function lineCount(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) return "Unknown";
  return String(n);
}

export function coverageCount(state: string, count: number | null): string {
  if (state === "UNAVAILABLE") return "Unavailable";
  if (state === "UNKNOWN") return "Unknown";
  if (state === "COVERED_NO_IDENTIFIED_LINE") return NO_IDENTIFIED_LINE;
  if (state === "OBSERVED" && Number.isSafeInteger(count) && count != null && count >= 0) return String(count);
  return "Unknown";
}

export function coverageLabel(state: string): string {
  if (state === "STORED_LINES") return "Stored lines";
  if (state === "COVERED_NO_IDENTIFIED_LINE") return "Covered, no identified line";
  if (state === "UNKNOWN") return "Unknown";
  if (state === "UNAVAILABLE") return "Unavailable";
  if (state === "OBSERVED") return "Observed";
  return "Unknown";
}

function registrantName(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  return displayState(state);
}

export function listRegistrantCoverage(rows: RegistrantCoverageRow[], query: string): RegistrantCoverage[] {
  const needle = query.trim().toLowerCase();
  const listed: RegistrantCoverage[] = [];
  for (const row of rows) {
    assertMarketFields(row);
    const name = registrantName(row.name_state, row.name_raw);
    const haystack = `${row.registrant_cik} ${row.name_state === "REPORTED" ? row.name_raw ?? "" : ""}`.toLowerCase();
    if (needle !== "" && !haystack.includes(needle)) continue;
    listed.push({
      cik: row.registrant_cik,
      name,
      state: coverageLabel(row.coverage_state),
      href: row.coverage_state === "STORED_LINES" ? `/portfolios/${row.registrant_cik}` : null,
    });
  }
  listed.sort((a, b) => a.cik.localeCompare(b.cik) || a.state.localeCompare(b.state));
  return listed;
}

export function listReleaseCoverage(rows: ReleaseCoverageRow[]): ReleaseCoverage[] {
  return rows
    .map((row) => {
      assertMarketFields(row);
      return {
        label: row.release_label,
        state: coverageLabel(row.coverage_state),
        registrants: coverageCount(row.coverage_state, row.registrants_observed),
        reportedDates: coverageCount(row.coverage_state, row.reported_dates_observed),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function listDateCoverage(rows: DateCoverageRow[]): DateCoverage[] {
  return rows
    .map((row) => {
      assertMarketFields(row);
      return {
        reportedDate: row.reported_date,
        registrants: lineCount(row.registrants_observed),
      };
    })
    .sort((a, b) => a.reportedDate.localeCompare(b.reportedDate));
}

export function listDateRegistrants(rows: DateRegistrantRow[], reportedDate: string): DateRegistrant[] {
  return rows
    .map((row) => {
      assertMarketFields(row);
      return {
        cik: row.registrant_cik,
        name: registrantName(row.name_state, row.name_raw),
        disclosedLines: lineCount(row.disclosed_line_count),
        maturityCell: lineCount(row.maturity_cell_line_count),
        maturityUnknown: lineCount(row.maturity_unknown_line_count),
        principalCell: lineCount(row.principal_cell_line_count),
        principalUnknown: lineCount(row.principal_unknown_line_count),
        basisCell: lineCount(row.basis_cell_line_count),
        basisUnknown: lineCount(row.basis_unknown_line_count),
        initialCell: lineCount(row.initial_cell_line_count),
        initialUnknown: lineCount(row.initial_unknown_line_count),
        sourceHref: `/portfolios/${row.registrant_cik}/lines?date=${reportedDate}`,
      };
    })
    .sort((a, b) => a.cik.localeCompare(b.cik));
}

export function listReleaseDates(rows: ReleaseDateRow[]): ReleaseDate[] {
  return rows
    .map((row) => {
      assertMarketFields(row);
      return {
        cik: row.registrant_cik,
        name: registrantName(row.name_state, row.name_raw),
        reportedDate: row.reported_date,
        disclosedLines: lineCount(row.disclosed_line_count),
        sourceHref: `/portfolios/${row.registrant_cik}/lines?date=${row.reported_date}`,
      };
    })
    .sort((a, b) => a.reportedDate.localeCompare(b.reportedDate) || a.cik.localeCompare(b.cik));
}
