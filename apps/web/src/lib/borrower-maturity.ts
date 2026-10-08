// Display rows for one legal entity's maturity wall.
// Dates, counts, and totals arrive already calculated. This module does not
// sum amounts, invent a calendar day, or classify a maturity change as a refinancing.

import { displayState, type ObservationRow } from "@/lib/borrowers";
import type { PositionComparison } from "@/lib/borrower-comparisons";
import { CURRENCY_NOTE, maturitySourceLabel, maturityValue, secUrl } from "@/lib/portfolios";

export const MATURITY_DEFINITION = "maturity.position_history.v1";
export const MATURITY_WALL_NOTE =
  "Each row is one stored maturity observation. A calendar day and a month stay in the precision that was stored. Unknown maturity is listed separately.";
export const EMPTY_MATURITY =
  "No resolved position with a stored maturity observation is linked to this legal entity.";
export const OMITTED_UNRESOLVED_MATURITY =
  "Observations with an unresolved instrument or unresolved position continuity are not placed in a maturity year. A matching borrower name is not a maturity.";
export const MATURITY_CHANGE_NOTE =
  "A comparable maturity change repeats the stored earlier and later maturity. It is not a refinancing.";
export const EMPTY_MATURITY_CHANGE =
  "No comparable maturity change is stored.";
export const REFINANCING_OUTCOME_NOTE =
  "A refinancing outcome is Unknown. A maturity change, a missing later observation, and an acquisition date are not a refinancing.";
export const YEAR_NOTE =
  "A year count is a count of stored observations. Principal and fair value are totaled only when every observation in that year has a reported amount and the same known currency. Unknown currency is not a total. A missing amount is not zero.";

const FORBIDDEN_KEY = /origination|fvr|exit|repay|score|rank|similarity|probability|qoq|event_code/i;

export type MaturityObservationRow = {
  legal_entity_id: string;
  position_observation_id: string;
  position_id: string | null;
  instrument_id: string | null;
  borrower_name_raw: string | null;
  reported_date: string;
  accession_number: string;
  registrant_cik: string | null;
  registrant_link_status: string | null;
  entity_resolution_state: string;
  instrument_resolution_state: string;
  continuity_state: string;
  instrument_type_state: string;
  instrument_type_raw: string | null;
  maturity_source: string;
  maturity_raw: string | null;
  maturity_date: string | null;
  maturity_precision: string | null;
  maturity_year: string | null;
  maturity_month: string | null;
  maturity_precision_class: string;
  maturity_bucket_year: string | null;
  maturity_observation_state: string;
  maturity_evidence_id: string | null;
  maturity_filing_verified: boolean;
  maturity_document_url: string | null;
  observation_evidence_level: string | null;
  principal_state: string;
  principal_raw: string | null;
  principal_numeric: string | null;
  principal_currency_state: string | null;
  principal_currency_code: string | null;
  fair_value_state: string;
  fair_value_raw: string | null;
  fair_value_numeric: string | null;
  fair_value_currency_state: string | null;
  fair_value_currency_code: string | null;
  refinancing_outcome_state: string;
  maturity_definition: string;
};

export type MaturitySummaryRow = {
  resolved_observation_count: string;
  known_maturity_count: string;
  unknown_maturity_count: string;
  unresolved_count: string;
  earliest_calendar_maturity: string | null;
  earliest_month_maturity: string | null;
  refinancing_outcome_state: string;
  maturity_definition: string;
};

export type MaturityYearRow = {
  maturity_year: string;
  maturity_precision_class: string;
  observation_count: string;
  principal_aggregation_state: string;
  principal_total: string | null;
  principal_currency_code: string | null;
  fair_value_aggregation_state: string;
  fair_value_total: string | null;
  fair_value_currency_code: string | null;
  maturity_definition: string;
};

export type MaturityWallPoint = {
  id: string;
  maturity: string;
  maturitySource: string | null;
  precision: string;
  registrantCik: string;
  instrument: string;
  instrumentState: string;
  continuityState: string;
  positionId: string;
  principal: string;
  principalCurrency: string | null;
  fairValue: string;
  fairValueCurrency: string | null;
  reportedDate: string;
  accessionNumber: string;
  documentUrl: string | null;
  evidenceLabel: string;
};

export type MaturityYearDisplay = {
  key: string;
  year: string;
  precision: string;
  count: string;
  principal: string;
  fairValue: string;
};

export type MaturityChangeLine = {
  key: string;
  text: string;
};

export function assertMaturityFields(row: unknown) {
  if (row == null || typeof row !== "object") throw new Error("maturity field is not displayable");
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`maturity field is not displayable: ${key}`);
  }
}

function observedValue(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  if (state === "NOT_APPLICABLE") return "Not applicable";
  return "Unknown";
}

