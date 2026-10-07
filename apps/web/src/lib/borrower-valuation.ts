// Display rows for one legal entity's historical valuation.
// Amounts, deltas, percentages, and ratios arrive already calculated.
// This module does not subtract, divide, or convert currency.

import { displayState, type ObservationRow } from "@/lib/borrowers";
import { CURRENCY_NOTE, secUrl } from "@/lib/portfolios";

export const VALUATION_DEFINITION = "valuation.position_history.v1";
export const VALUATION_HISTORY_NOTE =
  "Each row is one resolved position observation. Newest reported date first. A missing amount stays Unknown.";
export const DERIVED_NOTE =
  "A derived figure uses only stored inputs. A missing input stays Insufficient data. Currency is not converted.";
export const EMPTY_VALUATION =
  "Historical fair value for a resolved position is unavailable. An unresolved instrument is not included, and a matching borrower name is not a valuation comparison.";
export const OMITTED_UNRESOLVED =
  "Observations with an unresolved instrument or unresolved position continuity are omitted from this timeline.";
export const CROSS_BDC_UNAVAILABLE =
  "Cross-BDC valuation comparison is unavailable. It requires a resolved legal entity, a resolved instrument, established position continuity, comparable valuation observations, and compatible currency.";
export const EMPTY_DERIVED =
  "Derived valuation metrics are unavailable because the stored inputs are insufficient.";

const FORBIDDEN_KEY = /origination|fvr|exit|repay|score|rank|similarity|total|qoq|event_code/i;

export type ValuationRow = {
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
  instrument_type_evidence_level: string | null;
  fair_value_state: string;
  fair_value_raw: string | null;
  fair_value_numeric: string | null;
  fair_value_currency_state: string | null;
  fair_value_currency_code: string | null;
  principal_state: string;
  principal_raw: string | null;
  principal_numeric: string | null;
  principal_currency_state: string | null;
  principal_currency_code: string | null;
  cost_state: string;
  cost_raw: string | null;
  cost_numeric: string | null;
  cost_currency_state: string | null;
  cost_currency_code: string | null;
  observation_evidence_id: string | null;
  observation_evidence_level: string | null;
  earlier_reported_date: string | null;
  fair_value_change_state: string;
  fair_value_delta: string | null;
  fair_value_percentage_state: string;
  fair_value_percentage: string | null;
  fair_value_to_principal_state: string;
  fair_value_to_principal: string | null;
  fair_value_to_cost_state: string;
  fair_value_to_cost: string | null;
  cross_bdc_comparison_state: string;
  valuation_definition: string;
};

export type ValuationPoint = {
  id: string;
  reportedDate: string;
  registrantCik: string;
  instrument: string;
  instrumentState: string;
  continuityState: string;
  fairValue: string;
  fairValueCurrency: string | null;
  principal: string;
  principalCurrency: string | null;
  cost: string;
  costCurrency: string | null;
  fairValueChange: string;
  accessionNumber: string;
  documentUrl: string | null;
  evidenceLabel: string;
};

export type DerivedMetric = {
  key: string;
  text: string;
};

export type ValuationHistory = {
  timeline: ValuationPoint[];
  derived: DerivedMetric[];
  omittedUnresolved: boolean;
  crossBdc: string;
  definition: string;
};

export function assertValuationFields(row: object) {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`valuation field is not displayable: ${key}`);
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

function sufficiency(state: string, value: string | null): string {
  if (state === "COMPARABLE" && value != null && value.trim() !== "") return value;
  if (state === "UNAVAILABLE") return "Unavailable";
  if (state === "INSUFFICIENT_DATA") return "Insufficient data";
  if (state === "UNKNOWN") return "Unknown";
  if (state === "UNRESOLVED") return "Unresolved";
  return "Insufficient data";
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

function resolvedPosition(row: ValuationRow): boolean {
  return row.instrument_resolution_state === "MATCHED" && row.continuity_state === "MATCHED";
}

export function valuationHistory(
  rows: ValuationRow[],
  listings: ObservationRow[],
  legalEntityId: string,
): ValuationHistory {
  const documents = documentByAccession(listings, legalEntityId);
  const timeline: ValuationPoint[] = [];
  const derived: DerivedMetric[] = [];
  let omittedUnresolved = false;
  let definition = VALUATION_DEFINITION;
  for (const row of rows) {
    assertValuationFields(row);
    if (row.legal_entity_id !== legalEntityId || row.entity_resolution_state !== "MATCHED") continue;
    if (row.valuation_definition.trim() !== "") definition = row.valuation_definition;
    if (!resolvedPosition(row)) {
      omittedUnresolved = true;
      continue;
    }
    const linked = row.registrant_link_status === "LINKED" && Boolean(row.registrant_cik);
    const fairValue = observedValue(row.fair_value_state, row.fair_value_raw);
    const principal = observedValue(row.principal_state, row.principal_raw);
    const cost = observedValue(row.cost_state, row.cost_raw);
    const change = sufficiency(row.fair_value_change_state, row.fair_value_delta);
    timeline.push({
      id: row.position_observation_id,
      reportedDate: row.reported_date,
      registrantCik: linked && row.registrant_cik ? row.registrant_cik : "Unknown",
      instrument: observedValue(row.instrument_type_state, row.instrument_type_raw),
      instrumentState: displayState(row.instrument_resolution_state),
      continuityState: displayState(row.continuity_state),
      fairValue,
      fairValueCurrency: currencyLabel(fairValue, row.fair_value_currency_state, row.fair_value_currency_code),
      principal,
      principalCurrency: currencyLabel(principal, row.principal_currency_state, row.principal_currency_code),
      cost,
      costCurrency: currencyLabel(cost, row.cost_currency_state, row.cost_currency_code),
      fairValueChange: change,
      accessionNumber: row.accession_number,
      documentUrl: documents.get(row.accession_number) ?? null,
      evidenceLabel: evidenceLabel(row.observation_evidence_level),
    });
    const period = row.earlier_reported_date
      ? `${row.earlier_reported_date} to ${row.reported_date}`
      : row.reported_date;
    if (row.fair_value_change_state === "COMPARABLE" && row.fair_value_delta != null && row.fair_value_delta.trim() !== "") {
      derived.push({ key: `${row.position_observation_id}:change`, text: `${period}: Fair value change ${row.fair_value_delta}.` });
    }
    if (row.fair_value_percentage_state === "COMPARABLE" && row.fair_value_percentage != null && row.fair_value_percentage.trim() !== "") {
      derived.push({ key: `${row.position_observation_id}:percentage`, text: `${period}: Fair value percentage change ${row.fair_value_percentage}.` });
    }
    if (row.fair_value_to_principal_state === "COMPARABLE" && row.fair_value_to_principal != null && row.fair_value_to_principal.trim() !== "") {
      derived.push({ key: `${row.position_observation_id}:principal`, text: `${row.reported_date}: Fair value / principal ${row.fair_value_to_principal}.` });
    }
    if (row.fair_value_to_cost_state === "COMPARABLE" && row.fair_value_to_cost != null && row.fair_value_to_cost.trim() !== "") {
      derived.push({ key: `${row.position_observation_id}:cost`, text: `${row.reported_date}: Fair value / cost ${row.fair_value_to_cost}.` });
    }
  }
  return { timeline, derived, omittedUnresolved, crossBdc: "Unavailable", definition };
}
