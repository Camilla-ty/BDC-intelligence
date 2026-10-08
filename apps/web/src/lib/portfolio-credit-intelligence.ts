// Portfolio Credit Intelligence v1.
// Pure typed chronology over PeriodChangeRow[] from loadPortfolioPeriodChanges.
// Observed facts only: not origination, repayment, refinancing, or credit quality.

import { storedDeltaSign } from "@/lib/borrower-activity";
import type { PeriodChangeRow } from "@/lib/portfolio-changes";

export const PORTFOLIO_CREDIT_DEFINITION = "portfolio.credit_intelligence.v1";
export const PORTFOLIO_CREDIT_NOTE =
  "Each row is an observed comparison fact between two selected reporting periods of one registrant. A report date is not a transaction date. Field changes are stored comparisons, not credit conclusions. A maturity change is not a refinancing. A new observation is not an origination. A position no longer observed is not a repayment.";
export const EMPTY_PORTFOLIO_CREDIT =
  "No typed credit-intelligence event is available for these two reporting periods.";
export const NEW_POSITION_OBSERVED_NOTE =
  "New position observed. An acquisition date is not an origination.";
export const NO_LONGER_OBSERVED_NOTE =
  "Position no longer observed in the subsequent reporting period. This is not a repayment and is not a refinancing.";

export const LEGAL_ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PORTFOLIO_CREDIT_EVENT_TYPES = [
  "POSITION_CHANGED",
  "VALUATION_CHANGED",
  "MATURITY_CHANGED",
  "NEW_POSITION_OBSERVED",
  "POSITION_NO_LONGER_OBSERVED",
] as const;

export type PortfolioCreditEventType = (typeof PORTFOLIO_CREDIT_EVENT_TYPES)[number];

export type ChangedPortfolioField = "principal" | "cost";

export type PortfolioNumericChange = {
  field: ChangedPortfolioField;
  comparison_state: string;
  earlier_raw: string | null;
  later_raw: string | null;
  delta: string;
  earlier_currency_state?: string | null;
  later_currency_state?: string | null;
};

export type PositionChangedPayload = {
  changed_fields: ChangedPortfolioField[];
  changes: PortfolioNumericChange[];
};

export type ValuationChangedPayload = {
  fair_value_comparison_state: string;
  earlier_fair_value_raw: string | null;
  later_fair_value_raw: string | null;
  fair_value_delta: string;
  earlier_fair_value_currency_state: string | null;
  later_fair_value_currency_state: string | null;
};

export type MaturityChangedPayload = {
  maturity_comparison_state: string;
  maturity_changed: true;
  earlier_maturity_raw: string | null;
  later_maturity_raw: string | null;
};

export type NewPositionObservedPayload = {
  later_principal_raw: string | null;
  later_fair_value_raw: string | null;
  later_maturity_raw: string | null;
  note: typeof NEW_POSITION_OBSERVED_NOTE;
};

export type NoLongerObservedPayload = {
  earlier_principal_raw: string | null;
  earlier_fair_value_raw: string | null;
  earlier_maturity_raw: string | null;
  note: typeof NO_LONGER_OBSERVED_NOTE;
};

export type PortfolioCreditPayload =
  | PositionChangedPayload
  | ValuationChangedPayload
  | MaturityChangedPayload
  | NewPositionObservedPayload
  | NoLongerObservedPayload;

export type PortfolioCreditEvent = {
  key: string;
  event_type: PortfolioCreditEventType;
  report_date: string;
  earlier_reported_date: string;
  later_reported_date: string;
  registrant_cik: string;
  legal_entity_id: string | null;
  borrower_name_raw: string | null;
  position_id: string | null;
  instrument_id: string | null;
  instrument_type_state: string;
  instrument_type_raw: string | null;
  holding_descriptor_raw: string | null;
  instrument_resolution_state: string;
  continuity_state: string;
  earlier_position_observation_id: string | null;
  later_position_observation_id: string | null;
  earlier_accession_number: string | null;
  later_accession_number: string | null;
  earlier_document_url: string | null;
  later_document_url: string | null;
  payload: PortfolioCreditPayload;
  timeline_definition: string;
};

const EVENT_TYPE_ORDER: Record<PortfolioCreditEventType, number> = {
  POSITION_CHANGED: 0,
  VALUATION_CHANGED: 1,
  MATURITY_CHANGED: 2,
  NEW_POSITION_OBSERVED: 3,
  POSITION_NO_LONGER_OBSERVED: 4,
};

