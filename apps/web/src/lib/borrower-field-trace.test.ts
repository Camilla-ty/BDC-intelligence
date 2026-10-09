import { describe, expect, it } from "vitest";
import { positionComparisons, type PositionComparisonRow } from "@/lib/borrower-comparisons";
import {
  enrichComparisonsWithFieldTrace,
  TRACE_MULTIPLE_HEADS,
  TRACE_UNAVAILABLE,
  type FieldValueTraceRow,
} from "@/lib/borrower-field-trace";
import type { ObservationRow } from "@/lib/borrowers";

const ID = "00000000-0000-4000-8000-000000000001";
const EARLIER = "9100000001";
const LATER = "9100000002";

function comparison(overrides: Partial<PositionComparisonRow> = {}): PositionComparisonRow {
  return {
    legal_entity_id: ID,
    position_id: "00000000-0000-4000-8000-0000000000aa",
    earlier_position_observation_id: EARLIER,
    later_position_observation_id: LATER,
    earlier_reported_date: "2099-03-31",
    later_reported_date: "2099-06-30",
    earlier_accession_number: "0000000000-99-000001",
    later_accession_number: "0000000000-99-000002",
    earlier_observation_evidence_id: "501",
    later_observation_evidence_id: "502",
    earlier_observation_evidence_level: "L1_STRUCTURED_DATASET",
    later_observation_evidence_level: "L2_ORIGINAL_FILING",
    earlier_registrant_cik: "9999999901",
    earlier_registrant_link_status: "LINKED",
    later_registrant_cik: "9999999901",
    later_registrant_link_status: "LINKED",
    principal_comparison_state: "COMPARABLE",
    earlier_principal_raw: "100",
    later_principal_raw: "120",
    principal_delta: "20",
    earlier_principal_currency_state: "FROM_FILING",
    later_principal_currency_state: "FROM_FILING",
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
    acquisition_comparison_state: "INSUFFICIENT_DATA",
    earlier_acquisition_raw: null,
    later_acquisition_raw: null,
    earlier_acquisition_precision: null,
    later_acquisition_precision: null,
    earlier_acquisition_date: null,
    later_acquisition_date: null,
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

const listings: ObservationRow[] = [];

describe("enrichComparisonsWithFieldTrace", () => {
  it("links a field with valid source evidence on each side", () => {
    const trace: FieldValueTraceRow[] = [
      {
        position_observation_id: EARLIER,
        field_code: "PRINCIPAL_AMOUNT",
        raw_value: "100",
        normalized_numeric: "100",
        currency_code: "USD",
        currency_state: "FROM_FILING",
        scale_state: "UNITS",
        evidence_id: "9199307",
        normalization_rule_version_id: "42",
      },
      {
        position_observation_id: LATER,
        field_code: "PRINCIPAL_AMOUNT",
        raw_value: "120",
        normalized_numeric: "120",
        currency_code: "USD",
        currency_state: "FROM_FILING",
        scale_state: "UNITS",
        evidence_id: "9199308",
        normalization_rule_version_id: "42",
      },
    ];
    const enriched = enrichComparisonsWithFieldTrace(
      positionComparisons([comparison()], listings, ID),
      trace,
    );
    const principal = enriched[0]?.fields.find((field) => field.label === "Principal");
    expect(principal?.earlierTrace).toMatchObject({
      observedValue: "100",
      normalizedValue: "100",
      currencyCode: "USD",
      fieldEvidenceId: "9199307",
      normalizationRuleVersionId: "42",
    });
    expect(principal?.laterTrace).toMatchObject({
      fieldEvidenceId: "9199308",
    });
  });

  it("marks missing field rows as unavailable evidence and normalization", () => {
    const enriched = enrichComparisonsWithFieldTrace(
      positionComparisons([comparison()], listings, ID),
      [],
    );
    const principal = enriched[0]?.fields.find((field) => field.label === "Principal");
    expect(principal?.earlierTrace).toMatchObject({
      fieldEvidenceId: TRACE_UNAVAILABLE,
      normalizationRuleVersionId: TRACE_UNAVAILABLE,
      normalizedValue: TRACE_UNAVAILABLE,
      currencyCode: TRACE_UNAVAILABLE,
    });
  });

  it("shows raw and normalized when both are stored on the same field row", () => {
    const trace: FieldValueTraceRow[] = [{
      position_observation_id: EARLIER,
      field_code: "PRINCIPAL_AMOUNT",
      raw_value: "1,000",
      normalized_numeric: "1000",
      currency_code: "USD",
      currency_state: "FROM_FILING",
      scale_state: "THOUSANDS",
      evidence_id: "9001",
      normalization_rule_version_id: "7",
    }];
    const principal = enrichComparisonsWithFieldTrace(
      positionComparisons([comparison({ earlier_principal_raw: "1,000" })], listings, ID),
      trace,
    )[0]?.fields.find((field) => field.label === "Principal");
    expect(principal?.earlierTrace?.observedValue).toBe("1,000");
    expect(principal?.earlierTrace?.normalizedValue).toBe("1000");
  });

  it("keeps transformation provenance unavailable when rule version is absent on the row", () => {
    const trace: FieldValueTraceRow[] = [{
      position_observation_id: LATER,
      field_code: "PRINCIPAL_AMOUNT",
      raw_value: "120",
      normalized_numeric: "120",
      currency_code: "USD",
      currency_state: "FROM_FILING",
      scale_state: "UNITS",
      evidence_id: "9002",
      normalization_rule_version_id: null,
    }];
    const principal = enrichComparisonsWithFieldTrace(
      positionComparisons([comparison()], listings, ID),
      trace,
    )[0]?.fields.find((field) => field.label === "Principal");
    expect(principal?.laterTrace?.normalizationRuleVersionId).toBe(TRACE_UNAVAILABLE);
    expect(principal?.laterTrace?.fieldEvidenceId).toBe("9002");
  });

  it("does not attach trace to non-amount comparison fields", () => {
    const enriched = enrichComparisonsWithFieldTrace(
      positionComparisons([comparison()], listings, ID),
      [],
    );
    const maturity = enriched[0]?.fields.find((field) => field.label === "Maturity");
    expect(maturity?.earlierTrace).toBeUndefined();
  });

  it("marks multiple current heads unavailable at field level", () => {
    const trace: FieldValueTraceRow[] = [
      {
        position_observation_id: EARLIER,
        field_code: "PRINCIPAL_AMOUNT",
        raw_value: "100",
        normalized_numeric: "100",
        currency_code: "USD",
        currency_state: "FROM_FILING",
        scale_state: "UNITS",
        evidence_id: "9003",
        normalization_rule_version_id: "1",
      },
      {
        position_observation_id: EARLIER,
        field_code: "PRINCIPAL_AMOUNT",
        raw_value: "101",
        normalized_numeric: "101",
        currency_code: "USD",
        currency_state: "FROM_FILING",
        scale_state: "UNITS",
        evidence_id: "9004",
        normalization_rule_version_id: "1",
      },
    ];
    const principal = enrichComparisonsWithFieldTrace(
      positionComparisons([comparison()], listings, ID),
      trace,
    )[0]?.fields.find((field) => field.label === "Principal");
    expect(principal?.earlierTrace?.headNote).toBe(TRACE_MULTIPLE_HEADS);
    expect(principal?.earlierTrace?.fieldEvidenceId).toBe(TRACE_UNAVAILABLE);
  });
});
