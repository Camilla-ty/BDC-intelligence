import { describe, expect, it } from "vitest";
import type { PeriodChangeRow } from "@/lib/portfolio-changes";
import {
  LEGAL_ENTITY_ID,
  NEW_POSITION_OBSERVED_NOTE,
  NO_LONGER_OBSERVED_NOTE,
  PORTFOLIO_CREDIT_DEFINITION,
  PORTFOLIO_CREDIT_NOTE,
  isLinkableLegalEntityId,
  portfolioCreditIntelligence,
  type MaturityChangedPayload,
  type PositionChangedPayload,
  type PortfolioCreditEvent,
  type ValuationChangedPayload,
} from "@/lib/portfolio-credit-intelligence";

function row(overrides: Partial<PeriodChangeRow> = {}): PeriodChangeRow {
  return {
    change_type: "EXISTING_POSITION_CHANGED",
    registrant_cik: "0001234567",
    earlier_reported_date: "2023-12-31",
    later_reported_date: "2024-06-30",
    position_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    instrument_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    legal_entity_id: "11111111-1111-4111-8111-111111111111",
    borrower_name_raw: "Example Borrower",
    holding_descriptor_raw: "Example Borrower | First Lien",
    instrument_resolution_state: "MATCHED",
    continuity_state: "MATCHED",
    instrument_type_state: "REPORTED",
    instrument_type_raw: "First Lien",
    principal_comparison_state: "INSUFFICIENT_DATA",
    principal_delta: null,
    earlier_principal_raw: null,
    later_principal_raw: null,
    earlier_principal_currency_state: null,
    later_principal_currency_state: null,
    fair_value_comparison_state: "INSUFFICIENT_DATA",
    fair_value_delta: null,
    earlier_fair_value_raw: null,
    later_fair_value_raw: null,
    earlier_fair_value_currency_state: null,
    later_fair_value_currency_state: null,
    cost_comparison_state: "INSUFFICIENT_DATA",
    cost_delta: null,
    earlier_cost_raw: null,
    later_cost_raw: null,
    maturity_comparison_state: "INSUFFICIENT_DATA",
    maturity_changed: null,
    earlier_maturity_raw: null,
    later_maturity_raw: null,
    earlier_accession_number: "0000000000-24-000000",
    later_accession_number: "0000000000-24-000001",
    earlier_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/earlier.htm",
    later_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/later.htm",
    earlier_position_observation_id: "9000",
    later_position_observation_id: "9001",
    changes_definition: "portfolio.period_changes.v1",
    ...overrides,
  };
}

function types(events: PortfolioCreditEvent[]) {
  return events.map((event) => event.event_type);
}