function currencyLabel(value: string, currencyState: string | null, currencyCode: string | null): string | null {
  if (value === "Unknown" || value === "Not applicable" || value === "Multiple values") return null;
  if (currencyCode != null && /^[A-Z]{3}$/.test(currencyCode)) return currencyCode;
  if (currencyState == null || currencyState === "UNKNOWN" || currencyState.trim() === "") return CURRENCY_NOTE;
  return CURRENCY_NOTE;
}

function evidenceLabel(level: string | null): string {
  if (level === "L2_ORIGINAL_FILING") return "Original EDGAR filing";
  if (level === "L1_STRUCTURED_DATASET") return "Structured SEC data set";
  return "Unknown";
}

function precisionLabel(precisionClass: string): string {
  if (precisionClass === "DAY") return "Calendar day";
  if (precisionClass === "MONTH") return "Month";
  return "Unknown";
}

function aggregationText(state: string, total: string | null, currencyCode: string | null): string {
  if (state === "COMPARABLE" && total != null && total.trim() !== "") {
    return currencyCode != null && currencyCode.trim() !== "" ? `${total} ${currencyCode}` : total;
  }
  if (state === "INSUFFICIENT_DATA") return "Insufficient data";
  return "Unknown";
}

function documentByAccession(listings: ObservationRow[], legalEntityId: string): Map<string, string | null> {
  const docs = new Map<string, string | null>();
  for (const listing of listings) {
    if (listing.legal_entity_id !== legalEntityId) continue;
    const url = secUrl(listing.document_url);
    const current = docs.get(listing.accession_number);
    if (current === undefined) docs.set(listing.accession_number, url);
    else if (current !== url) docs.set(listing.accession_number, null);
  }
  return docs;
}

export function maturityWall(
  rows: MaturityObservationRow[],
  listings: ObservationRow[],
  legalEntityId: string,
): { points: MaturityWallPoint[]; omittedUnresolved: boolean; definition: string } {
  const documents = documentByAccession(listings, legalEntityId);
  const points: MaturityWallPoint[] = [];
  let omittedUnresolved = false;
  let definition = MATURITY_DEFINITION;
  for (const row of rows) {
    assertMaturityFields(row);
    if (row.legal_entity_id !== legalEntityId || row.entity_resolution_state !== "MATCHED") continue;
    if (row.maturity_definition.trim() !== "") definition = row.maturity_definition;
    if (row.instrument_resolution_state !== "MATCHED" || row.continuity_state !== "MATCHED") {
      omittedUnresolved = true;
      continue;
    }
    const linked = row.registrant_link_status === "LINKED" && Boolean(row.registrant_cik);
    const principal = observedValue(row.principal_state, row.principal_raw);
    const fairValue = observedValue(row.fair_value_state, row.fair_value_raw);
    const filingUrl = secUrl(row.maturity_document_url);
    points.push({
      id: row.position_observation_id,
      maturity: maturityValue(row.maturity_source, row.maturity_raw),
      maturitySource: maturitySourceLabel(row.maturity_source, row.maturity_filing_verified),
      precision: precisionLabel(row.maturity_precision_class),
      registrantCik: linked && row.registrant_cik ? row.registrant_cik : "Unknown",
      instrument: observedValue(row.instrument_type_state, row.instrument_type_raw),
      instrumentState: displayState(row.instrument_resolution_state),
      continuityState: displayState(row.continuity_state),
      positionId: row.position_id ?? "Unknown",
      principal,
      principalCurrency: currencyLabel(principal, row.principal_currency_state, row.principal_currency_code),
      fairValue,
      fairValueCurrency: currencyLabel(fairValue, row.fair_value_currency_state, row.fair_value_currency_code),
      reportedDate: row.reported_date,
      accessionNumber: row.accession_number,
      documentUrl: documents.get(row.accession_number) ?? filingUrl,
      evidenceLabel: evidenceLabel(row.observation_evidence_level),
    });
  }
  return { points, omittedUnresolved, definition };
}

export function maturityYears(rows: MaturityYearRow[]): MaturityYearDisplay[] {
  return rows.map((row) => {
    assertMaturityFields(row);
    return {
      key: `${row.maturity_year}:${row.maturity_precision_class}`,
      year: row.maturity_year,
      precision: precisionLabel(row.maturity_precision_class),
      count: `${row.observation_count} stored`,
      principal: aggregationText(row.principal_aggregation_state, row.principal_total, row.principal_currency_code),
      fairValue: aggregationText(row.fair_value_aggregation_state, row.fair_value_total, row.fair_value_currency_code),
    };
  });
}

export function maturityChangeLines(comparisons: PositionComparison[]): MaturityChangeLine[] {
  const lines: MaturityChangeLine[] = [];
  for (const comparison of comparisons) {
    const field = comparison.fields.find((item) => item.label === "Maturity");
    if (!field || field.state !== "Comparable" || field.change !== "Yes") continue;
    lines.push({
      key: comparison.key,
      text: `Maturity changed from ${field.earlier} to ${field.later}.`,
    });
  }
  return lines;
}

export function storedCount(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "Unknown";
  return `${value} stored`;
}

export function storedMaturityText(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "Unknown";
  return value;
}
