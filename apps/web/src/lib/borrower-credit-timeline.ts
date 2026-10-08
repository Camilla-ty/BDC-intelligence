// Borrower Credit Timeline v1.
// Pure merge of already-loaded observation, valuation, and comparison rows.
// Observed facts only: not origination, repayment, refinancing, or credit quality.

import { storedDeltaSign } from "@/lib/borrower-activity";
import type { PositionComparisonRow } from "@/lib/borrower-comparisons";
import type { PositionObservationRow } from "@/lib/borrower-positions";
import type { ValuationRow } from "@/lib/borrower-valuation";

export const TIMELINE_DEFINITION = "timeline.borrower_position_events.v1";
export const CREDIT_TIMELINE_NOTE =
  "Each row is an observed filing fact for this legal entity. A report date is not a transaction date. Field changes are stored comparisons, not credit conclusions. A maturity change is not a refinancing. An observation means only that the position appeared in that filing period.";
export const EMPTY_CREDIT_TIMELINE =
  "No stored position observation or confirmed field change is available for a credit timeline.";

export const CREDIT_TIMELINE_EVENT_TYPES = [
  "POSITION_CHANGED",
  "VALUATION_CHANGED",
  "MATURITY_CHANGED",
  "POSITION_OBSERVED",
] as const;

export type CreditTimelineEventType = (typeof CREDIT_TIMELINE_EVENT_TYPES)[number];

export type ChangedPositionField = "principal" | "cost" | "interest_rate" | "spread" | "interest_rate_floor";

export type NumericChangeFact = {
  field: ChangedPositionField;
  comparison_state: string;
  earlier_raw: string | null;
  later_raw: string | null;
  delta: string;
  earlier_currency_state?: string | null;
  later_currency_state?: string | null;
};

export type PositionObservedPayload = {
  entity_resolution_state: string;
  instrument_resolution_state: string;
  continuity_state: string;
  economic_group_state: string;
  observation_evidence_level: string;
  principal_state: string;
  principal_raw: string | null;
  cost_state: string;
  cost_raw: string | null;
  fair_value_state: string;
  fair_value_raw: string | null;
  maturity_raw: string | null;
  maturity_source: string;
};

export type PositionChangedPayload = {
  changed_fields: ChangedPositionField[];
  changes: NumericChangeFact[];
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
  earlier_maturity_precision: string | null;
  later_maturity_precision: string | null;
  earlier_maturity_date: string | null;
  later_maturity_date: string | null;
  refinancing_outcome_state: "UNKNOWN";
};

export type CreditTimelineEvent = {
  key: string;
  event_type: CreditTimelineEventType;
  report_date: string;
  earlier_report_date: string | null;
  legal_entity_id: string;
  position_id: string | null;
  instrument_id: string | null;
  registrant_cik: string | null;
  registrant_link_status: string | null;
  earlier_position_observation_id: string | null;
  later_position_observation_id: string;
  earlier_accession_number: string | null;
  later_accession_number: string;
  earlier_observation_evidence_id: string | null;
  later_observation_evidence_id: string | null;
  earlier_observation_evidence_level: string | null;
  later_observation_evidence_level: string | null;
  payload: PositionObservedPayload | PositionChangedPayload | ValuationChangedPayload | MaturityChangedPayload;
  timeline_definition: string;
};

const EVENT_TYPE_ORDER: Record<CreditTimelineEventType, number> = {
  POSITION_CHANGED: 0,
  VALUATION_CHANGED: 1,
  MATURITY_CHANGED: 2,
  POSITION_OBSERVED: 3,
};

function isNonZeroNumericDelta(delta: string | null): boolean {
  if (delta == null || delta.trim() === "") return false;
  const sign = storedDeltaSign(delta);
  return sign === "higher" || sign === "lower";
}

