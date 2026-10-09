// Display rows for one legal entity's confirmed position comparisons.
// Values and deltas come from registry.borrower_position_comparisons.
// This module does not subtract, divide, or classify a field change.

import type { AmountFieldTraceSide } from "@/lib/borrower-field-trace";
import type { ObservationRow } from "@/lib/borrowers";
import { CURRENCY_NOTE, secUrl } from "@/lib/portfolios";

export const COMPARISON_NOTE =
  "Observed changes between confirmed same-position observations across reporting periods. A matched observation is not itself a confirmed change. Changes are not classified as credit events.";
export const CONTINUITY_SCOPE_NOTE =
  "A matched legal-entity name is not a confirmed position. Confirmed changes require MATCHED position continuity between two observations, then a Comparable field comparison.";
export const EVIDENCE_REVIEW_NOTE =
  "Evidence & change review lists each stored amount with its reporting periods, SEC accession links, field-level trace when one current field head exists, currency status, and comparison state. A stored delta appears only when the comparison is Comparable.";
export const EMPTY_COMPARISONS =
  "Confirmed period-to-period changes are unavailable because no MATCHED position-continuity pair is stored for this legal entity. An unresolved continuity decision is not a confirmed change. A period with no stored observation is left absent.";
export const ACQUISITION_LABEL = "Acquisition date";
export const INSUFFICIENT = "Insufficient data";
export const CURRENCY_AMBIGUOUS_NOTE = "Currency Ambiguous";
export const COMPARABLE_CHANGE_NOTE =
  "Prior value, current value, and the stored delta are shown because the comparison state is Comparable.";
export const CHANGE_NOT_ESTABLISHED =
  "Change cannot be established from the available evidence. No stored delta is shown.";
export const CHANGE_NOT_ESTABLISHED_MISSING_AMOUNT =
  "Change cannot be established: a reported amount is missing on one or both periods. No stored delta is shown.";
export const CHANGE_NOT_ESTABLISHED_CURRENCY_UNKNOWN =
  "Change cannot be established: currency is unknown or ambiguous on one or both observations. No stored delta is shown.";
export const AMOUNT_REVIEW_LABELS = ["Principal", "Amortized cost", "Fair value"] as const;

const FORBIDDEN_KEY = /origination|fvr|ratio|exit|repay|score|rank|similarity|refinanc|deteriorat|default|non_accrual|credit/i;

export type PositionComparisonRow = {
  legal_entity_id: string;
  position_id: string;
  earlier_position_observation_id: string;
  later_position_observation_id: string;
  earlier_reported_date: string;
  later_reported_date: string;
  earlier_accession_number: string;
  later_accession_number: string;
  earlier_observation_evidence_id: string | null;
  later_observation_evidence_id: string | null;
  earlier_observation_evidence_level: string | null;
  later_observation_evidence_level: string | null;
  earlier_registrant_cik: string | null;
  earlier_registrant_link_status: string | null;
  later_registrant_cik: string | null;
  later_registrant_link_status: string | null;
  principal_comparison_state: string;
  earlier_principal_raw: string | null;
  later_principal_raw: string | null;
  principal_delta: string | null;
  earlier_principal_currency_state: string | null;
  later_principal_currency_state: string | null;
  cost_comparison_state: string;
  earlier_cost_raw: string | null;
  later_cost_raw: string | null;
  cost_delta: string | null;
  earlier_cost_currency_state: string | null;
  later_cost_currency_state: string | null;
  fair_value_comparison_state: string;
  earlier_fair_value_raw: string | null;
  later_fair_value_raw: string | null;
  fair_value_delta: string | null;
  earlier_fair_value_currency_state: string | null;
  later_fair_value_currency_state: string | null;
  maturity_comparison_state: string;
  maturity_changed: boolean | null;
  earlier_maturity_raw: string | null;
  later_maturity_raw: string | null;
  earlier_maturity_precision: string | null;
  later_maturity_precision: string | null;
  earlier_maturity_date: string | null;
  later_maturity_date: string | null;
  acquisition_comparison_state: string;
  earlier_acquisition_raw: string | null;
  later_acquisition_raw: string | null;
  earlier_acquisition_precision: string | null;
  later_acquisition_precision: string | null;
  earlier_acquisition_date: string | null;
  later_acquisition_date: string | null;
  interest_rate_comparison_state: string;
  earlier_interest_rate_raw: string | null;
  later_interest_rate_raw: string | null;
  interest_rate_delta: string | null;
  spread_comparison_state: string;
  earlier_spread_raw: string | null;
  later_spread_raw: string | null;
  spread_delta: string | null;
  interest_rate_floor_comparison_state: string;
  earlier_interest_rate_floor_raw: string | null;
  later_interest_rate_floor_raw: string | null;
  interest_rate_floor_delta: string | null;
};

