import { describe, expect, it } from "vitest";
import type { PositionComparisonRow } from "@/lib/borrower-comparisons";
import type { PositionObservationRow } from "@/lib/borrower-positions";
import type { ValuationRow } from "@/lib/borrower-valuation";
import {
  CREDIT_TIMELINE_NOTE,
  creditTimeline,
  TIMELINE_DEFINITION,
  type CreditTimelineEvent,
  type MaturityChangedPayload,
  type PositionChangedPayload,
  type PositionObservedPayload,
  type ValuationChangedPayload,
} from "@/lib/borrower-credit-timeline";

function observation(overrides: Partial<PositionObservationRow> = {}): PositionObservationRow {
  return {
    legal_entity_id: "11111111-1111-4111-8111-111111111111",
    position_observation_id: "9001",
    reported_date: "2024-06-30",
    accession_number: "0000000000-24-000001",
    registrant_cik: "0001234567",
    registrant_link_status: "LINKED",
    entity_resolution_state: "MATCHED",
    instrument_resolution_state: "MATCHED",
    continuity_state: "MATCHED",
    economic_group_state: "UNKNOWN",
    principal_state: "REPORTED",
    principal_raw: "100",
    principal_currency_state: "USD",
    cost_state: "UNKNOWN",
    cost_raw: null,
    cost_currency_state: null,
    fair_value_state: "REPORTED",
    fair_value_raw: "98",
    fair_value_currency_state: "USD",
    acquisition_state: "UNKNOWN",
    acquisition_raw: null,
    acquisition_precision: null,
    interest_rate_state: "UNKNOWN",
    interest_rate_raw: null,
    spread_state: "UNKNOWN",
    spread_raw: null,
    interest_rate_floor_state: "UNKNOWN",
    interest_rate_floor_raw: null,
    maturity_source: "REPORTED_STRUCTURED",
    maturity_raw: "2028-01-15",
    maturity_precision: null,
    maturity_filing_verified: false,
    maturity_document_url: null,
    observation_evidence_level: "L1_STRUCTURED_DATASET",
    ...overrides,
  };
}

function valuation(overrides: Partial<ValuationRow> = {}): ValuationRow {
  return {
    legal_entity_id: "11111111-1111-4111-8111-111111111111",
    position_observation_id: "9001",
    position_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    instrument_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    borrower_name_raw: "Example Borrower",
    reported_date: "2024-06-30",
    accession_number: "0000000000-24-000001",
    registrant_cik: "0001234567",
    registrant_link_status: "LINKED",
    entity_resolution_state: "MATCHED",
    instrument_resolution_state: "MATCHED",
    continuity_state: "MATCHED",
    instrument_type_state: "REPORTED",
    instrument_type_raw: "First Lien",
    instrument_type_evidence_level: "L1_STRUCTURED_DATASET",
    fair_value_state: "REPORTED",
    fair_value_raw: "98",
    fair_value_numeric: "98",
    fair_value_currency_state: "REPORTED",
    fair_value_currency_code: "USD",
    principal_state: "REPORTED",
    principal_raw: "100",
    principal_numeric: "100",
    principal_currency_state: "REPORTED",
    principal_currency_code: "USD",
    cost_state: "UNKNOWN",
    cost_raw: null,
    cost_numeric: null,
    cost_currency_state: "UNKNOWN",
    cost_currency_code: null,
    observation_evidence_id: "5001",
    observation_evidence_level: "L1_STRUCTURED_DATASET",
    earlier_reported_date: null,
    fair_value_change_state: "INSUFFICIENT_DATA",
    fair_value_delta: null,
    fair_value_percentage_state: "INSUFFICIENT_DATA",
    fair_value_percentage: null,
    fair_value_to_principal_state: "INSUFFICIENT_DATA",
    fair_value_to_principal: null,
    fair_value_to_cost_state: "INSUFFICIENT_DATA",
    fair_value_to_cost: null,
    cross_bdc_comparison_state: "UNAVAILABLE",
    valuation_definition: "valuation.position_history.v1",
    ...overrides,
  };
}