function isNonZeroNumericDelta(delta: string | null): boolean {
  if (delta == null || delta.trim() === "") return false;
  const sign = storedDeltaSign(delta);
  return sign === "higher" || sign === "lower";
}

function sortNullsLast(value: string | null): string {
  return value == null || value.trim() === "" ? "\uffff" : value;
}

function sortName(value: string | null): string {
  return value == null ? "" : value;
}

function observationSortId(event: PortfolioCreditEvent): string {
  if (event.event_type === "POSITION_NO_LONGER_OBSERVED") {
    return event.earlier_position_observation_id ?? "";
  }
  return event.later_position_observation_id ?? event.earlier_position_observation_id ?? "";
}

function compareEvents(a: PortfolioCreditEvent, b: PortfolioCreditEvent): number {
  return (
    b.report_date.localeCompare(a.report_date)
    || EVENT_TYPE_ORDER[a.event_type] - EVENT_TYPE_ORDER[b.event_type]
    || sortName(a.borrower_name_raw).localeCompare(sortName(b.borrower_name_raw))
    || sortNullsLast(a.position_id).localeCompare(sortNullsLast(b.position_id))
    || observationSortId(a).localeCompare(observationSortId(b))
    || a.key.localeCompare(b.key)
  );
}

function baseFromRow(row: PeriodChangeRow): Omit<PortfolioCreditEvent, "key" | "event_type" | "report_date" | "payload"> {
  return {
    earlier_reported_date: row.earlier_reported_date,
    later_reported_date: row.later_reported_date,
    registrant_cik: row.registrant_cik,
    legal_entity_id: row.legal_entity_id,
    borrower_name_raw: row.borrower_name_raw,
    position_id: row.position_id,
    instrument_id: row.instrument_id,
    instrument_type_state: row.instrument_type_state,
    instrument_type_raw: row.instrument_type_raw,
    holding_descriptor_raw: row.holding_descriptor_raw,
    instrument_resolution_state: row.instrument_resolution_state,
    continuity_state: row.continuity_state,
    earlier_position_observation_id: row.earlier_position_observation_id,
    later_position_observation_id: row.later_position_observation_id,
    earlier_accession_number: row.earlier_accession_number,
    later_accession_number: row.later_accession_number,
    earlier_document_url: row.earlier_document_url,
    later_document_url: row.later_document_url,
    timeline_definition: PORTFOLIO_CREDIT_DEFINITION,
  };
}

function existingEvents(row: PeriodChangeRow): PortfolioCreditEvent[] {
  const events: PortfolioCreditEvent[] = [];
  const base = baseFromRow(row);
  const reportDate = row.later_reported_date;
  const idKey = `${row.position_id ?? ""}:${row.earlier_position_observation_id ?? ""}:${row.later_position_observation_id ?? ""}`;

  const changes: PortfolioNumericChange[] = [];
  if (
    row.principal_comparison_state === "COMPARABLE"
    && isNonZeroNumericDelta(row.principal_delta)
    && row.principal_delta != null
  ) {
    changes.push({
      field: "principal",
      comparison_state: row.principal_comparison_state,
      earlier_raw: row.earlier_principal_raw,
      later_raw: row.later_principal_raw,
      delta: row.principal_delta,
      earlier_currency_state: row.earlier_principal_currency_state,
      later_currency_state: row.later_principal_currency_state,
    });
  }
  if (
    row.cost_comparison_state === "COMPARABLE"
    && isNonZeroNumericDelta(row.cost_delta)
    && row.cost_delta != null
  ) {
    changes.push({
      field: "cost",
      comparison_state: row.cost_comparison_state,
      earlier_raw: row.earlier_cost_raw,
      later_raw: row.later_cost_raw,
      delta: row.cost_delta,
    });
  }
  if (changes.length > 0) {
    events.push({
      ...base,
      key: `POSITION_CHANGED:${idKey}`,
      event_type: "POSITION_CHANGED",
      report_date: reportDate,
      payload: {
        changed_fields: changes.map((change) => change.field),
        changes,
      },
    });
  }

  if (
    row.fair_value_comparison_state === "COMPARABLE"
    && isNonZeroNumericDelta(row.fair_value_delta)
    && row.fair_value_delta != null
  ) {
    events.push({
      ...base,
      key: `VALUATION_CHANGED:${idKey}`,
      event_type: "VALUATION_CHANGED",
      report_date: reportDate,
      payload: {
        fair_value_comparison_state: row.fair_value_comparison_state,
        earlier_fair_value_raw: row.earlier_fair_value_raw,
        later_fair_value_raw: row.later_fair_value_raw,
        fair_value_delta: row.fair_value_delta,
        earlier_fair_value_currency_state: row.earlier_fair_value_currency_state,
        later_fair_value_currency_state: row.later_fair_value_currency_state,
      },
    });
  }

  if (row.maturity_comparison_state === "COMPARABLE" && row.maturity_changed === true) {
    events.push({
      ...base,
      key: `MATURITY_CHANGED:${idKey}`,
      event_type: "MATURITY_CHANGED",
      report_date: reportDate,
      payload: {
        maturity_comparison_state: row.maturity_comparison_state,
        maturity_changed: true,
        earlier_maturity_raw: row.earlier_maturity_raw,
        later_maturity_raw: row.later_maturity_raw,
      },
    });
  }

  return events;
}

