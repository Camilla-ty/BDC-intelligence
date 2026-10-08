import { maturityValue, secUrl } from "@/lib/portfolios";

export const HOLDINGS_DEFINITION = "portfolio.holdings.v1";
export const EMPTY_HOLDINGS = "No stored positions were observed for this registrant on this reported date.";
export const EMPTY_CHANGES = "No confirmed comparison is stored for this reported date.";
export const CHANGE_NOTE = "A position that is not observed in a later period is not listed. Absence is not a repayment and is not a refinancing.";
export const PERIOD_NOTE = "Holdings are the positions observed for this registrant on this reported date. Another filing period is not included.";
export const TOTAL_NOTE = "A total is stored only when every holding on this date has a reported amount in the same known currency. A missing amount is not zero.";

const CURRENCY_CODE = /^[A-Z]{3}$/;

export type HoldingRow = {
  registrant_cik: string;
  reported_date: string;
  position_observation_id: string;
  position_id: string | null;
  borrower_name_raw: string | null;
  holding_descriptor_raw: string | null;
  instrument_id: string | null;
  instrument_resolution_state: string;
  continuity_state: string;
  instrument_type_state: string;
  instrument_type_raw: string | null;
  principal_state: string;
  principal_raw: string | null;
  principal_currency_state: string | null;
  principal_currency_code: string | null;
  cost_state: string;
  cost_raw: string | null;
  cost_currency_state: string | null;
  cost_currency_code: string | null;
  fair_value_state: string;
  fair_value_raw: string | null;
  fair_value_currency_state: string | null;
  fair_value_currency_code: string | null;
  maturity_source: string;
  maturity_raw: string | null;
  maturity_precision: string | null;
  accession_number: string;
  observation_evidence_level: string | null;
  document_url: string | null;
  holdings_definition: string;
};

export type SummaryRow = {
  observation_count: string;
  resolved_position_count: string;
  unresolved_count: string;
  known_principal_count: string;
  known_fair_value_count: string;
  known_maturity_count: string;
  unknown_currency_count: string;
  principal_aggregation_state: string;
  principal_total: string | null;
  principal_currency_code: string | null;
  fair_value_aggregation_state: string;
  fair_value_total: string | null;
  fair_value_currency_code: string | null;
  holdings_definition: string;
};

export type ChangeRow = {
  position_id: string;
  earlier_reported_date: string;
  later_reported_date: string;
  earlier_accession_number: string;
  later_accession_number: string;
  principal_comparison_state: string;
  earlier_principal_raw: string | null;
  later_principal_raw: string | null;
  principal_delta: string | null;
  fair_value_comparison_state: string;
  earlier_fair_value_raw: string | null;
  later_fair_value_raw: string | null;
  fair_value_delta: string | null;
  maturity_comparison_state: string;
  maturity_changed: boolean;
  earlier_maturity_raw: string | null;
  later_maturity_raw: string | null;
  holdings_definition: string;
};

export type HoldingView = {
  observationId: string;
  borrower: string;
  instrument: string;
  instrumentType: string;
  principal: string;
  cost: string;
  fairValue: string;
  maturity: string;
  resolution: string;
  accessionNumber: string;
  documentUrl: string | null;
};

export type SummaryView = {
  observations: string;
  resolved: string;
  unresolved: string;
  knownPrincipal: string;
  knownFairValue: string;
  knownMaturity: string;
  unknownCurrency: string;
  principalTotal: string;
  fairValueTotal: string;
};

export type ChangeView = {
  positionId: string;
  dates: string;
  principal: string;
  fairValue: string;
  maturity: string;
  accessions: string;
};

export function assertHoldingFields(row: object): void {
  const record = row as Record<string, unknown>;
  for (const key of ["score", "rank", "probability", "origination", "fvr"]) {
    if (key in record) throw new Error(`portfolio holding field ${key} is not defined`);
  }
}

export function isHoldingRow(item: unknown): item is HoldingRow {
  if (item == null || typeof item !== "object") return false;
  assertHoldingFields(item);
  const row = item as HoldingRow;
  return typeof row.position_observation_id === "string"
    && typeof row.registrant_cik === "string"
    && typeof row.accession_number === "string"
    && typeof row.instrument_resolution_state === "string"
    && typeof row.principal_state === "string"
    && typeof row.maturity_source === "string"
    && (row.observation_evidence_level == null || typeof row.observation_evidence_level === "string")
    && row.holdings_definition === HOLDINGS_DEFINITION;
}

export function isSummaryRow(item: unknown): item is SummaryRow {
  if (item == null || typeof item !== "object") return false;
  assertHoldingFields(item);
  const row = item as SummaryRow;
  return typeof row.observation_count === "string"
    && typeof row.principal_aggregation_state === "string"
    && row.holdings_definition === HOLDINGS_DEFINITION;
}