function numericChange(
  field: ChangedPositionField,
  state: string,
  earlierRaw: string | null,
  laterRaw: string | null,
  delta: string | null,
  earlierCurrency?: string | null,
  laterCurrency?: string | null,
): NumericChangeFact | null {
  if (state !== "COMPARABLE" || !isNonZeroNumericDelta(delta) || delta == null) return null;
  const fact: NumericChangeFact = {
    field,
    comparison_state: state,
    earlier_raw: earlierRaw,
    later_raw: laterRaw,
    delta,
  };
  if (earlierCurrency !== undefined || laterCurrency !== undefined) {
    fact.earlier_currency_state = earlierCurrency ?? null;
    fact.later_currency_state = laterCurrency ?? null;
  }
  return fact;
}

function positionChanges(row: PositionComparisonRow): NumericChangeFact[] {
  const changes: NumericChangeFact[] = [];
  const principal = numericChange(
    "principal",
    row.principal_comparison_state,
    row.earlier_principal_raw,
    row.later_principal_raw,
    row.principal_delta,
    row.earlier_principal_currency_state,
    row.later_principal_currency_state,
  );
  if (principal) changes.push(principal);
  const cost = numericChange(
    "cost",
    row.cost_comparison_state,
    row.earlier_cost_raw,
    row.later_cost_raw,
    row.cost_delta,
    row.earlier_cost_currency_state,
    row.later_cost_currency_state,
  );
  if (cost) changes.push(cost);
  const rate = numericChange(
    "interest_rate",
    row.interest_rate_comparison_state,
    row.earlier_interest_rate_raw,
    row.later_interest_rate_raw,
    row.interest_rate_delta,
  );
  if (rate) changes.push(rate);
  const spread = numericChange(
    "spread",
    row.spread_comparison_state,
    row.earlier_spread_raw,
    row.later_spread_raw,
    row.spread_delta,
  );
  if (spread) changes.push(spread);
  const floor = numericChange(
    "interest_rate_floor",
    row.interest_rate_floor_comparison_state,
    row.earlier_interest_rate_floor_raw,
    row.later_interest_rate_floor_raw,
    row.interest_rate_floor_delta,
  );
  if (floor) changes.push(floor);
  return changes;
}

function sortNullsLast(value: string | null): string {
  return value == null || value.trim() === "" ? "\uffff" : value;
}

function compareEvents(a: CreditTimelineEvent, b: CreditTimelineEvent): number {
  return (
    b.report_date.localeCompare(a.report_date)
    || EVENT_TYPE_ORDER[a.event_type] - EVENT_TYPE_ORDER[b.event_type]
    || sortNullsLast(a.registrant_cik).localeCompare(sortNullsLast(b.registrant_cik))
    || sortNullsLast(a.position_id).localeCompare(sortNullsLast(b.position_id))
    || a.later_position_observation_id.localeCompare(b.later_position_observation_id)
    || a.key.localeCompare(b.key)
  );
}

function observedEvents(
  observations: PositionObservationRow[],
  valuations: ValuationRow[],
): CreditTimelineEvent[] {
  const byObservation = new Map<string, ValuationRow>();
  for (const row of valuations) {
    if (!byObservation.has(row.position_observation_id)) {
      byObservation.set(row.position_observation_id, row);
    }
  }
  const events: CreditTimelineEvent[] = [];
  for (const row of observations) {
    const enrich = byObservation.get(row.position_observation_id);
    events.push({
      key: `POSITION_OBSERVED:${row.position_observation_id}`,
      event_type: "POSITION_OBSERVED",
      report_date: row.reported_date,
      earlier_report_date: null,
      legal_entity_id: row.legal_entity_id,
      position_id: enrich?.position_id ?? null,
      instrument_id: enrich?.instrument_id ?? null,
      registrant_cik: row.registrant_cik,
      registrant_link_status: row.registrant_link_status,
      earlier_position_observation_id: null,
      later_position_observation_id: row.position_observation_id,
      earlier_accession_number: null,
      later_accession_number: row.accession_number,
      earlier_observation_evidence_id: null,
      later_observation_evidence_id: enrich?.observation_evidence_id ?? null,
      earlier_observation_evidence_level: null,
      later_observation_evidence_level: row.observation_evidence_level,
      payload: {
        entity_resolution_state: row.entity_resolution_state,
        instrument_resolution_state: row.instrument_resolution_state,
        continuity_state: row.continuity_state,
        economic_group_state: row.economic_group_state,
        observation_evidence_level: row.observation_evidence_level,
        principal_state: row.principal_state,
        principal_raw: row.principal_raw,
        cost_state: row.cost_state,
        cost_raw: row.cost_raw,
        fair_value_state: row.fair_value_state,
        fair_value_raw: row.fair_value_raw,
        maturity_raw: row.maturity_raw,
        maturity_source: row.maturity_source,
      },
      timeline_definition: TIMELINE_DEFINITION,
    });
  }
  return events;
}