function comparison(overrides: Partial<PositionComparisonRow> = {}): PositionComparisonRow {
  return {
    legal_entity_id: "11111111-1111-4111-8111-111111111111",
    position_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    earlier_position_observation_id: "9000",
    later_position_observation_id: "9001",
    earlier_reported_date: "2023-12-31",
    later_reported_date: "2024-06-30",
    earlier_accession_number: "0000000000-24-000000",
    later_accession_number: "0000000000-24-000001",
    earlier_observation_evidence_id: "5000",
    later_observation_evidence_id: "5001",
    earlier_observation_evidence_level: "L1_STRUCTURED_DATASET",
    later_observation_evidence_level: "L1_STRUCTURED_DATASET",
    earlier_registrant_cik: "0001234567",
    earlier_registrant_link_status: "LINKED",
    later_registrant_cik: "0001234567",
    later_registrant_link_status: "LINKED",
    principal_comparison_state: "INSUFFICIENT_DATA",
    earlier_principal_raw: null,
    later_principal_raw: null,
    principal_delta: null,
    earlier_principal_currency_state: null,
    later_principal_currency_state: null,
    cost_comparison_state: "INSUFFICIENT_DATA",
    earlier_cost_raw: null,
    later_cost_raw: null,
    cost_delta: null,
    earlier_cost_currency_state: null,
    later_cost_currency_state: null,
    fair_value_comparison_state: "INSUFFICIENT_DATA",
    earlier_fair_value_raw: null,
    later_fair_value_raw: null,
    fair_value_delta: null,
    earlier_fair_value_currency_state: null,
    later_fair_value_currency_state: null,
    maturity_comparison_state: "INSUFFICIENT_DATA",
    maturity_changed: null,
    earlier_maturity_raw: null,
    later_maturity_raw: null,
    earlier_maturity_precision: null,
    later_maturity_precision: null,
    earlier_maturity_date: null,
    later_maturity_date: null,
    acquisition_comparison_state: "COMPARABLE",
    earlier_acquisition_raw: "2020-01-01",
    later_acquisition_raw: "2021-01-01",
    earlier_acquisition_precision: null,
    later_acquisition_precision: null,
    earlier_acquisition_date: "2020-01-01",
    later_acquisition_date: "2021-01-01",
    interest_rate_comparison_state: "INSUFFICIENT_DATA",
    earlier_interest_rate_raw: null,
    later_interest_rate_raw: null,
    interest_rate_delta: null,
    spread_comparison_state: "INSUFFICIENT_DATA",
    earlier_spread_raw: null,
    later_spread_raw: null,
    spread_delta: null,
    interest_rate_floor_comparison_state: "INSUFFICIENT_DATA",
    earlier_interest_rate_floor_raw: null,
    later_interest_rate_floor_raw: null,
    interest_rate_floor_delta: null,
    ...overrides,
  };
}

function types(events: CreditTimelineEvent[]) {
  return events.map((event) => event.event_type);
}

