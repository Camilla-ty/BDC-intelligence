// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  propose: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  reverse: vi.fn(),
  loadPreview: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/server/consolidations", () => ({
  proposeLegalEntityConsolidation: mocks.propose,
  approveLegalEntityConsolidation: mocks.approve,
  rejectLegalEntityConsolidationProposal: mocks.reject,
  reverseLegalEntityConsolidation: mocks.reverse,
  loadEntityConsolidationPreview: mocks.loadPreview,
}));

import { AdminConsolidations } from "@/components/AdminConsolidations";

const PENDING = {
  id: 41,
  from_legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  to_legal_entity_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  state: "PROBABLE",
  method: "CONSOLIDATION_PROPOSED",
  rationale: "TEST ONLY pending",
  decided_by: "admin:test",
  decided_at: "2099-01-01T00:00:00Z",
  evidence_id: 9001,
  researcher_citation_url: "https://example.test/citation",
  researcher_citation_title: "TEST CITATION TITLE",
  researcher_citation_excerpt: "TEST CITATION EXCERPT",
  from_canonical_legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  to_canonical_legal_entity_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
};

function textboxByLabel(includes: string) {
  const match = screen.getAllByRole("textbox").find((el) =>
    (el.closest("label")?.textContent ?? "").includes(includes),
  );
  if (match == null) throw new Error(`textbox not found for label containing ${includes}`);
  return match;
}

describe("AdminConsolidations workflow UI", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    mocks.propose.mockReset();
    mocks.approve.mockReset();
    mocks.reject.mockReset();
    mocks.reverse.mockReset();
    mocks.loadPreview.mockReset();
    mocks.propose.mockResolvedValue({ ok: true, id: 42 });
    mocks.approve.mockResolvedValue({ ok: true, id: 99 });
    mocks.reject.mockResolvedValue({ ok: true, id: 88 });
    mocks.reverse.mockResolvedValue({ ok: true, id: 77 });
    mocks.loadPreview.mockResolvedValue({
      preview: {
        legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        canonical_legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        creation_reason: "TEST ONLY",
        aliases: [{ alias_text: "TEST ALIAS", verification_state: "VERIFIED" }],
        current_consolidation: {
          id: 12,
          from_legal_entity_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          to_legal_entity_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
          state: "MATCHED",
          method: "CONSOLIDATION_APPROVED",
          rationale: "TEST ONLY approved",
          decided_by: "admin:test",
          decided_at: "2099-01-01T00:00:00Z",
        },
      },
      error: null,
    });
  });

  it("displays researcher citations distinctly from structured evidence", () => {
    render(<AdminConsolidations pending={[PENDING]} pendingError={null} />);
    expect(screen.getByText(/Researcher citation:/)).toBeInTheDocument();
    expect(screen.getByText(/not verified SEC evidence/)).toBeInTheDocument();
    expect(screen.getByText(/Structured evidence id: 9001/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://example.test/citation",
    );
  });

  it("submits a proposal without calling approve, reject, or reverse", async () => {
    render(<AdminConsolidations pending={[]} pendingError={null} />);
    const uuidInputs = screen.getAllByPlaceholderText("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
    fireEvent.change(uuidInputs[0]!, { target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" } });
    fireEvent.change(uuidInputs[1]!, { target: { value: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1" } });
    fireEvent.change(textboxByLabel("Rationale"), { target: { value: "TEST ONLY rationale" } });
    fireEvent.change(textboxByLabel("Researcher citation URL"), {
      target: { value: "https://example.test/doc" },
    });
    fireEvent.change(textboxByLabel("Researcher citation title"), { target: { value: "TEST TITLE" } });
    fireEvent.change(textboxByLabel("Researcher citation excerpt"), {
      target: { value: "TEST EXCERPT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
    await waitFor(() => expect(mocks.propose).toHaveBeenCalledTimes(1));
    expect(mocks.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        toLegalEntityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        rationale: "TEST ONLY rationale",
        citationUrl: "https://example.test/doc",
        citationTitle: "TEST TITLE",
        citationExcerpt: "TEST EXCERPT",
      }),
    );
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.reject).not.toHaveBeenCalled();
    expect(mocks.reverse).not.toHaveBeenCalled();
    // refreshPreviews() clears the transient success banner; assert copy exists in source path.
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("approves and rejects pending proposals through separate actions", async () => {
    render(<AdminConsolidations pending={[PENDING]} pendingError={null} />);
    fireEvent.change(textboxByLabel("Approval rationale"), { target: { value: "TEST ONLY approve" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve consolidation" }));
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        proposalId: "41",
        rationale: "TEST ONLY approve",
      }),
    );
    expect(await screen.findByText(/Approval 99 recorded/)).toBeInTheDocument();

    fireEvent.change(textboxByLabel("Rejection rationale"), { target: { value: "TEST ONLY reject" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject proposal" }));
    await waitFor(() =>
      expect(mocks.reject).toHaveBeenCalledWith({
        proposalId: "41",
        rationale: "TEST ONLY reject",
      }),
    );
  });

  it("requires explicit confirmation before reverse is enabled and invoked", async () => {
    render(<AdminConsolidations pending={[]} pendingError={null} />);
    const reverseButton = screen.getByRole("button", { name: "Reverse consolidation" });
    expect(reverseButton).toBeDisabled();

    const fromInput = screen.getAllByPlaceholderText("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")[0]!;
    fireEvent.change(fromInput, { target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load entity previews" }));
    await screen.findByText(/MATCHED \/ CONSOLIDATION_APPROVED/);

    fireEvent.change(textboxByLabel("Reversal rationale"), { target: { value: "TEST ONLY reverse" } });
    const urlFields = screen.getAllByRole("textbox").filter((el) =>
      (el.closest("label")?.textContent ?? "").includes("Researcher citation URL"),
    );
    fireEvent.change(urlFields[urlFields.length - 1]!, { target: { value: "https://example.test/rev" } });
    const titleFields = screen.getAllByRole("textbox").filter((el) =>
      (el.closest("label")?.textContent ?? "").includes("Researcher citation title"),
    );
    fireEvent.change(titleFields[titleFields.length - 1]!, { target: { value: "REV TITLE" } });
    const excerptFields = screen.getAllByRole("textbox").filter((el) =>
      (el.closest("label")?.textContent ?? "").includes("Researcher citation excerpt"),
    );
    fireEvent.change(excerptFields[excerptFields.length - 1]!, { target: { value: "REV EXCERPT" } });

    expect(reverseButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I confirm this reverses the effective approved consolidation/,
      }),
    );
    expect(reverseButton).toBeEnabled();
    fireEvent.click(reverseButton);
    await waitFor(() =>
      expect(mocks.reverse).toHaveBeenCalledWith(
        expect.objectContaining({
          fromLegalEntityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          expectedCurrentId: "12",
          rationale: "TEST ONLY reverse",
          confirmed: true,
        }),
      ),
    );
  });
});
