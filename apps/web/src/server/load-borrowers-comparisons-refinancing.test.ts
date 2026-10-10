// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeSql: vi.fn(),
}));

vi.mock("@/server/sql-text", () => ({ executeSql: mocks.executeSql }));

import {
  loadBorrowerComparisonsAndRefinancing,
  loadBorrowerPositionComparisons,
  loadBorrowerRefinancingOutcomes,
} from "@/server/load-borrowers";

const ENTITY = "111eedd6-56f2-482c-a1c0-b96cd86a86e4";

const COMPARISON_ROW = {
  legal_entity_id: ENTITY,
  position_id: "00000000-0000-4000-8000-0000000000e1",
  earlier_position_observation_id: "9100000001",
  later_position_observation_id: "9100000002",
  earlier_reported_date: "2099-03-31",
  later_reported_date: "2099-09-30",
  earlier_accession_number: "0000000000-99-000001",
  later_accession_number: "0000000000-99-000002",
  earlier_observation_evidence_id: "501",
  later_observation_evidence_id: "502",
  earlier_observation_evidence_level: "L1_STRUCTURED_DATASET",
  later_observation_evidence_level: "L2_ORIGINAL_FILING",
  earlier_registrant_cik: "0000000001",
  earlier_registrant_link_status: "LINKED",
  later_registrant_cik: "0000000001",
  later_registrant_link_status: "LINKED",
  principal_comparison_state: "COMPARABLE",
  earlier_principal_raw: "100",
  later_principal_raw: "120",
  principal_delta: "20",
  earlier_principal_currency_state: "UNKNOWN",
  later_principal_currency_state: "UNKNOWN",
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
  maturity_comparison_state: "COMPARABLE",
  maturity_changed: true,
  earlier_maturity_raw: "12/2099",
  later_maturity_raw: "06/2100",
  earlier_maturity_precision: "MONTH",
  later_maturity_precision: "MONTH",
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
};

