// Display rows for one legal entity's historical outcomes.
// Event type, dates, and amounts arrive already stored. This module does not
// invent a refinancing, repayment, or exit. Migration 0051 emits only
// MATURITY_CHANGED with refinancing_outcome_state UNKNOWN.

import { displayState, type ObservationRow } from "@/lib/borrowers";
import { CURRENCY_NOTE, secUrl } from "@/lib/portfolios";

export const OUTCOME_DEFINITION = "refinancing.outcome_history.v1";
export const REFINANCING_NOTE =
  "A listed row repeats a stored comparable maturity change. A maturity change is not a refinancing. A period with no later observation is not a refinancing.";
export const EMPTY_REFINANCING =
  "No comparable maturity-change outcome is stored for this legal entity. An explicit refinancing is not supported by the available SEC evidence.";
export const MATURITY_CHANGED_NOTE =
  "A comparable maturity change repeats the stored earlier and later maturity. The refinancing outcome stays Unknown.";
export const OUTCOME_STATE_NOTE = "Refinancing outcome state is Unknown for every stored row.";

const FORBIDDEN_KEY = /origination|fvr|score|rank|similarity|probability|qoq/i;

export type RefinancingOutcomeRow = {
  legal_entity_id: string;
  position_id: string;
  instrument_id: string | null;
  instrument_resolution_state: string;
  continuity_state: string;
  instrument_type_state: string;
  instrument_type_raw: string | null;
  earlier_position_observation_id: string;
  later_position_observation_id: string;
  earlier_reported_date: string;
  later_reported_date: string;
  event_date: string | null;
  event_type: string;
  refinancing_outcome_state: string;
  earlier_maturity_raw: string | null;
  later_maturity_raw: string | null;
  earlier_maturity_precision: string | null;
  later_maturity_precision: string | null;
  earlier_principal_state: string;
  earlier_principal_raw: string | null;
  earlier_principal_currency_state: string | null;
  earlier_principal_currency_code: string | null;
  later_principal_state: string;
  later_principal_raw: string | null;
  later_principal_currency_state: string | null;
  later_principal_currency_code: string | null;
  earlier_accession_number: string;
  later_accession_number: string;
  earlier_observation_evidence_id: string | null;
  later_observation_evidence_id: string | null;
  earlier_observation_evidence_level: string | null;
  later_observation_evidence_level: string | null;
  registrant_cik: string | null;
  registrant_link_status: string | null;
  outcome_definition: string;
};

export type RefinancingDisplay = {
  key: string;
  statement: string;
  outcomeState: string;
  transactionDate: string;
  reportDates: string;
  instrument: string;
  instrumentState: string;
  continuityState: string;
  registrantCik: string;
  earlierMaturity: string;
  laterMaturity: string;
  earlierPrincipal: string;
  earlierPrincipalCurrency: string | null;
  laterPrincipal: string;
  laterPrincipalCurrency: string | null;
  earlierAccession: string;
  laterAccession: string;
  earlierUrl: string | null;
  laterUrl: string | null;
  evidenceLabel: string;
};

export function assertRefinancingFields(row: unknown) {
  if (row == null || typeof row !== "object") throw new Error("outcome field is not displayable");
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`outcome field is not displayable: ${key}`);
  }
}

function storedText(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "Unknown";
  return value;
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

export function refinancingOutcomes(
  rows: RefinancingOutcomeRow[],
  listings: ObservationRow[],
  legalEntityId: string,
): RefinancingDisplay[] {
  const documents = documentByAccession(listings, legalEntityId);
  const displays: RefinancingDisplay[] = [];
  for (const row of rows) {
    assertRefinancingFields(row);
    if (row.legal_entity_id !== legalEntityId) continue;
    // registry.borrower_refinancing_outcomes emits only MATURITY_CHANGED.
    if (row.event_type !== "MATURITY_CHANGED") continue;
    const linked = row.registrant_link_status === "LINKED" && Boolean(row.registrant_cik);
    const earlierPrincipal = observedValue(row.earlier_principal_state, row.earlier_principal_raw);
    const laterPrincipal = observedValue(row.later_principal_state, row.later_principal_raw);
    displays.push({
      key: `${row.position_id}:${row.earlier_position_observation_id}:${row.later_position_observation_id}:${row.event_type}`,
      statement: `Maturity changed from ${storedText(row.earlier_maturity_raw)} to ${storedText(row.later_maturity_raw)}.`,
      // Migration 0051 stores refinancing_outcome_state as UNKNOWN only.
      outcomeState: "Unknown",
      transactionDate: storedText(row.event_date),
      reportDates: `${row.earlier_reported_date} to ${row.later_reported_date}`,
      instrument: observedValue(row.instrument_type_state, row.instrument_type_raw),
      instrumentState: displayState(row.instrument_resolution_state),
      continuityState: displayState(row.continuity_state),
      registrantCik: linked && row.registrant_cik ? row.registrant_cik : "Unknown",
      earlierMaturity: storedText(row.earlier_maturity_raw),
      laterMaturity: storedText(row.later_maturity_raw),
      earlierPrincipal,
      earlierPrincipalCurrency: currencyLabel(earlierPrincipal, row.earlier_principal_currency_state, row.earlier_principal_currency_code),
      laterPrincipal,
      laterPrincipalCurrency: currencyLabel(laterPrincipal, row.later_principal_currency_state, row.later_principal_currency_code),
      earlierAccession: row.earlier_accession_number,
      laterAccession: row.later_accession_number,
      earlierUrl: documents.get(row.earlier_accession_number) ?? null,
      laterUrl: documents.get(row.later_accession_number) ?? null,
      evidenceLabel: evidenceLabel(row.later_observation_evidence_level),
    });
  }
  return displays;
}
