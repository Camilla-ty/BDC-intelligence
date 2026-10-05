import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/review/entities/geo-parent-corporation",
  useRouter: () => ({ refresh: () => undefined }),
}));

import { EntityReview } from "@/components/EntityReview";
import { assembleReview, entityReviewCandidate, type EntityReviewCandidate, type ReviewLine, type ReviewPayload } from "@/lib/entity-review";
import { EDGAR_ARCHIVES_PREFIX } from "@/lib/portfolios";
import {
  DECISION_WRITES_ENABLED,
  NOT_CURRENTLY_EXPOSED,
  READER_GAPS,
  RESEARCHER_ADDED_SOURCE_LABEL,
  RESEARCHER_INTERPRETATION_LABEL,
  SOURCE_FACT_LABEL,
  WORKSPACE_SAFETY,
  addEvidenceSet,
  addExternalEvidence,
  addResearcherNote,
  workspaceFromReview,
} from "@/lib/research-workspace";

function candidate(descriptors: readonly string[]): EntityReviewCandidate {
  return {
    id: "test-candidate",
    type: "BORROWER",
    status: "OPEN",
    source: "MANUAL_SEED",
    ruleVersion: null,
    label: "TEST SOURCE",
    descriptors,
    scopes: [{ registrantCik: "9999999901", reportedDate: "2099-03-31" }],
  };
}

function emptyPayload(): ReviewPayload {
  return { lines: [], fields: [], names: [], instruments: [], maturity: [], entityResolutionCount: 0, groupMembershipCount: 0 };
}

function line(overrides: Partial<ReviewLine> = {}): ReviewLine {
  return {
    position_observation_id: "9000000001",
    registrant_cik: "9999999901",
    reported_date: "2099-03-31",
    disclosed_line_text: "TEST SOURCE A",
    accession_number: "0000000000-99-000001",
    evidence_level: "L1_STRUCTURED_DATASET",
    form_state: "UNKNOWN",
    form_raw: null,
    filed_date_state: "REPORTED",
    filed_date_raw: "2099-05-15",
    inline_url_state: "UNKNOWN",
    inline_url: null,
    document_name: "TEST-ONLY.htm",
    document_url: `${EDGAR_ARCHIVES_PREFIX}9999999901/000000000099000001/TEST-ONLY.htm`,
    ...overrides,
  };
}

const draft = {
  questionId: "COMPANY_ADDRESS",
  sourceType: "COMPANY_WEBSITE",
  sourceTitle: "TEST SOURCE TITLE",
  sourceUrl: "https://example.test/source",
  sourceDocumentDate: "2099-04-01",
  relevantExcerpt: "TEST EXCERPT",
  researcherNote: "TEST INTERPRETATION",
  createdBy: "TEST RESEARCHER",
};