export function portfolioCreditIntelligence(rows: PeriodChangeRow[]): PortfolioCreditEvent[] {
  const events: PortfolioCreditEvent[] = [];
  for (const row of rows) {
    if (row.change_type === "EXISTING_POSITION_CHANGED") {
      events.push(...existingEvents(row));
      continue;
    }
    if (row.change_type === "NEW_POSITION_OBSERVED") {
      events.push({
        ...baseFromRow(row),
        key: `NEW_POSITION_OBSERVED:${row.later_position_observation_id ?? row.position_id ?? ""}`,
        event_type: "NEW_POSITION_OBSERVED",
        report_date: row.later_reported_date,
        payload: {
          later_principal_raw: row.later_principal_raw,
          later_fair_value_raw: row.later_fair_value_raw,
          later_maturity_raw: row.later_maturity_raw,
          note: NEW_POSITION_OBSERVED_NOTE,
        },
      });
      continue;
    }
    if (row.change_type === "POSITION_NO_LONGER_OBSERVED") {
      events.push({
        ...baseFromRow(row),
        key: `POSITION_NO_LONGER_OBSERVED:${row.earlier_position_observation_id ?? row.position_id ?? ""}`,
        event_type: "POSITION_NO_LONGER_OBSERVED",
        report_date: row.earlier_reported_date,
        payload: {
          earlier_principal_raw: row.earlier_principal_raw,
          earlier_fair_value_raw: row.earlier_fair_value_raw,
          earlier_maturity_raw: row.earlier_maturity_raw,
          note: NO_LONGER_OBSERVED_NOTE,
        },
      });
    }
  }
  events.sort(compareEvents);
  return events;
}

export function isLinkableLegalEntityId(value: string | null): value is string {
  return value != null && LEGAL_ENTITY_ID.test(value);
}

export function portfolioCreditFactSummary(event: PortfolioCreditEvent): string {
  if (event.event_type === "POSITION_CHANGED") {
    const payload = event.payload as PositionChangedPayload;
    return payload.changes.map((change) => `${change.field} delta ${change.delta}`).join("; ");
  }
  if (event.event_type === "VALUATION_CHANGED") {
    const payload = event.payload as ValuationChangedPayload;
    return `fair_value delta ${payload.fair_value_delta}`;
  }
  if (event.event_type === "MATURITY_CHANGED") {
    const payload = event.payload as MaturityChangedPayload;
    return `maturity ${payload.earlier_maturity_raw ?? "Unknown"} → ${payload.later_maturity_raw ?? "Unknown"}`;
  }
  if (event.event_type === "NEW_POSITION_OBSERVED") {
    return NEW_POSITION_OBSERVED_NOTE;
  }
  return NO_LONGER_OBSERVED_NOTE;
}

export function portfolioCreditEvidence(event: PortfolioCreditEvent): {
  accessionNumber: string;
  documentUrl: string | null;
} {
  if (event.event_type === "POSITION_NO_LONGER_OBSERVED") {
    return {
      accessionNumber: event.earlier_accession_number ?? "Unknown",
      documentUrl: event.earlier_document_url,
    };
  }
  return {
    accessionNumber: event.later_accession_number ?? event.earlier_accession_number ?? "Unknown",
    documentUrl: event.later_document_url ?? event.earlier_document_url,
  };
}