describe("borrower credit timeline", () => {
  it("emits one POSITION_OBSERVED for each observation", () => {
    const events = creditTimeline({
      observations: [observation()],
      valuations: [],
      comparisons: [],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("POSITION_OBSERVED");
    expect(events[0]?.report_date).toBe("2024-06-30");
    expect(events[0]?.later_accession_number).toBe("0000000000-24-000001");
    expect(events[0]?.timeline_definition).toBe(TIMELINE_DEFINITION);
  });

  it("keeps unresolved observations visible", () => {
    const events = creditTimeline({
      observations: [
        observation({
          position_observation_id: "9002",
          instrument_resolution_state: "UNRESOLVED",
          continuity_state: "UNRESOLVED",
        }),
      ],
      valuations: [],
      comparisons: [],
    });
    expect(events).toHaveLength(1);
    const payload = events[0]?.payload as PositionObservedPayload;
    expect(payload.instrument_resolution_state).toBe("UNRESOLVED");
    expect(payload.continuity_state).toBe("UNRESOLVED");
  });

  it("enriches POSITION_OBSERVED from valuation rows", () => {
    const events = creditTimeline({
      observations: [observation()],
      valuations: [valuation()],
      comparisons: [],
    });
    expect(events[0]?.position_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(events[0]?.instrument_id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(events[0]?.later_observation_evidence_id).toBe("5001");
  });

  it("leaves enrichment null when valuation is missing", () => {
    const events = creditTimeline({
      observations: [observation()],
      valuations: [],
      comparisons: [],
    });
    expect(events[0]?.position_id).toBeNull();
    expect(events[0]?.instrument_id).toBeNull();
    expect(events[0]?.later_observation_evidence_id).toBeNull();
  });

  it("emits POSITION_CHANGED for principal, cost, rate, spread, and floor changes", () => {
    const events = creditTimeline({
      observations: [],
      valuations: [],
      comparisons: [
        comparison({
          principal_comparison_state: "COMPARABLE",
          earlier_principal_raw: "100",
          later_principal_raw: "110",
          principal_delta: "10",
          earlier_principal_currency_state: "USD",
          later_principal_currency_state: "USD",
        }),
        comparison({
          earlier_position_observation_id: "8000",
          later_position_observation_id: "8001",
          cost_comparison_state: "COMPARABLE",
          earlier_cost_raw: "90",
          later_cost_raw: "95",
          cost_delta: "5",
        }),
        comparison({
          earlier_position_observation_id: "7000",
          later_position_observation_id: "7001",
          interest_rate_comparison_state: "COMPARABLE",
          earlier_interest_rate_raw: "8",
          later_interest_rate_raw: "9",
          interest_rate_delta: "1",
        }),
        comparison({
          earlier_position_observation_id: "6000",
          later_position_observation_id: "6001",
          spread_comparison_state: "COMPARABLE",
          earlier_spread_raw: "4",
          later_spread_raw: "4.5",
          spread_delta: "0.5",
        }),
        comparison({
          earlier_position_observation_id: "5000",
          later_position_observation_id: "5001",
          interest_rate_floor_comparison_state: "COMPARABLE",
          earlier_interest_rate_floor_raw: "1",
          later_interest_rate_floor_raw: "1.25",
          interest_rate_floor_delta: "0.25",
        }),
      ],
    });
    const changed = events.filter((event) => event.event_type === "POSITION_CHANGED");
    expect(changed).toHaveLength(5);
    const fields = changed.flatMap((event) => (event.payload as PositionChangedPayload).changed_fields);
    expect(fields.sort()).toEqual([
      "cost",
      "interest_rate",
      "interest_rate_floor",
      "principal",
      "spread",
    ]);
  });

  it("does not emit POSITION_CHANGED for a zero delta", () => {
    const events = creditTimeline({
      observations: [],
      valuations: [],
      comparisons: [
        comparison({
          principal_comparison_state: "COMPARABLE",
          earlier_principal_raw: "100",
          later_principal_raw: "100",
          principal_delta: "0",
        }),
        comparison({
          earlier_position_observation_id: "8000",
          later_position_observation_id: "8001",
          cost_comparison_state: "COMPARABLE",
          earlier_cost_raw: "90",
          later_cost_raw: "90",
          cost_delta: "0.0",
        }),
      ],
    });
    expect(events.filter((event) => event.event_type === "POSITION_CHANGED")).toHaveLength(0);
  });

  it("emits only VALUATION_CHANGED for a fair-value change", () => {
    const events = creditTimeline({
      observations: [],
      valuations: [],
      comparisons: [
        comparison({
          fair_value_comparison_state: "COMPARABLE",
          earlier_fair_value_raw: "98",
          later_fair_value_raw: "95",
          fair_value_delta: "-3",
          earlier_fair_value_currency_state: "USD",
          later_fair_value_currency_state: "USD",
        }),
      ],
    });
    expect(types(events)).toEqual(["VALUATION_CHANGED"]);
    const payload = events[0]?.payload as ValuationChangedPayload;
    expect(payload.fair_value_delta).toBe("-3");
  });

  it("emits only MATURITY_CHANGED for a maturity change", () => {
    const events = creditTimeline({
      observations: [],
      valuations: [],
      comparisons: [
        comparison({
          maturity_comparison_state: "COMPARABLE",
          maturity_changed: true,
          earlier_maturity_raw: "2027-01-01",
          later_maturity_raw: "2028-01-01",
          earlier_maturity_date: "2027-01-01",
          later_maturity_date: "2028-01-01",
        }),
      ],
    });
    expect(types(events)).toEqual(["MATURITY_CHANGED"]);
    const payload = events[0]?.payload as MaturityChangedPayload;
    expect(payload.refinancing_outcome_state).toBe("UNKNOWN");
    expect(payload.maturity_changed).toBe(true);
  });

  it("can emit POSITION_CHANGED, VALUATION_CHANGED, and MATURITY_CHANGED from one comparison", () => {
    const events = creditTimeline({
      observations: [],
      valuations: [],
      comparisons: [
        comparison({
          principal_comparison_state: "COMPARABLE",
          earlier_principal_raw: "100",
          later_principal_raw: "110",
          principal_delta: "10",
          fair_value_comparison_state: "COMPARABLE",
          earlier_fair_value_raw: "98",
          later_fair_value_raw: "95",
          fair_value_delta: "-3",
          maturity_comparison_state: "COMPARABLE",
          maturity_changed: true,
          earlier_maturity_raw: "2027-01-01",
          later_maturity_raw: "2028-01-01",
        }),
      ],
    });
    expect(types(events)).toEqual(["POSITION_CHANGED", "VALUATION_CHANGED", "MATURITY_CHANGED"]);
  });

  it("does not emit change events for insufficient or uncomparable fields", () => {
    const events = creditTimeline({
      observations: [],
      valuations: [],
      comparisons: [
        comparison({
          principal_comparison_state: "INSUFFICIENT_DATA",
          principal_delta: "10",
          fair_value_comparison_state: "INSUFFICIENT_DATA",
          fair_value_delta: "-3",
          maturity_comparison_state: "INSUFFICIENT_DATA",
          maturity_changed: true,
          interest_rate_comparison_state: "UNKNOWN",
          interest_rate_delta: "1",
        }),
      ],
    });
    expect(events).toHaveLength(0);
  });

  it("does not emit POSITION_CHANGED for acquisition differences in V1", () => {
    const events = creditTimeline({
      observations: [],
      valuations: [],
      comparisons: [comparison()],
    });
    expect(events).toHaveLength(0);
  });

  it("orders by report date, event type, registrant, position, and observation id", () => {
    const events = creditTimeline({
      observations: [
        observation({
          position_observation_id: "9002",
          reported_date: "2024-06-30",
          registrant_cik: "0002222222",
        }),
        observation({
          position_observation_id: "9001",
          reported_date: "2024-06-30",
          registrant_cik: "0001111111",
        }),
        observation({
          position_observation_id: "8001",
          reported_date: "2023-12-31",
          registrant_cik: "0001111111",
        }),
      ],
      valuations: [
        valuation({
          position_observation_id: "9002",
          position_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        }),
        valuation({
          position_observation_id: "9001",
          position_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
        valuation({
          position_observation_id: "8001",
          position_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      ],
      comparisons: [
        comparison({
          later_reported_date: "2024-06-30",
          later_registrant_cik: "0001111111",
          position_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          earlier_position_observation_id: "7000",
          later_position_observation_id: "9001",
          principal_comparison_state: "COMPARABLE",
          principal_delta: "1",
          earlier_principal_raw: "1",
          later_principal_raw: "2",
          fair_value_comparison_state: "COMPARABLE",
          fair_value_delta: "-1",
          earlier_fair_value_raw: "2",
          later_fair_value_raw: "1",
          maturity_comparison_state: "COMPARABLE",
          maturity_changed: true,
          earlier_maturity_raw: "2026-01-01",
          later_maturity_raw: "2027-01-01",
        }),
      ],
    });
    expect(types(events)).toEqual([
      "POSITION_CHANGED",
      "VALUATION_CHANGED",
      "MATURITY_CHANGED",
      "POSITION_OBSERVED",
      "POSITION_OBSERVED",
      "POSITION_OBSERVED",
    ]);
    expect(events.map((event) => event.report_date)).toEqual([
      "2024-06-30",
      "2024-06-30",
      "2024-06-30",
      "2024-06-30",
      "2024-06-30",
      "2023-12-31",
    ]);
    const observed = events.filter((event) => event.event_type === "POSITION_OBSERVED");
    expect(observed.map((event) => event.registrant_cik)).toEqual([
      "0001111111",
      "0002222222",
      "0001111111",
    ]);
  });

  it("avoids inferred origination, refinancing, and credit-quality language", () => {
    expect(CREDIT_TIMELINE_NOTE).toMatch(/not a refinancing/);
    expect(CREDIT_TIMELINE_NOTE).toMatch(/appeared in that filing period/);
    expect(CREDIT_TIMELINE_NOTE).toMatch(/not credit conclusions/);
    expect(CREDIT_TIMELINE_NOTE).not.toMatch(/\b(origination|repayment|deterioration|improvement|exit)\b/i);
    const events = creditTimeline({
      observations: [observation()],
      valuations: [valuation()],
      comparisons: [
        comparison({
          principal_comparison_state: "COMPARABLE",
          principal_delta: "1",
          earlier_principal_raw: "1",
          later_principal_raw: "2",
          maturity_comparison_state: "COMPARABLE",
          maturity_changed: true,
          earlier_maturity_raw: "2027-01-01",
          later_maturity_raw: "2028-01-01",
        }),
      ],
    });
    expect(types(events)).not.toContain("REFINANCING_OUTCOME");
    expect(JSON.stringify(events)).not.toMatch(/\b(origination|repayment|deterioration|improvement)\b/i);
    const maturity = events.find((event) => event.event_type === "MATURITY_CHANGED");
    expect((maturity?.payload as MaturityChangedPayload).refinancing_outcome_state).toBe("UNKNOWN");
  });
});
