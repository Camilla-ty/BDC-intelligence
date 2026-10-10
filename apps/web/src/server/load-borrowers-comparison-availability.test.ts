// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeSql: vi.fn(),
}));

vi.mock("@/server/sql-text", () => ({ executeSql: mocks.executeSql }));

import { loadBorrowerComparisonAvailability } from "@/server/load-borrowers";

const ENTITY_A = "111eedd6-56f2-482c-a1c0-b96cd86a86e4";
const ENTITY_B = "222eedd6-56f2-482c-a1c0-b96cd86a86e4";
const ENTITY_C = "333eedd6-56f2-482c-a1c0-b96cd86a86e4";

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadBorrowerComparisonAvailability", () => {
  it("batches entity-scoped series counts in one borrower_position_comparisons query", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        {
          legal_entity_id: ENTITY_A,
          series_count: 2,
          latest_later_reported_date: "2099-09-30",
        },
        {
          legal_entity_id: ENTITY_B,
          series_count: 0,
          latest_later_reported_date: null,
        },
      ]),
    });

    const result = await loadBorrowerComparisonAvailability([ENTITY_A, ENTITY_B, ENTITY_A]);

    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/registry\.borrower_position_comparisons\(e\.legal_entity_id\)/);
    expect(sql).toMatch(/unnest\(ARRAY\[/);
    expect(sql).toContain(ENTITY_A);
    expect(sql).toContain(ENTITY_B);
    expect(sql).toMatch(/::uuid\[\]/);
    expect(sql).toMatch(/count\(c\.later_position_observation_id\)/);
    expect(sql).toMatch(/max\(c\.later_reported_date\)/);
    expect(sql).not.toMatch(/position_id\s*=/);
    expect(sql).not.toMatch(/alias_text|identifier/i);
    // Deduped: each id appears once in the ARRAY literal.
    expect(sql.match(new RegExp(ENTITY_A, "g"))).toHaveLength(1);

    expect(result.error).toBeNull();
    expect(result.rows).toEqual([
      {
        legal_entity_id: ENTITY_A,
        series_count: 2,
        latest_later_reported_date: "2099-09-30",
      },
      {
        legal_entity_id: ENTITY_B,
        series_count: 0,
        latest_later_reported_date: null,
      },
    ]);
  });

  it("keeps a zero series count distinct from a read failure", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        {
          legal_entity_id: ENTITY_C,
          series_count: 0,
          latest_later_reported_date: null,
        },
      ]),
    });
    const empty = await loadBorrowerComparisonAvailability([ENTITY_C]);
    expect(empty).toEqual({
      rows: [
        {
          legal_entity_id: ENTITY_C,
          series_count: 0,
          latest_later_reported_date: null,
        },
      ],
      error: null,
    });

    mocks.executeSql.mockResolvedValue({ ok: false, text: "" });
    const failed = await loadBorrowerComparisonAvailability([ENTITY_C]);
    expect(failed.error).toBe("Period-comparison availability could not be read.");
    expect(failed.rows).toEqual([]);
  });

  it("rejects invalid entity ids without querying and scopes only by legal-entity UUID", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        {
          legal_entity_id: ENTITY_A,
          series_count: 1,
          latest_later_reported_date: "2099-06-30",
        },
      ]),
    });
    const result = await loadBorrowerComparisonAvailability(["not-a-uuid", ENTITY_A]);
    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain(ENTITY_A);
    expect(sql).not.toContain("not-a-uuid");
    expect(sql).toMatch(/borrower_position_comparisons\(e\.legal_entity_id\)/);
    expect(sql).not.toMatch(/WHERE\s+position_id|alias_text\s*=/i);
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);

    mocks.executeSql.mockClear();
    const none = await loadBorrowerComparisonAvailability(["bad", "also-bad"]);
    expect(mocks.executeSql).not.toHaveBeenCalled();
    expect(none).toEqual({ rows: [], error: null });
  });

  it("fails closed on malformed JSON payloads", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "{not-json" });
    expect(await loadBorrowerComparisonAvailability([ENTITY_A])).toEqual({
      rows: [],
      error: "Period-comparison availability could not be read.",
    });

    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify([{ legal_entity_id: ENTITY_A, series_count: -1, latest_later_reported_date: null }]),
    });
    expect(await loadBorrowerComparisonAvailability([ENTITY_A])).toEqual({
      rows: [],
      error: "Period-comparison availability could not be read.",
    });
  });
});

describe("borrower list comparison availability wiring", () => {
  it("loads batched comparison availability from the list page after listing", () => {
    const page = readFileSync(join(process.cwd(), "src/app/borrowers/page.tsx"), "utf8");
    const loader = readFileSync(join(process.cwd(), "src/server/load-borrowers.ts"), "utf8");
    expect(page).toMatch(/loadBorrowerComparisonAvailability/);
    expect(page).toMatch(/attachComparisonAvailability/);
    expect(page).toMatch(/loadBorrowerObservations\s*\(/);
    expect(loader).toMatch(/export async function loadBorrowerComparisonAvailability/);
    expect(loader).toMatch(/registry\.borrower_position_comparisons\(e\.legal_entity_id\)/);
  });
});
