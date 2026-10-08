import { secUrl } from "@/lib/portfolios";

export const PERIOD_CHANGES_DEFINITION = "portfolio.period_changes.v1";
export const SELECT_EARLIER = "Select the earlier reporting period.";
export const SELECT_LATER = "Select the later reporting period.";
export const EMPTY_CHANGED = "No stored field change joins these two reporting periods.";
export const EMPTY_NEW = "No new position was observed in the later reporting period.";
export const EMPTY_EXIT = "No resolved position from the earlier reporting period is absent from the later reporting period.";
export const NEW_NOTE = "New position observed. An acquisition date is not an origination.";
export const EXIT_NOTE = "Position no longer observed in the subsequent reporting period. This is not a repayment and is not a refinancing.";
export const UNRESOLVED_PERIOD_NOTE = "An unresolved instrument or unresolved position is not compared. A borrower name is not an instrument.";
export const BOTH_PERIOD_NOTE = "A resolved position observed in both periods is listed as a field change only when a stored comparison joins these two dates.";
export const AMBIGUOUS_PERIOD_NOTE = "A reporting date with more than one matched observation of the same position is not compared.";

const CHANGE_TYPES = new Set([
  "EXISTING_POSITION_CHANGED",
  "NEW_POSITION_OBSERVED",
  "POSITION_NO_LONGER_OBSERVED",
]);

export type PeriodChangeRow = {
  change_type: string;
  registrant_cik: string;
  earlier_reported_date: string;
  later_reported_date: string;
  position_id: string | null;
  instrument_id: string | null;
  legal_entity_id: string | null;
  borrower_name_raw: string | null;
  holding_descriptor_raw: string | null;
  instrument_resolution_state: string;
  continuity_state: string;
  instrument_type_state: string;
  instrument_type_raw: string | null;
  principal_comparison_state: string | null;
  principal_delta: string | null;
  earlier_principal_raw: string | null;
  later_principal_raw: string | null;
  earlier_principal_currency_state: string | null;
  later_principal_currency_state: string | null;
  fair_value_comparison_state: string | null;
  fair_value_delta: string | null;
  earlier_fair_value_raw: string | null;
  later_fair_value_raw: string | null;
  earlier_fair_value_currency_state: string | null;
  later_fair_value_currency_state: string | null;
  cost_comparison_state: string | null;
  cost_delta: string | null;
  earlier_cost_raw: string | null;
  later_cost_raw: string | null;
  maturity_comparison_state: string | null;
  maturity_changed: boolean | null;
  earlier_maturity_raw: string | null;
  later_maturity_raw: string | null;
  earlier_accession_number: string | null;
  later_accession_number: string | null;
  earlier_document_url: string | null;
  later_document_url: string | null;
  earlier_position_observation_id: string | null;
  later_position_observation_id: string | null;
  changes_definition: string;
};

export type PeriodSummaryRow = {
  earlier_observation_count: string;
  later_observation_count: string;
  unresolved_count: string;
  observed_in_both_count: string;
  changed_count: string;
  new_count: string;
  no_longer_count: string;
  ambiguous_position_count: string;
  changes_definition: string;
};

export type PeriodChangeView = {
  key: string;
  borrower: string;
  instrument: string;
  instrumentType: string;
  fairValue: string;
  principal: string;
  cost: string;
  maturity: string;
  reportDate: string;
  accessionNumber: string;
  documentUrl: string | null;
};

export type PeriodSummaryView = {
  earlierObservations: string;
  laterObservations: string;
  unresolved: string;
  observedInBoth: string;
  changed: string;
  newPositions: string;
  noLonger: string;
  ambiguous: string;
};

function storedCount(value: string): string {
  return `${value} stored`;
}

function disclosed(raw: string | null): string {
  if (raw != null && raw.trim() !== "") return raw;
  return "Unknown";
}

function typed(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}

function amount(raw: string | null, currencyState: string | null): string {
  if (raw == null || raw.trim() === "") return "Unknown";
  if (currencyState === "AMBIGUOUS") return `${raw} · Currency ambiguous`;
  if (currencyState !== "FROM_FILING" && currencyState !== "FROM_NUM_UNIQUE_MATCH") return `${raw} · Currency Unknown`;
  return raw;
}