export type ComparisonObservation = {
  observationId: string;
  reportedDate: string;
  accessionNumber: string;
  documentUrl: string | null;
  evidenceLabel: string;
  evidenceId: string;
  registrantCik: string;
};

export type ComparisonField = {
  label: string;
  earlier: string;
  later: string;
  earlierCurrency: string | null;
  laterCurrency: string | null;
  change: string;
  state: string;
  /** Explains whether a stored amount delta may be shown; never invents a numeric change. */
  reviewNote: string | null;
  /** Populated from obs.current_position_field_value when trace rows are loaded. */
  earlierTrace?: AmountFieldTraceSide;
  laterTrace?: AmountFieldTraceSide;
};

export type PositionComparison = {
  key: string;
  positionId: string;
  registrantCik: string;
  earlierDate: string;
  laterDate: string;
  earlier: ComparisonObservation;
  later: ComparisonObservation;
  fields: ComparisonField[];
};

export function assertComparisonFields(row: object) {
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`position comparison field is not displayable: ${key}`);
  }
}

function comparisonState(state: string): string {
  if (state === "COMPARABLE") return "Comparable";
  if (state === "INSUFFICIENT_DATA") return INSUFFICIENT;
  if (state === "UNKNOWN") return "Unknown";
  if (state === "UNRESOLVED") return "Unresolved";
  return state;
}

function storedText(value: string | null): string {
  if (value == null || value.trim() === "") return "Unknown";
  return value;
}

function datedText(raw: string | null, precision: string | null, dateText: string | null): string {
  if (precision === "MONTH") return storedText(raw);
  if (raw != null && raw.trim() !== "") return raw;
  return storedText(dateText);
}

function currencyUnresolved(currencyState: string | null): boolean {
  return currencyState == null || currencyState.trim() === "" || currencyState === "UNKNOWN" || currencyState === "AMBIGUOUS";
}

function currencyNote(value: string, currencyState: string | null): string | null {
  if (value === "Unknown") return null;
  if (currencyState === "AMBIGUOUS") return CURRENCY_AMBIGUOUS_NOTE;
  if (currencyUnresolved(currencyState)) return CURRENCY_NOTE;
  return null;
}

function amountReviewNote(
  state: string,
  earlier: string,
  later: string,
  earlierCurrencyState: string | null,
  laterCurrencyState: string | null,
): string {
  if (state === "COMPARABLE") return COMPARABLE_CHANGE_NOTE;
  if (earlier === "Unknown" || later === "Unknown") return CHANGE_NOT_ESTABLISHED_MISSING_AMOUNT;
  if (currencyUnresolved(earlierCurrencyState) || currencyUnresolved(laterCurrencyState)) {
    return CHANGE_NOT_ESTABLISHED_CURRENCY_UNKNOWN;
  }
  // ISO currency codes are not on this path; do not infer code incompatibility from INSUFFICIENT_DATA alone.
  return CHANGE_NOT_ESTABLISHED;
}

