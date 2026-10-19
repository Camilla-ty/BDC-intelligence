// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  executeSql: vi.fn(),
}));

vi.mock("@/server/sql-text", () => ({ executeSql: mocks.executeSql }));

import { loadLegalEntityIdentifiers } from "@/server/load-borrowers";

const ENTITY = "22da9181-f033-425a-8297-da1a90eb3ff7";

function identifierRow(overrides: Record<string, unknown> = {}) {
  return {
    legal_entity_id: ENTITY,
    scheme: "LEI",
    relationship_role: "OWN",
    raw_value: "549300EXAMPLELEI00001",
    verification_state: "VERIFIED",
    evidence_id: null,
    researcher_citation_url: "https://example.test/lei",
    researcher_citation_title: "LEI citation",
    researcher_citation_excerpt: "The legal entity identifier is 549300EXAMPLELEI00001.",
    ambiguous_verified_own: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadLegalEntityIdentifiers", () => {
  it("reads current tips and the ambiguity view for one canonical legal entity", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify([identifierRow()]),
    });

    const result = await loadLegalEntityIdentifiers(ENTITY);

    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/SET ROLE bdc_reader/);
    expect(sql).toMatch(/FROM identity\.current_legal_entity_identifier c/);
    expect(sql).toMatch(/FROM identity\.ambiguous_verified_own_identifier a/);
    expect(sql).not.toMatch(/FROM identity\.legal_entity_identifier\b/);
    expect(sql).not.toMatch(/borrower_observation_listing/);
    expect(sql).not.toMatch(/registrant_cik/);
    expect(sql).toContain(ENTITY);
    expect(result.error).toBeNull();
    expect(result.rows).toEqual([identifierRow()]);
  });

  it("keeps an empty identifier array empty", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "[]" });
    await expect(loadLegalEntityIdentifiers(ENTITY)).resolves.toEqual({ rows: [], error: null });
  });

  it("keeps both verified OWN values when the ambiguity flag is set", async () => {
    const rows = [
      identifierRow({
        scheme: "CIK",
        raw_value: "0000000001",
        evidence_id: "501",
        researcher_citation_url: null,
        researcher_citation_title: null,
        researcher_citation_excerpt: null,
        ambiguous_verified_own: true,
      }),
      identifierRow({
        scheme: "CIK",
        raw_value: "0000000002",
        evidence_id: "502",
        researcher_citation_url: null,
        researcher_citation_title: null,
        researcher_citation_excerpt: null,
        ambiguous_verified_own: true,
      }),
    ];
    mocks.executeSql.mockResolvedValue({ ok: true, text: JSON.stringify(rows) });
    const result = await loadLegalEntityIdentifiers(ENTITY);
    expect(result.error).toBeNull();
    expect(result.rows.map((row) => row.raw_value)).toEqual(["0000000001", "0000000002"]);
    expect(result.rows.every((row) => row.ambiguous_verified_own)).toBe(true);
  });

  it("returns a failure when the identifier query fails", async () => {
    mocks.executeSql.mockResolvedValue({ ok: false });
    const result = await loadLegalEntityIdentifiers(ENTITY);
    expect(mocks.executeSql).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      rows: [],
      error: "External identifiers could not be read.",
    });
    expect(result.error).not.toBeNull();
  });

  it("rejects a malformed row instead of filling a value", async () => {
    mocks.executeSql.mockResolvedValue({
      ok: true,
      text: JSON.stringify([identifierRow({ raw_value: null })]),
    });
    await expect(loadLegalEntityIdentifiers(ENTITY)).resolves.toEqual({
      rows: [],
      error: "External identifiers could not be read.",
    });
  });

  it("does not query an invalid legal entity id", async () => {
    const result = await loadLegalEntityIdentifiers("not-a-uuid");
    expect(mocks.executeSql).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: [], error: null });
  });
});

describe("borrower detail identifier wiring", () => {
  it("loads identifiers for the canonical legal entity and leaves the listing query unchanged", () => {
    const page = readFileSync(join(process.cwd(), "src/app/borrowers/[id]/page.tsx"), "utf8");
    const loader = readFileSync(join(process.cwd(), "src/server/load-borrowers.ts"), "utf8");
    const listing = readFileSync(join(process.cwd(), "src/app/borrowers/page.tsx"), "utf8");

    expect(page).toMatch(/loadLegalEntityIdentifiers\s*\(\s*scopedId\s*\)/);
    expect(page).not.toMatch(/identity\.legal_entity_identifier/);
    expect(listing).not.toMatch(/loadLegalEntityIdentifiers/);
    expect(loader).toMatch(/FROM identity\.current_legal_entity_identifier c/);
    expect(loader).toMatch(/FROM identity\.ambiguous_verified_own_identifier a/);
    expect(loader).not.toMatch(/FROM identity\.legal_entity_identifier\b/);
    expect(loader).toMatch(/FROM registry\.borrower_observation_listing/);
  });
});