describe("research evidence workspace", () => {
  it("displays stored internal evidence and leaves unexposed fields unmarked", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    const workspace = workspaceFromReview(model);
    const item = workspace.items[0];
    expect(item?.origin).toBe("INTERNAL");
    expect(item?.sourceType).toBe("INTERNAL_SEC_FILING");
    expect(item?.relevantExcerpt).toBe("TEST SOURCE A");
    expect(item?.sourceReference).toBe("0000000000-99-000001");
    expect(item?.sourceDocumentDate).toBe("2099-05-15");
    expect(item?.provenance).toEqual({
      candidateId: "test-candidate",
      observationId: "9000000001",
      accessionNumber: "0000000000-99-000001",
      documentUrl: `${EDGAR_ARCHIVES_PREFIX}9999999901/000000000099000001/TEST-ONLY.htm`,
      artifact: NOT_CURRENTLY_EXPOSED,
      locator: NOT_CURRENTLY_EXPOSED,
    });
    expect(item?.retrievedAt).toBeNull();
    expect(item?.createdBy).toBeNull();
    expect(READER_GAPS).toEqual(expect.arrayContaining(["Company-cell text", "Artifact", "Address", "Legal name", "LEI"]));
    render(<EntityReview model={model} />);
    expect(screen.getAllByText(SOURCE_FACT_LABEL).length).toBeGreaterThan(0);
    expect(screen.getAllByText(NOT_CURRENTLY_EXPOSED).length).toBeGreaterThanOrEqual(READER_GAPS.length);
    expect(screen.getByRole("heading", { name: "Research evidence workspace" })).toBeInTheDocument();
  });

  it("represents external evidence without changing the stored observation", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    const before = workspaceFromReview(model);
    const observation = model.groups[0]?.observations[0];
    const added = addExternalEvidence(before, draft, { evidenceId: "ext-1", noteId: "note-1", now: "2099-06-01T00:00:00.000Z" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.workspace.items[0]).toEqual(before.items[0]);
    expect(observation?.sourceName).toBe("TEST SOURCE A");
    expect(observation?.accessionNumber).toBe("0000000000-99-000001");
    const external = added.workspace.items[1];
    expect(external?.origin).toBe("EXTERNAL");
    expect(external?.sourceUrl).toBe("https://example.test/source");
    expect(external?.sourceTitle).toBe("TEST SOURCE TITLE");
    expect(external?.sourceDocumentDate).toBe("2099-04-01");
    expect(external?.retrievedAt).toBe("2099-06-01T00:00:00.000Z");
    expect(external?.relevantExcerpt).toBe("TEST EXCERPT");
    expect(external?.createdBy).toBe("TEST RESEARCHER");
    expect(external?.provenance.locator).toBeNull();
    expect(external?.provenance.artifact).toBeNull();
    expect(external?.provenance.observationId).toBeNull();
    expect(JSON.stringify(external)).not.toContain("TEST INTERPRETATION");
  });

  it("keeps a researcher note apart from the source excerpt", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    const workspace = workspaceFromReview(model);
    const noted = addResearcherNote(workspace, {
      evidenceId: "internal:test-candidate:9000000001",
      text: "TEST INTERPRETATION",
      createdBy: "TEST RESEARCHER",
    }, { noteId: "note-1", now: "2099-06-01T00:00:00.000Z" });
    expect(noted.ok).toBe(true);
    if (!noted.ok) return;
    expect(noted.workspace.items[0]?.relevantExcerpt).toBe("TEST SOURCE A");
    expect(noted.workspace.notes).toEqual([{
      noteId: "note-1",
      candidateId: "test-candidate",
      evidenceId: "internal:test-candidate:9000000001",
      text: "TEST INTERPRETATION",
      createdBy: "TEST RESEARCHER",
      createdAt: "2099-06-01T00:00:00.000Z",
    }]);
    expect(Object.hasOwn(noted.workspace.items[0] ?? {}, "researcherNote")).toBe(false);
    expect(noted.workspace.notes[0]?.text).not.toBe(noted.workspace.items[0]?.relevantExcerpt);
  });

  it("groups evidence in a set without recording a decision", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    const workspace = workspaceFromReview(model);
    const grouped = addEvidenceSet(workspace, {
      title: "TEST EVIDENCE SET",
      evidenceIds: ["internal:test-candidate:9000000001"],
    }, { setId: "set-1" });
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(grouped.workspace.sets).toEqual([{
      setId: "set-1",
      candidateId: "test-candidate",
      title: "TEST EVIDENCE SET",
      evidenceIds: ["internal:test-candidate:9000000001"],
    }]);
    expect(grouped.workspace.decisions).toEqual([]);
    expect(addEvidenceSet(workspace, { title: "TEST EVIDENCE SET", evidenceIds: [] }, { setId: "set-2" }).ok).toBe(false);
  });

  it("does not create a legal entity, resolution, parser change, or ingestion run", () => {
    const seeded = entityReviewCandidate("geo-parent-corporation");
    expect(seeded?.status).toBe("OPEN");
    expect(seeded?.ruleVersion).toBeNull();
    const descriptors = [...(seeded?.descriptors ?? [])];
    const model = assembleReview(seeded!, emptyPayload());
    const workspace = workspaceFromReview(model);
    const added = addExternalEvidence(workspace, { ...draft, researcherNote: "" }, {
      evidenceId: "ext-1",
      noteId: null,
      now: "2099-06-01T00:00:00.000Z",
    });
    expect(added.ok).toBe(true);
    expect(seeded?.status).toBe("OPEN");
    expect(seeded?.descriptors).toEqual(descriptors);
    expect(seeded?.ruleVersion).toBeNull();
    expect(workspace.decisions).toEqual([]);
    expect(workspace.legalEntitiesCreated).toBe(0);
    expect(workspace.resolutionDecisionsCreated).toBe(0);
    expect(workspace.ingestionRunsCreated).toBe(0);
    expect(workspace.parserRulesModified).toBe(0);
    expect(workspace.productionWrites).toBe(0);
    expect(workspace.persisted).toBe(false);
    expect(DECISION_WRITES_ENABLED).toBe(false);
    expect(WORKSPACE_SAFETY.parserRulesModified).toBe(0);
    expect(model.writesEnabled).toBe(false);
    expect(model.legalEntity).toBe("Not yet resolved");
  });

  it("shows an added source, its note, and an evidence set as separate objects", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    render(<EntityReview model={model} />);
    fireEvent.change(screen.getByLabelText("Source title"), { target: { value: "TEST SOURCE TITLE" } });
    fireEvent.change(screen.getByLabelText("Source URL"), { target: { value: "https://example.test/source" } });
    fireEvent.change(screen.getByLabelText("Document date"), { target: { value: "2099-04-01" } });
    fireEvent.change(screen.getByLabelText("Relevant excerpt"), { target: { value: "TEST EXCERPT" } });
    fireEvent.change(screen.getAllByLabelText("Researcher note")[0]!, { target: { value: "TEST INTERPRETATION" } });
    fireEvent.change(screen.getAllByLabelText("Researcher")[0]!, { target: { value: "TEST RESEARCHER" } });
    fireEvent.click(screen.getByRole("button", { name: "Add research evidence" }));
    expect(screen.getByText(RESEARCHER_ADDED_SOURCE_LABEL)).toBeInTheDocument();
    expect(screen.getAllByText("TEST EXCERPT").length).toBeGreaterThan(0);
    expect(screen.getAllByText(RESEARCHER_INTERPRETATION_LABEL).length).toBeGreaterThan(0);
    expect(screen.getByText("TEST INTERPRETATION")).toBeInTheDocument();
    const excerptArticle = screen.getAllByText("TEST EXCERPT").map((node) => node.closest("article")).find((article) => article != null);
    expect(excerptArticle?.textContent).toContain(SOURCE_FACT_LABEL);
    expect(excerptArticle?.textContent).not.toContain("TEST INTERPRETATION");
    fireEvent.click(screen.getByRole("checkbox", { name: /TEST EXCERPT/ }));
    fireEvent.change(screen.getByLabelText("Evidence set name"), { target: { value: "TEST EVIDENCE SET" } });
    fireEvent.click(screen.getByRole("button", { name: "Group selected evidence" }));
    expect(screen.getByRole("heading", { name: "TEST EVIDENCE SET" })).toBeInTheDocument();
    expect(screen.getByText("Not a decision")).toBeInTheDocument();
    for (const name of ["Same company", "Different companies", "Defer / need more evidence"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.queryByText("MATCHED")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save decision" })).not.toBeInTheDocument();
  });
});