describe("portfolio credit intelligence", () => {
  it("emits POSITION_CHANGED for principal and cost changes", () => {
    const principalOnly = portfolioCreditIntelligence([
      row({
        principal_comparison_state: "COMPARABLE",
        earlier_principal_raw: "100",
        later_principal_raw: "110",
        principal_delta: "10",
        earlier_principal_currency_state: "FROM_FILING",
        later_principal_currency_state: "FROM_FILING",
      }),
    ]);
    expect(types(principalOnly)).toEqual(["POSITION_CHANGED"]);
    expect((principalOnly[0]?.payload as PositionChangedPayload).changed_fields).toEqual(["principal"]);

    const costOnly = portfolioCreditIntelligence([
      row({
        cost_comparison_state: "COMPARABLE",
        earlier_cost_raw: "90",
        later_cost_raw: "95",
        cost_delta: "5",
      }),
    ]);
    expect((costOnly[0]?.payload as PositionChangedPayload).changed_fields).toEqual(["cost"]);
    expect(JSON.stringify(costOnly[0]?.payload)).not.toMatch(/currency/);
  });

  it("combines principal and cost in one POSITION_CHANGED event", () => {
    const events = portfolioCreditIntelligence([
      row({
        principal_comparison_state: "COMPARABLE",
        earlier_principal_raw: "100",
        later_principal_raw: "110",
        principal_delta: "10",
        cost_comparison_state: "COMPARABLE",
        earlier_cost_raw: "90",
        later_cost_raw: "95",
        cost_delta: "5",
      }),
    ]);
    expect(types(events)).toEqual(["POSITION_CHANGED"]);
    expect((events[0]?.payload as PositionChangedPayload).changed_fields).toEqual(["principal", "cost"]);
  });

  it("emits VALUATION_CHANGED and MATURITY_CHANGED with the approved predicates", () => {
    const valuation = portfolioCreditIntelligence([
      row({
        fair_value_comparison_state: "COMPARABLE",
        earlier_fair_value_raw: "98",
        later_fair_value_raw: "95",
        fair_value_delta: "-3",
        earlier_fair_value_currency_state: "FROM_FILING",
        later_fair_value_currency_state: "FROM_FILING",
      }),
    ]);
    expect(types(valuation)).toEqual(["VALUATION_CHANGED"]);
    expect((valuation[0]?.payload as ValuationChangedPayload).fair_value_delta).toBe("-3");

    const maturity = portfolioCreditIntelligence([
      row({
        maturity_comparison_state: "COMPARABLE",
        maturity_changed: true,
        earlier_maturity_raw: "2027-01-01",
        later_maturity_raw: "2028-01-01",
      }),
    ]);
    expect(types(maturity)).toEqual(["MATURITY_CHANGED"]);
    expect(JSON.stringify(maturity[0]?.payload)).not.toMatch(/precision|maturity_date/);
    expect((maturity[0]?.payload as MaturityChangedPayload).maturity_changed).toBe(true);
  });

  it("can emit all three subtype events from one EXISTING row", () => {
    const events = portfolioCreditIntelligence([
      row({
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
    ]);
    expect(types(events)).toEqual(["POSITION_CHANGED", "VALUATION_CHANGED", "MATURITY_CHANGED"]);
    expect(events.every((event) => event.timeline_definition === PORTFOLIO_CREDIT_DEFINITION)).toBe(true);
  });

  it("does not emit change events for zero deltas or insufficient data", () => {
    const events = portfolioCreditIntelligence([
      row({
        principal_comparison_state: "COMPARABLE",
        principal_delta: "0",
        earlier_principal_raw: "100",
        later_principal_raw: "100",
        cost_comparison_state: "COMPARABLE",
        cost_delta: "0.0",
        earlier_cost_raw: "90",
        later_cost_raw: "90",
        fair_value_comparison_state: "INSUFFICIENT_DATA",
        fair_value_delta: "-3",
        maturity_comparison_state: "INSUFFICIENT_DATA",
        maturity_changed: true,
      }),
    ]);
    expect(events).toHaveLength(0);
  });

  it("maps NEW_POSITION_OBSERVED and POSITION_NO_LONGER_OBSERVED", () => {
    const events = portfolioCreditIntelligence([
      row({
        change_type: "NEW_POSITION_OBSERVED",
        earlier_position_observation_id: null,
        later_position_observation_id: "30",
        later_principal_raw: "50",
        later_fair_value_raw: "49",
        later_maturity_raw: "2029-01-01",
      }),
      row({
        change_type: "POSITION_NO_LONGER_OBSERVED",
        position_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        borrower_name_raw: "Absent Borrower",
        earlier_position_observation_id: "20",
        later_position_observation_id: null,
        earlier_principal_raw: "40",
        earlier_fair_value_raw: "39",
        earlier_maturity_raw: "2026-01-01",
      }),
    ]);
    expect(types(events)).toEqual(["NEW_POSITION_OBSERVED", "POSITION_NO_LONGER_OBSERVED"]);
    expect(events[0]?.report_date).toBe("2024-06-30");
    expect(events[1]?.report_date).toBe("2023-12-31");
    expect(JSON.stringify(events[0]?.payload)).toContain(NEW_POSITION_OBSERVED_NOTE);
    expect(JSON.stringify(events[1]?.payload)).toContain(NO_LONGER_OBSERVED_NOTE);
  });

  it("avoids origination, repayment, refinancing, and rate-field events", () => {
    expect(PORTFOLIO_CREDIT_NOTE).toMatch(/not an origination/);
    expect(PORTFOLIO_CREDIT_NOTE).toMatch(/not a repayment/);
    expect(PORTFOLIO_CREDIT_NOTE).toMatch(/not a refinancing/);
    expect(PORTFOLIO_CREDIT_NOTE).not.toMatch(/\b(deterioration|improvement|score|rank)\b/i);
    const events = portfolioCreditIntelligence([
      row({
        principal_comparison_state: "COMPARABLE",
        principal_delta: "1",
        earlier_principal_raw: "1",
        later_principal_raw: "2",
        maturity_comparison_state: "COMPARABLE",
        maturity_changed: true,
        earlier_maturity_raw: "2027-01-01",
        later_maturity_raw: "2028-01-01",
      }),
      row({ change_type: "NEW_POSITION_OBSERVED", later_position_observation_id: "31" }),
      row({
        change_type: "POSITION_NO_LONGER_OBSERVED",
        earlier_position_observation_id: "21",
        later_position_observation_id: null,
      }),
    ]);
    expect(types(events)).not.toContain("REFINANCING_OUTCOME");
    expect(JSON.stringify(events)).not.toMatch(/interest_rate|interest_rate_floor/);
    expect(JSON.stringify(events)).not.toMatch(/"field":"(spread|rate|floor)"/);
    expect(JSON.stringify(events)).not.toMatch(/\b(deterioration|improvement)\b/i);
    expect(types(events)).toContain("NEW_POSITION_OBSERVED");
    expect(types(events)).toContain("POSITION_NO_LONGER_OBSERVED");
  });

  it("links only valid legal_entity_id values", () => {
    expect(isLinkableLegalEntityId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(LEGAL_ENTITY_ID.test("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isLinkableLegalEntityId(null)).toBe(false);
    expect(isLinkableLegalEntityId("not-a-uuid")).toBe(false);
    const linked = portfolioCreditIntelligence([
      row({
        principal_comparison_state: "COMPARABLE",
        principal_delta: "1",
        earlier_principal_raw: "1",
        later_principal_raw: "2",
      }),
    ]);
    expect(linked[0]?.legal_entity_id).toBe("11111111-1111-4111-8111-111111111111");
    const unlinked = portfolioCreditIntelligence([
      row({
        legal_entity_id: null,
        principal_comparison_state: "COMPARABLE",
        principal_delta: "1",
        earlier_principal_raw: "1",
        later_principal_raw: "2",
      }),
    ]);
    expect(unlinked[0]?.legal_entity_id).toBeNull();
    expect(isLinkableLegalEntityId(unlinked[0]?.legal_entity_id ?? null)).toBe(false);
  });

  it("orders by report date, event type, borrower, position, and observation id", () => {
    const events = portfolioCreditIntelligence([
      row({
        change_type: "POSITION_NO_LONGER_OBSERVED",
        borrower_name_raw: "Zed",
        position_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        earlier_position_observation_id: "10",
        later_position_observation_id: null,
      }),
      row({
        change_type: "NEW_POSITION_OBSERVED",
        borrower_name_raw: "Ann",
        position_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        earlier_position_observation_id: null,
        later_position_observation_id: "40",
      }),
      row({
        borrower_name_raw: "Ann",
        position_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        later_position_observation_id: "50",
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
    ]);
    expect(types(events)).toEqual([
      "POSITION_CHANGED",
      "VALUATION_CHANGED",
      "MATURITY_CHANGED",
      "NEW_POSITION_OBSERVED",
      "POSITION_NO_LONGER_OBSERVED",
    ]);
    expect(events.map((event) => event.report_date)).toEqual([
      "2024-06-30",
      "2024-06-30",
      "2024-06-30",
      "2024-06-30",
      "2023-12-31",
    ]);
  });
});