const REFINANCING_ROW = {
  legal_entity_id: ENTITY,
  position_id: "00000000-0000-4000-8000-0000000000e1",
  instrument_id: "00000000-0000-4000-8000-0000000000e2",
  instrument_resolution_state: "MATCHED",
  continuity_state: "MATCHED",
  instrument_type_state: "UNKNOWN",
  instrument_type_raw: null,
  earlier_position_observation_id: "9100000001",
  later_position_observation_id: "9100000002",
  earlier_reported_date: "2099-03-31",
  later_reported_date: "2099-09-30",
  event_date: null,
  event_type: "MATURITY_CHANGED",
  refinancing_outcome_state: "UNKNOWN",
  earlier_maturity_raw: "12/2099",
  later_maturity_raw: "06/2100",
  earlier_maturity_precision: "MONTH",
  later_maturity_precision: "MONTH",
  earlier_principal_state: "UNKNOWN",
  earlier_principal_raw: null,
  earlier_principal_currency_state: null,
  earlier_principal_currency_code: null,
  later_principal_state: "REPORTED",
  later_principal_raw: "40",
  later_principal_currency_state: "FROM_FILING",
  later_principal_currency_code: "AAA",
  earlier_accession_number: "0000000000-99-000001",
  later_accession_number: "0000000000-99-000002",
  earlier_observation_evidence_id: "501",
  later_observation_evidence_id: "502",
  earlier_observation_evidence_level: "L1_STRUCTURED_DATASET",
  later_observation_evidence_level: "L2_ORIGINAL_FILING",
  registrant_cik: "0000000001",
  registrant_link_status: "LINKED",
  outcome_definition: "refinancing.outcome_history.v1",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadBorrowerComparisonsAndRefinancing", () => {
  it("reads entity-scoped comparisons and refinancing through the established readers once", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        comparisons: [COMPARISON_ROW],
        refinancing: [REFINANCING_ROW],
      }),
    });

    const result = await loadBorrowerComparisonsAndRefinancing(ENTITY);

    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/registry\.borrower_position_comparisons\('/);
    expect(sql).toMatch(/registry\.borrower_refinancing_outcomes\('/);
    expect(sql).toContain(ENTITY);
    expect(sql).toMatch(/::uuid/);
    expect(sql).toMatch(/json_build_object/);
    expect(sql).not.toMatch(/borrower_comparisons_and_refinancing/);

    expect(result.comparisons.error).toBeNull();
    expect(result.refinancing.error).toBeNull();
    expect(result.comparisons.rows).toHaveLength(1);
    expect(result.refinancing.rows).toHaveLength(1);
    expect(result.comparisons.rows[0]?.maturity_changed).toBe(true);
    expect(result.comparisons.rows[0]).toMatchObject({
      legal_entity_id: ENTITY,
      principal_comparison_state: "COMPARABLE",
      principal_delta: "20",
      cost_comparison_state: "INSUFFICIENT_DATA",
      earlier_accession_number: "0000000000-99-000001",
      later_observation_evidence_id: "502",
    });
    expect(result.refinancing.rows[0]).toMatchObject({
      event_type: "MATURITY_CHANGED",
      refinancing_outcome_state: "UNKNOWN",
      event_date: null,
      outcome_definition: "refinancing.outcome_history.v1",
      later_principal_currency_code: "AAA",
    });
  });

  it("keeps empty comparison and refinancing arrays empty without inventing rows", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ comparisons: [], refinancing: [] }),
    });

    const result = await loadBorrowerComparisonsAndRefinancing(ENTITY);
    expect(result.comparisons).toEqual({ rows: [], error: null });
    expect(result.refinancing).toEqual({ rows: [], error: null });
  });

  it("rejects an invalid entity id without querying", async () => {
    const result = await loadBorrowerComparisonsAndRefinancing("not-a-uuid");
    expect(mocks.executeSql).not.toHaveBeenCalled();
    expect(result.comparisons.error).toBe("The position comparisons could not be read.");
    expect(result.refinancing.error).toBe("The refinancing outcomes could not be read.");
    expect(result.comparisons.rows).toEqual([]);
    expect(result.refinancing.rows).toEqual([]);
  });

  it("compat wrappers reuse the entity-scoped combined read path", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ comparisons: [COMPARISON_ROW], refinancing: [] }),
    });
    const comparisons = await loadBorrowerPositionComparisons(ENTITY);
    expect(comparisons.rows).toHaveLength(1);
    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/borrower_position_comparisons/);

    mocks.executeSql.mockClear();
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({ comparisons: [], refinancing: [REFINANCING_ROW] }),
    });
    const refinancing = await loadBorrowerRefinancingOutcomes(ENTITY);
    expect(refinancing.rows).toHaveLength(1);
    expect(refinancing.rows[0]?.event_type).toBe("MATURITY_CHANGED");
    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
  });

  it("keeps COMPARABLE and INSUFFICIENT_DATA principal outcomes without inventing deltas", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify({
        comparisons: [
          COMPARISON_ROW,
          {
            ...COMPARISON_ROW,
            later_position_observation_id: "9100000003",
            principal_comparison_state: "INSUFFICIENT_DATA",
            principal_delta: null,
            earlier_principal_raw: "100",
            later_principal_raw: null,
          },
        ],
        refinancing: [],
      }),
    });
    const result = await loadBorrowerComparisonsAndRefinancing(ENTITY);
    expect(result.comparisons.rows).toHaveLength(2);
    expect(result.comparisons.rows[0]).toMatchObject({
      principal_comparison_state: "COMPARABLE",
      principal_delta: "20",
    });
    expect(result.comparisons.rows[1]).toMatchObject({
      principal_comparison_state: "INSUFFICIENT_DATA",
      principal_delta: null,
      later_principal_raw: null,
    });
  });
});

describe("borrower detail entity-scoped comparison wiring", () => {
  it("uses the combined loader once against the established entity-scoped readers", () => {
    const page = readFileSync(join(process.cwd(), "src/app/borrowers/[id]/page.tsx"), "utf8");
    const loader = readFileSync(join(process.cwd(), "src/server/load-borrowers.ts"), "utf8");

    expect(page.match(/loadBorrowerComparisonsAndRefinancing/g)).toHaveLength(2);
    expect(page).not.toMatch(/loadBorrowerPositionComparisons/);
    expect(page).not.toMatch(/loadBorrowerRefinancingOutcomes/);

    expect(loader).toMatch(/registry\.borrower_position_comparisons/);
    expect(loader).toMatch(/registry\.borrower_refinancing_outcomes/);
    expect(loader).not.toMatch(/borrower_comparisons_and_refinancing/);
  });
});