function comparisonEvents(comparisons: PositionComparisonRow[]): CreditTimelineEvent[] {
  const events: CreditTimelineEvent[] = [];
  for (const row of comparisons) {
    const base: Omit<CreditTimelineEvent, "key" | "event_type" | "payload"> = {
      report_date: row.later_reported_date,
      earlier_report_date: row.earlier_reported_date,
      legal_entity_id: row.legal_entity_id,
      position_id: row.position_id,
      instrument_id: null,
      registrant_cik: row.later_registrant_cik,
      registrant_link_status: row.later_registrant_link_status,
      earlier_position_observation_id: row.earlier_position_observation_id,
      later_position_observation_id: row.later_position_observation_id,
      earlier_accession_number: row.earlier_accession_number,
      later_accession_number: row.later_accession_number,
      earlier_observation_evidence_id: row.earlier_observation_evidence_id,
      later_observation_evidence_id: row.later_observation_evidence_id,
      earlier_observation_evidence_level: row.earlier_observation_evidence_level,
      later_observation_evidence_level: row.later_observation_evidence_level,
      timeline_definition: TIMELINE_DEFINITION,
    };
    const changes = positionChanges(row);
    if (changes.length > 0) {
      events.push({
        ...base,
        key: `POSITION_CHANGED:${row.position_id}:${row.earlier_position_observation_id}:${row.later_position_observation_id}`,
        event_type: "POSITION_CHANGED",
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
        key: `VALUATION_CHANGED:${row.position_id}:${row.earlier_position_observation_id}:${row.later_position_observation_id}`,
        event_type: "VALUATION_CHANGED",
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
        key: `MATURITY_CHANGED:${row.position_id}:${row.earlier_position_observation_id}:${row.later_position_observation_id}`,
        event_type: "MATURITY_CHANGED",
        payload: {
          maturity_comparison_state: row.maturity_comparison_state,
          maturity_changed: true,
          earlier_maturity_raw: row.earlier_maturity_raw,
          later_maturity_raw: row.later_maturity_raw,
          earlier_maturity_precision: row.earlier_maturity_precision,
          later_maturity_precision: row.later_maturity_precision,
          earlier_maturity_date: row.earlier_maturity_date,
          later_maturity_date: row.later_maturity_date,
          refinancing_outcome_state: "UNKNOWN",
        },
      });
    }
  }
  return events;
}

export function creditTimeline(input: {
  observations: PositionObservationRow[];
  valuations: ValuationRow[];
  comparisons: PositionComparisonRow[];
}): CreditTimelineEvent[] {
  const events = [
    ...observedEvents(input.observations, input.valuations),
    ...comparisonEvents(input.comparisons),
  ];
  events.sort(compareEvents);
  return events;
}

export function timelineFactSummary(event: CreditTimelineEvent): string {
  if (event.event_type === "POSITION_OBSERVED") {
    const payload = event.payload as PositionObservedPayload;
    return [
      `Instrument ${payload.instrument_resolution_state}`,
      `continuity ${payload.continuity_state}`,
    ].join(" · ");
  }
  if (event.event_type === "POSITION_CHANGED") {
    const payload = event.payload as PositionChangedPayload;
    return payload.changes.map((change) => `${change.field} delta ${change.delta}`).join("; ");
  }
  if (event.event_type === "VALUATION_CHANGED") {
    const payload = event.payload as ValuationChangedPayload;
    return `fair_value delta ${payload.fair_value_delta}`;
  }
  const payload = event.payload as MaturityChangedPayload;
  return `maturity ${payload.earlier_maturity_raw ?? "Unknown"} → ${payload.later_maturity_raw ?? "Unknown"}`;
}