export function isChangeRow(item: unknown): item is ChangeRow {
  if (item == null || typeof item !== "object") return false;
  assertHoldingFields(item);
  const row = item as ChangeRow;
  return typeof row.position_id === "string"
    && typeof row.fair_value_comparison_state === "string"
    && typeof row.maturity_changed === "boolean"
    && row.holdings_definition === HOLDINGS_DEFINITION;
}

function storedCount(value: string): string {
  return `${value} stored`;
}

function disclosed(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}

export function moneyText(
  state: string,
  raw: string | null,
  currencyState: string | null,
  currencyCode: string | null,
): string {
  if (state !== "REPORTED" || raw == null || raw.trim() === "") {
    return state === "MULTIPLE_VALUES" ? "Multiple values" : "Unknown";
  }
  if (currencyState === "AMBIGUOUS") return `${raw} · Currency ambiguous`;
  if (currencyCode != null && CURRENCY_CODE.test(currencyCode) && currencyState !== "UNKNOWN") {
    return `${raw} · ${currencyCode}`;
  }
  return `${raw} · Currency Unknown`;
}

function resolutionText(instrument: string, continuity: string): string {
  if (instrument === "MATCHED" && continuity === "MATCHED") return "Matched";
  if (instrument === "REJECTED" || continuity === "REJECTED") return "Rejected";
  if (instrument === "PROBABLE" || continuity === "PROBABLE") return "Probable";
  return "Unresolved";
}

export function portfolioHolding(row: HoldingRow): HoldingView {
  return {
    observationId: row.position_observation_id,
    borrower: row.borrower_name_raw != null && row.borrower_name_raw.trim() !== "" ? row.borrower_name_raw : "Unknown",
    instrument: row.holding_descriptor_raw != null && row.holding_descriptor_raw.trim() !== ""
      ? row.holding_descriptor_raw
      : "Unknown",
    instrumentType: disclosed(row.instrument_type_state, row.instrument_type_raw),
    principal: moneyText(row.principal_state, row.principal_raw, row.principal_currency_state, row.principal_currency_code),
    cost: moneyText(row.cost_state, row.cost_raw, row.cost_currency_state, row.cost_currency_code),
    fairValue: moneyText(row.fair_value_state, row.fair_value_raw, row.fair_value_currency_state, row.fair_value_currency_code),
    maturity: maturityValue(row.maturity_source, row.maturity_raw),
    resolution: resolutionText(row.instrument_resolution_state, row.continuity_state),
    accessionNumber: row.accession_number,
    documentUrl: secUrl(row.document_url),
  };
}

function totalText(state: string, total: string | null, code: string | null): string {
  if (state === "COMPARABLE" && total != null && total.trim() !== "" && code != null && CURRENCY_CODE.test(code)) {
    return `${total} · ${code}`;
  }
  return "Insufficient data";
}

export function portfolioSummary(row: SummaryRow): SummaryView {
  return {
    observations: storedCount(row.observation_count),
    resolved: storedCount(row.resolved_position_count),
    unresolved: storedCount(row.unresolved_count),
    knownPrincipal: storedCount(row.known_principal_count),
    knownFairValue: storedCount(row.known_fair_value_count),
    knownMaturity: storedCount(row.known_maturity_count),
    unknownCurrency: storedCount(row.unknown_currency_count),
    principalTotal: totalText(row.principal_aggregation_state, row.principal_total, row.principal_currency_code),
    fairValueTotal: totalText(row.fair_value_aggregation_state, row.fair_value_total, row.fair_value_currency_code),
  };
}

function movement(state: string, earlier: string | null, later: string | null, delta: string | null): string {
  if (state === "COMPARABLE" && delta != null && delta.trim() !== "") {
    return `${earlier ?? "Unknown"} to ${later ?? "Unknown"}; stored change ${delta}`;
  }
  return "Insufficient data";
}

export function portfolioChange(row: ChangeRow): ChangeView {
  const maturity = row.maturity_changed && row.maturity_comparison_state === "COMPARABLE"
    ? `Maturity changed from ${row.earlier_maturity_raw ?? "Unknown"} to ${row.later_maturity_raw ?? "Unknown"}.`
    : "Insufficient data";
  return {
    positionId: row.position_id,
    dates: `${row.earlier_reported_date} to ${row.later_reported_date}`,
    principal: movement(row.principal_comparison_state, row.earlier_principal_raw, row.later_principal_raw, row.principal_delta),
    fairValue: movement(row.fair_value_comparison_state, row.earlier_fair_value_raw, row.later_fair_value_raw, row.fair_value_delta),
    maturity,
    accessions: `${row.earlier_accession_number} to ${row.later_accession_number}`,
  };
}

export function registrantName(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw != null && raw.trim() !== "") return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}