function delta(state: string | null, value: string | null): string {
  if (state === "COMPARABLE" && value != null && value.trim() !== "") return `stored change ${value}`;
  return "Insufficient data";
}

export function isPeriodChangeRow(item: unknown): item is PeriodChangeRow {
  if (item == null || typeof item !== "object") return false;
  const row = item as PeriodChangeRow;
  return CHANGE_TYPES.has(row.change_type)
    && typeof row.registrant_cik === "string"
    && typeof row.instrument_resolution_state === "string"
    && row.changes_definition === PERIOD_CHANGES_DEFINITION
    && (row.maturity_changed == null || typeof row.maturity_changed === "boolean");
}

export function isPeriodSummaryRow(item: unknown): item is PeriodSummaryRow {
  if (item == null || typeof item !== "object") return false;
  const row = item as PeriodSummaryRow;
  return typeof row.changed_count === "string"
    && typeof row.unresolved_count === "string"
    && row.changes_definition === PERIOD_CHANGES_DEFINITION;
}

export function periodSummary(row: PeriodSummaryRow): PeriodSummaryView {
  return {
    earlierObservations: storedCount(row.earlier_observation_count),
    laterObservations: storedCount(row.later_observation_count),
    unresolved: storedCount(row.unresolved_count),
    observedInBoth: storedCount(row.observed_in_both_count),
    changed: storedCount(row.changed_count),
    newPositions: storedCount(row.new_count),
    noLonger: storedCount(row.no_longer_count),
    ambiguous: storedCount(row.ambiguous_position_count),
  };
}

export function confirmedChange(row: PeriodChangeRow): PeriodChangeView {
  return {
    key: row.position_id ?? `${row.earlier_position_observation_id}-${row.later_position_observation_id}`,
    borrower: disclosed(row.borrower_name_raw),
    instrument: disclosed(row.holding_descriptor_raw),
    instrumentType: typed(row.instrument_type_state, row.instrument_type_raw),
    fairValue: delta(row.fair_value_comparison_state, row.fair_value_delta),
    principal: delta(row.principal_comparison_state, row.principal_delta),
    cost: delta(row.cost_comparison_state, row.cost_delta),
    maturity: row.maturity_changed === true && row.maturity_comparison_state === "COMPARABLE"
      ? `Maturity changed from ${row.earlier_maturity_raw ?? "Unknown"} to ${row.later_maturity_raw ?? "Unknown"}.`
      : "Insufficient data",
    reportDate: `${row.earlier_reported_date} to ${row.later_reported_date}`,
    accessionNumber: row.later_accession_number ?? row.earlier_accession_number ?? "Unknown",
    documentUrl: secUrl(row.later_document_url ?? row.earlier_document_url),
  };
}

export function newPosition(row: PeriodChangeRow): PeriodChangeView {
  return {
    key: row.later_position_observation_id ?? row.position_id ?? "new",
    borrower: disclosed(row.borrower_name_raw),
    instrument: disclosed(row.holding_descriptor_raw),
    instrumentType: typed(row.instrument_type_state, row.instrument_type_raw),
    fairValue: amount(row.later_fair_value_raw, row.later_fair_value_currency_state),
    principal: amount(row.later_principal_raw, row.later_principal_currency_state),
    cost: amount(row.later_cost_raw, null),
    maturity: disclosed(row.later_maturity_raw),
    reportDate: row.later_reported_date,
    accessionNumber: row.later_accession_number ?? "Unknown",
    documentUrl: secUrl(row.later_document_url),
  };
}

export function absentPosition(row: PeriodChangeRow): PeriodChangeView {
  return {
    key: row.earlier_position_observation_id ?? row.position_id ?? "absent",
    borrower: disclosed(row.borrower_name_raw),
    instrument: disclosed(row.holding_descriptor_raw),
    instrumentType: typed(row.instrument_type_state, row.instrument_type_raw),
    fairValue: amount(row.earlier_fair_value_raw, row.earlier_fair_value_currency_state),
    principal: amount(row.earlier_principal_raw, row.earlier_principal_currency_state),
    cost: amount(row.earlier_cost_raw, null),
    maturity: disclosed(row.earlier_maturity_raw),
    reportDate: row.earlier_reported_date,
    accessionNumber: row.earlier_accession_number ?? "Unknown",
    documentUrl: secUrl(row.earlier_document_url),
  };
}