function evidenceLabel(level: string | null): string {
  if (level === "L2_ORIGINAL_FILING") return "Original EDGAR filing";
  if (level === "L1_STRUCTURED_DATASET") return "Structured SEC data set";
  return "Unknown";
}

function storedEvidenceId(value: string | null): string {
  if (value == null || value.trim() === "") return "Unknown";
  return value;
}

function sideRegistrant(cik: string | null, status: string | null): string {
  if (status === "LINKED" && cik != null && cik.trim() !== "") return cik;
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

function numericField(
  label: string,
  state: string,
  earlierRaw: string | null,
  laterRaw: string | null,
  delta: string | null,
  earlierCurrency: string | null,
  laterCurrency: string | null,
  moneyField: boolean,
): ComparisonField {
  const shown = comparisonState(state);
  const earlier = storedText(earlierRaw);
  const later = storedText(laterRaw);
  const reviewNote = moneyField
    ? amountReviewNote(state, earlier, later, earlierCurrency, laterCurrency)
    : state === "COMPARABLE"
      ? null
      : earlier === "Unknown" || later === "Unknown"
        ? CHANGE_NOT_ESTABLISHED_MISSING_AMOUNT
        : CHANGE_NOT_ESTABLISHED;
  if (state !== "COMPARABLE") {
    return {
      label,
      earlier,
      later,
      earlierCurrency: moneyField ? currencyNote(earlier, earlierCurrency) : null,
      laterCurrency: moneyField ? currencyNote(later, laterCurrency) : null,
      change: shown,
      state: shown,
      reviewNote,
    };
  }
  return {
    label,
    earlier,
    later,
    earlierCurrency: moneyField ? currencyNote(earlier, earlierCurrency) : null,
    laterCurrency: moneyField ? currencyNote(later, laterCurrency) : null,
    change: storedText(delta),
    state: shown,
    reviewNote,
  };
}

function maturityField(row: PositionComparisonRow): ComparisonField {
  const state = row.maturity_comparison_state;
  const earlier = datedText(row.earlier_maturity_raw, row.earlier_maturity_precision, row.earlier_maturity_date);
  const later = datedText(row.later_maturity_raw, row.later_maturity_precision, row.later_maturity_date);
  if (state !== "COMPARABLE") {
    return {
      label: "Maturity",
      earlier,
      later,
      earlierCurrency: null,
      laterCurrency: null,
      change: INSUFFICIENT,
      state: comparisonState(state),
      reviewNote: CHANGE_NOT_ESTABLISHED,
    };
  }
  const change = row.maturity_changed === true ? "Yes" : row.maturity_changed === false ? "No" : "Unknown";
  return {
    label: "Maturity",
    earlier,
    later,
    earlierCurrency: null,
    laterCurrency: null,
    change,
    state: "Comparable",
    reviewNote: null,
  };
}

function acquisitionField(row: PositionComparisonRow): ComparisonField {
  const state = row.acquisition_comparison_state;
  return {
    label: ACQUISITION_LABEL,
    earlier: datedText(row.earlier_acquisition_raw, row.earlier_acquisition_precision, row.earlier_acquisition_date),
    later: datedText(row.later_acquisition_raw, row.later_acquisition_precision, row.later_acquisition_date),
    earlierCurrency: null,
    laterCurrency: null,
    change: state === "COMPARABLE" ? "Comparable" : comparisonState(state),
    state: comparisonState(state),
    reviewNote: state === "COMPARABLE" ? null : CHANGE_NOT_ESTABLISHED,
  };
}

function sortCik(row: PositionComparisonRow): string {
  if (row.later_registrant_link_status === "LINKED" && row.later_registrant_cik) return row.later_registrant_cik;
  return "\uffff";
}

export function positionComparisons(
  rows: PositionComparisonRow[],
  listings: ObservationRow[],
  legalEntityId: string,
): PositionComparison[] {
  const documents = documentByAccession(listings, legalEntityId);
  const eligible = rows.filter((row) => {
    assertComparisonFields(row);
    return row.legal_entity_id === legalEntityId;
  });
  eligible.sort((a, b) =>
    b.later_reported_date.localeCompare(a.later_reported_date)
    || b.earlier_reported_date.localeCompare(a.earlier_reported_date)
    || sortCik(a).localeCompare(sortCik(b))
    || a.position_id.localeCompare(b.position_id)
    || a.earlier_position_observation_id.localeCompare(b.earlier_position_observation_id)
    || a.later_position_observation_id.localeCompare(b.later_position_observation_id));
  const comparisons: PositionComparison[] = [];
  for (const row of eligible) {
    const sharedRegistrant = sideRegistrant(row.later_registrant_cik, row.later_registrant_link_status);
    const earlierRegistrant = sideRegistrant(row.earlier_registrant_cik, row.earlier_registrant_link_status);
    comparisons.push({
      key: `${row.position_id}:${row.earlier_position_observation_id}:${row.later_position_observation_id}`,
      positionId: row.position_id,
      registrantCik: sharedRegistrant === earlierRegistrant ? sharedRegistrant : "Unknown",
      earlierDate: row.earlier_reported_date,
      laterDate: row.later_reported_date,
      earlier: {
        observationId: row.earlier_position_observation_id,
        reportedDate: row.earlier_reported_date,
        accessionNumber: row.earlier_accession_number,
        documentUrl: documents.get(row.earlier_accession_number) ?? null,
        evidenceLabel: evidenceLabel(row.earlier_observation_evidence_level),
        evidenceId: storedEvidenceId(row.earlier_observation_evidence_id),
        registrantCik: earlierRegistrant,
      },
      later: {
        observationId: row.later_position_observation_id,
        reportedDate: row.later_reported_date,
        accessionNumber: row.later_accession_number,
        documentUrl: documents.get(row.later_accession_number) ?? null,
        evidenceLabel: evidenceLabel(row.later_observation_evidence_level),
        evidenceId: storedEvidenceId(row.later_observation_evidence_id),
        registrantCik: sideRegistrant(row.later_registrant_cik, row.later_registrant_link_status),
      },
      fields: [
        numericField(
          "Principal",
          row.principal_comparison_state,
          row.earlier_principal_raw,
          row.later_principal_raw,
          row.principal_delta,
          row.earlier_principal_currency_state,
          row.later_principal_currency_state,
          true,
        ),
        numericField(
          "Amortized cost",
          row.cost_comparison_state,
          row.earlier_cost_raw,
          row.later_cost_raw,
          row.cost_delta,
          row.earlier_cost_currency_state,
          row.later_cost_currency_state,
          true,
        ),
        numericField(
          "Fair value",
          row.fair_value_comparison_state,
          row.earlier_fair_value_raw,
          row.later_fair_value_raw,
          row.fair_value_delta,
          row.earlier_fair_value_currency_state,
          row.later_fair_value_currency_state,
          true,
        ),
        maturityField(row),
        acquisitionField(row),
        numericField(
          "Interest rate",
          row.interest_rate_comparison_state,
          row.earlier_interest_rate_raw,
          row.later_interest_rate_raw,
          row.interest_rate_delta,
          null,
          null,
          false,
        ),
        numericField(
          "Spread",
          row.spread_comparison_state,
          row.earlier_spread_raw,
          row.later_spread_raw,
          row.spread_delta,
          null,
          null,
          false,
        ),
        numericField(
          "Interest-rate floor",
          row.interest_rate_floor_comparison_state,
          row.earlier_interest_rate_floor_raw,
          row.later_interest_rate_floor_raw,
          row.interest_rate_floor_delta,
          null,
          null,
          false,
        ),
      ],
    });
  }
  return comparisons;
}

export function amountReviewFields(comparison: PositionComparison): ComparisonField[] {
  return comparison.fields.filter((field) =>
    (AMOUNT_REVIEW_LABELS as readonly string[]).includes(field.label));
}
