import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  executeSql: vi.fn(),
}));

vi.mock("@/server/auth/access", () => ({
  requireAdmin: mocks.requireAdmin,
  requireAuthenticatedUser: mocks.requireAuthenticatedUser,
}));
vi.mock("@/server/sql-text", () => ({ executeSql: mocks.executeSql }));

import {
  approveLegalEntityConsolidation,
  loadCanonicalLegalEntityId,
  loadEntityConsolidationPreview,
  loadPendingConsolidations,
  proposeLegalEntityConsolidation,
  rejectLegalEntityConsolidationProposal,
  reverseLegalEntityConsolidation,
} from "@/server/consolidations";

describe("consolidations server path", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset();
    mocks.requireAuthenticatedUser.mockReset();
    mocks.executeSql.mockReset();
    mocks.requireAdmin.mockResolvedValue({
      user: { id: "11111111-1111-4111-8111-111111111111" },
      isAdmin: true,
      effectiveRole: "ADMIN",
    });
    mocks.requireAuthenticatedUser.mockResolvedValue({
      user: { id: "11111111-1111-4111-8111-111111111111" },
      isAdmin: false,
      effectiveRole: "MEMBER",
    });
  });

  it("loadCanonicalLegalEntityId requires authentication and does not invent ids", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "" });
    const result = await loadCanonicalLegalEntityId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(result).toEqual({ canonicalId: null, error: null });
    expect(mocks.requireAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/SET ROLE bdc_reader/);
    expect(sql).toMatch(/canonical_legal_entity/);
  });

  it("denies unauthenticated canonical-ID invocation", async () => {
    mocks.requireAuthenticatedUser.mockRejectedValue(new Error("redirect"));
    await expect(
      loadCanonicalLegalEntityId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
    ).rejects.toThrow("redirect");
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("Admin preview and pending list use admin_reader after requireAdmin", async () => {
    mocks.executeSql
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({
          legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          canonical_legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          creation_reason: "TEST",
          aliases: [],
          current_consolidation: null,
        }),
      })
      .mockResolvedValueOnce({ ok: true, text: "[]" });
    const preview = await loadEntityConsolidationPreview("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(preview.error).toBeNull();
    expect(preview.preview?.legal_entity_id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1");
    expect(String(mocks.executeSql.mock.calls[0]?.[0] ?? "")).toMatch(/SET ROLE admin_reader/);
    expect(String(mocks.executeSql.mock.calls[0]?.[0] ?? "")).not.toMatch(/SET ROLE bdc_reader/);

    const pending = await loadPendingConsolidations();
    expect(pending.error).toBeNull();
    expect(pending.rows).toEqual([]);
    expect(String(mocks.executeSql.mock.calls[1]?.[0] ?? "")).toMatch(/SET ROLE admin_reader/);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(2);
  });

  it("proposal requires Admin and does not call approve SQL", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "42" });
    const result = await proposeLegalEntityConsolidation({
      fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      toLegalEntityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      rationale: "TEST ONLY rationale",
      evidenceId: "",
      citationUrl: "https://example.test/doc",
      citationTitle: "TEST TITLE",
      citationExcerpt: "TEST EXCERPT",
      expectedCurrentId: "",
    });
    expect(result).toEqual({ ok: true, id: 42 });
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/SET ROLE resolution_writer/);
    expect(sql).toMatch(/propose_legal_entity_consolidation/);
    expect(sql).not.toMatch(/approve_legal_entity_consolidation/);
    expect(sql).toMatch(/admin:11111111-1111-4111-8111-111111111111/);
    expect(sql).toMatch(/,\s*NULL\s*\)::text/);
  });

  it("propose with empty expectedCurrentId still sends NULL to SQL (DB enforces stale MATCHED head)", async () => {
    mocks.executeSql.mockResolvedValue({ ok: false, text: "" });
    const result = await proposeLegalEntityConsolidation({
      fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      toLegalEntityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      rationale: "TEST ONLY stale empty expected",
      evidenceId: "",
      citationUrl: "https://example.test/doc",
      citationTitle: "T",
      citationExcerpt: "E",
      expectedCurrentId: "",
    });
    expect(result.ok).toBe(false);
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/propose_legal_entity_consolidation/);
    // Empty expectedCurrentId becomes SQL NULL; MATCHED head makes this BDCS2 in the database.
    // \s already matches newlines; avoid /s (unsupported under tsconfig target ES2017).
    expect(sql).toMatch(/,\s*NULL\s*\)::text/);
  });

  it("rejects self-consolidation before SQL", async () => {
    const result = await proposeLegalEntityConsolidation({
      fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      toLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      rationale: "TEST",
      evidenceId: "",
      citationUrl: "https://example.test/doc",
      citationTitle: "T",
      citationExcerpt: "E",
      expectedCurrentId: "",
    });
    expect(result.ok).toBe(false);
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("approval is a separate Admin write", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "99" });
    const result = await approveLegalEntityConsolidation({
      proposalId: "7",
      rationale: "TEST ONLY approve",
    });
    expect(result).toEqual({ ok: true, id: 99 });
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/approve_legal_entity_consolidation/);
    expect(sql).toMatch(/SET ROLE resolution_writer/);
  });

  it("denies propose when requireAdmin rejects", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("notFound"));
    await expect(
      proposeLegalEntityConsolidation({
        fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        toLegalEntityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        rationale: "TEST",
        evidenceId: "",
        citationUrl: "https://example.test/doc",
        citationTitle: "T",
        citationExcerpt: "E",
        expectedCurrentId: "",
      }),
    ).rejects.toThrow("notFound");
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("rejects reversal without explicit confirmation", async () => {
    const result = await reverseLegalEntityConsolidation({
      fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      expectedCurrentId: "12",
      rationale: "TEST ONLY reverse",
      evidenceId: "",
      citationUrl: "https://example.test/doc",
      citationTitle: "T",
      citationExcerpt: "E",
      confirmed: false,
    });
    expect(result.ok).toBe(false);
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("reverses through the helper as resolution_writer", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "77" });
    const result = await reverseLegalEntityConsolidation({
      fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      expectedCurrentId: "12",
      rationale: "TEST ONLY reverse",
      evidenceId: "",
      citationUrl: "https://example.test/doc",
      citationTitle: "T",
      citationExcerpt: "E",
      confirmed: true,
    });
    expect(result).toEqual({ ok: true, id: 77 });
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/SET ROLE resolution_writer/);
    expect(sql).toMatch(/reverse_legal_entity_consolidation/);
    expect(sql).not.toMatch(/INSERT INTO resolution\.legal_entity_consolidation_decision/);
  });

  it("rejects a pending proposal through the helper", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "88" });
    const result = await rejectLegalEntityConsolidationProposal({
      proposalId: "9",
      rationale: "TEST ONLY reject",
    });
    expect(result).toEqual({ ok: true, id: 88 });
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/reject_legal_entity_consolidation_proposal/);
  });

  it("denies approve when requireAdmin rejects", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("notFound"));
    await expect(
      approveLegalEntityConsolidation({ proposalId: "7", rationale: "TEST ONLY approve" }),
    ).rejects.toThrow("notFound");
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("denies reject when requireAdmin rejects", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("notFound"));
    await expect(
      rejectLegalEntityConsolidationProposal({ proposalId: "9", rationale: "TEST ONLY reject" }),
    ).rejects.toThrow("notFound");
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("denies reverse when requireAdmin rejects", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("notFound"));
    await expect(
      reverseLegalEntityConsolidation({
        fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        expectedCurrentId: "12",
        rationale: "TEST ONLY reverse",
        evidenceId: "",
        citationUrl: "https://example.test/doc",
        citationTitle: "T",
        citationExcerpt: "E",
        confirmed: true,
      }),
    ).rejects.toThrow("notFound");
    expect(mocks.executeSql).not.toHaveBeenCalled();
  });

  it("proposal SQL never calls approve, reject, or reverse helpers", async () => {
    mocks.executeSql.mockResolvedValue({ ok: true, text: "42" });
    await proposeLegalEntityConsolidation({
      fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      toLegalEntityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      rationale: "TEST ONLY rationale",
      evidenceId: "",
      citationUrl: "https://example.test/doc",
      citationTitle: "TEST TITLE",
      citationExcerpt: "TEST EXCERPT",
      expectedCurrentId: "",
    });
    const sql = String(mocks.executeSql.mock.calls[0]?.[0] ?? "");
    expect(sql).toMatch(/propose_legal_entity_consolidation/);
    expect(sql).not.toMatch(/approve_legal_entity_consolidation/);
    expect(sql).not.toMatch(/reject_legal_entity_consolidation_proposal/);
    expect(sql).not.toMatch(/reverse_legal_entity_consolidation/);
  });
});
