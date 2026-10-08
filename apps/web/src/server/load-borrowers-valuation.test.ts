// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeSql: vi.fn(),
}));

vi.mock("@/server/sql-text", () => ({ executeSql: mocks.executeSql }));

import { loadBorrowerPositionValuation } from "@/server/load-borrowers";

const ENTITY = "22da9181-f033-425a-8297-da1a90eb3ff7";

const VALUATION_ROW = {
  legal_entity_id: ENTITY,
  position_observation_id: "9100000002",
  position_id: "00000000-0000-4000-8000-0000000000e1",
  instrument_id: "00000000-0000-4000-8000-0000000000e2",
  borrower_name_raw: "TEST VALUATION ENTITY | JUN",
  reported_date: "2099-06-30",
  accession_number: "0000000000-99-000002",
  registrant_cik: "0000000001",
  registrant_link_status: "LINKED",
  entity_resolution_state: "MATCHED",
  instrument_resolution_state: "MATCHED",
  continuity_state: "MATCHED",
  instrument_type_state: "REPORTED",
  instrument_type_raw: "TEST FIRST LIEN",
  instrument_type_evidence_level: "L2_ORIGINAL_FILING",
  fair_value_state: "REPORTED",
  fair_value_raw: "60",
  fair_value_numeric: "60",
  fair_value_currency_state: "UNKNOWN",
  fair_value_currency_code: null,
  principal_state: "UNKNOWN",
  principal_raw: null,
  principal_numeric: null,
  principal_currency_state: null,
  principal_currency_code: null,
  cost_state: "UNKNOWN",
  cost_raw: null,
  cost_numeric: null,
  cost_currency_state: null,
  cost_currency_code: null,
  observation_evidence_id: "502",
  observation_evidence_level: "L1_STRUCTURED_DATASET",
  earlier_reported_date: "2099-03-31",
  fair_value_change_state: "COMPARABLE",
  fair_value_delta: "-10",
  fair_value_percentage_state: "COMPARABLE",
  fair_value_percentage: "-14.285714",
  fair_value_to_principal_state: "INSUFFICIENT_DATA",
  fair_value_to_principal: null,
  fair_value_to_cost_state: "INSUFFICIENT_DATA",
  fair_value_to_cost: null,
  cross_bdc_comparison_state: "UNAVAILABLE",
  valuation_definition: "valuation.position_history.v1",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadBorrowerPositionValuation", () => {
  it("calls registry.borrower_position_valuation once and keeps the application row shape", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify([VALUATION_ROW]),
    });

    const result = await loadBorrowerPositionValuation(ENTITY);

    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/registry\.borrower_position_valuation\('/);
    expect(sql).toContain(ENTITY);
    expect(sql).not.toMatch(/borrower_valuation_period_comparison/);
    expect(sql).toMatch(/json_agg\(row_to_json/);

    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      legal_entity_id: ENTITY,
      position_observation_id: "9100000002",
      fair_value_change_state: "COMPARABLE",
      fair_value_delta: "-10",
      fair_value_percentage: "-14.285714",
      cross_bdc_comparison_state: "UNAVAILABLE",
      valuation_definition: "valuation.position_history.v1",
      principal_raw: null,
      fair_value_to_principal: null,
    });
  });

  it("keeps an empty valuation array empty without inventing rows", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: JSON.stringify([]) });
    const result = await loadBorrowerPositionValuation(ENTITY);
    expect(result).toEqual({ rows: [], error: null });
    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid entity id without querying", async () => {
    const result = await loadBorrowerPositionValuation("not-a-uuid");
    expect(mocks.executeSql).not.toHaveBeenCalled();
    expect(result).toEqual({
      rows: [],
      error: "The valuation history could not be read.",
    });
  });
});

describe("borrower detail valuation read wiring", () => {
  it("uses one valuation loader call and does not call the scoped comparison helper from app code", () => {
    const page = readFileSync(join(process.cwd(), "src/app/borrowers/[id]/page.tsx"), "utf8");
    const loader = readFileSync(join(process.cwd(), "src/server/load-borrowers.ts"), "utf8");

    expect(page.match(/loadBorrowerPositionValuation/g)).toHaveLength(2);
    expect(loader.match(/borrower_position_valuation/g)?.length).toBeGreaterThanOrEqual(1);
    expect(loader).toMatch(/FROM registry\.borrower_position_valuation/);
    expect(loader).not.toMatch(/borrower_valuation_period_comparison/);
    expect(page).not.toMatch(/borrower_valuation_period_comparison/);
  });
});
