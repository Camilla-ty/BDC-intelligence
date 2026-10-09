import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PositionComparisonRow } from "@/lib/borrower-comparisons";

describe("loadComparisonFieldTrace SQL", () => {
  const loader = readFileSync(join(import.meta.dirname, "load-borrowers.ts"), "utf8");

  it("reads current field heads for comparison observation ids", () => {
    expect(loader).toMatch(/obs\.current_position_field_value/);
    expect(loader).toMatch(/PRINCIPAL_AMOUNT/);
    expect(loader).toMatch(/normalization_rule_version_id/);
  });

  it("rejects non-numeric observation ids", async () => {
    const { loadComparisonFieldTrace } = await import("@/server/load-borrowers");
    const row = {
      legal_entity_id: "00000000-0000-4000-8000-000000000001",
      position_id: "00000000-0000-4000-8000-0000000000aa",
      earlier_position_observation_id: "not-numeric",
      later_position_observation_id: "9100000002",
    } as PositionComparisonRow;
    const result = await loadComparisonFieldTrace([row]);
    expect(result.error).toBe("Field trace could not be read.");
    expect(result.rows).toEqual([]);
  });
});
