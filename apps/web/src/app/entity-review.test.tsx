import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/review/entities/geo-parent-corporation",
  useRouter: () => ({ refresh: () => undefined }),
}));

import { EntityReview } from "@/components/EntityReview";
import { Shell } from "@/components/Shell";
import {
  REVIEW_WRITES_ENABLED,
  assembleReview,
  comparisonRows,
  comparisonValue,
  entityReviewCandidate,
  entityReviewSql,
  parseEntityReviewPayload,
  type EntityReviewCandidate,
  type ReviewLine,
  type ReviewPayload,
} from "@/lib/entity-review";
import { EDGAR_ARCHIVES_PREFIX } from "@/lib/portfolios";

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
    filed_date_state: "UNKNOWN",
    filed_date_raw: null,
    inline_url_state: "UNKNOWN",
    inline_url: null,
    document_name: "TEST-ONLY.htm",
    document_url: `${EDGAR_ARCHIVES_PREFIX}9999999901/000000000099000001/TEST-ONLY.htm`,
    ...overrides,
  };
}

describe("entity review candidate", () => {
  it("retrieves the seeded borrower candidate as an open comparison", () => {
    const seeded = entityReviewCandidate("geo-parent-corporation");
    expect(seeded).not.toBeNull();
    expect(seeded?.type).toBe("BORROWER");
    expect(seeded?.status).toBe("OPEN");
    expect(seeded?.source).toBe("MANUAL_SEED");
    expect(seeded?.ruleVersion).toBeNull();
    expect(seeded?.descriptors).toHaveLength(4);
    expect(new Set(seeded?.descriptors).size).toBe(4);
    expect(entityReviewCandidate("missing")).toBeNull();
  });

  it("keeps each seeded source descriptor as its own group", () => {
    const seeded = entityReviewCandidate("geo-parent-corporation");
    const model = assembleReview(seeded!, emptyPayload());
    expect(model.groups.map((group) => group.sourceName)).toEqual(seeded?.descriptors);
    expect(model.groups.every((group) => group.observations.length === 0)).toBe(true);
    expect(model.candidate.status).toBe("OPEN");
    expect(model.writesEnabled).toBe(false);
  });

  it("keeps multiple observations of one descriptor separate", () => {
    const model = assembleReview(candidate(["TEST SOURCE A", "TEST SOURCE B"]), {
      ...emptyPayload(),
      lines: [
        line({ position_observation_id: "9000000001", disclosed_line_text: "TEST SOURCE A" }),
        line({
          position_observation_id: "9000000002",
          disclosed_line_text: "TEST SOURCE A",
          accession_number: "0000000000-99-000002",
          reported_date: "2099-06-30",
        }),
        line({ position_observation_id: "9000000003", disclosed_line_text: "TEST SOURCE B" }),
        line({ position_observation_id: "9000000004", disclosed_line_text: "TEST OTHER" }),
      ],
    });
    expect(model.groups).toHaveLength(2);
    expect(model.groups[0]?.observations.map((item) => item.id)).toEqual(["9000000001", "9000000002"]);
    expect(model.groups[1]?.observations.map((item) => item.id)).toEqual(["9000000003"]);
    const ids = model.groups.flatMap((group) => group.observations.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows unknown and not stored without filling a missing field", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), {
      ...emptyPayload(),
      lines: [line()],
      fields: [
        {
          position_observation_id: "9000000001",
          field_code: "INDUSTRY",
          raw_value: null,
          value_state: "UNKNOWN",
          scale_state: "UNKNOWN",
          source_column_label: null,
        },
      ],
      maturity: [{ position_observation_id: "9000000001", maturity_source: "UNKNOWN", maturity_raw: null }],
    });
    const observation = model.groups[0]?.observations[0];
    expect(observation?.industry).toBe("Unknown");
    expect(observation?.maturity).toBe("Unknown");
    expect(observation?.instrumentType).toBe("Not stored");
    expect(observation?.principal).toBe("Not stored");
    expect(observation?.cost).toBe("Not stored");
    expect(observation?.fairValue).toBe("Not stored");
    expect(observation?.interestRate).toBe("Not stored");
    expect(observation?.spread).toBe("Not stored");
    expect(observation?.percentOfNetAssets).toBe("Not stored");
    expect(model.normalizedName).toBe("Not stored");
    expect(model.legalName).toBe("Not stored");
    expect(model.address).toBe("Not stored");
    expect(model.lei).toBe("Not stored");
    expect(model.issuerCik).toBe("Not stored");
    expect(model.website).toBe("Not stored");
    expect(comparisonValue([])).toBe("No stored observation");
  });

  it("renders unknown text and leaves the decision controls disabled", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    render(<EntityReview model={model} />);
    expect(screen.getByRole("heading", { name: "Entity resolution review" })).toBeInTheDocument();
    expect(screen.getByText(/not a canonical borrower/i)).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not stored").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Borrower identity" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Instrument identity" })).toBeInTheDocument();
    expect(screen.queryByText("RESOLVED_SAME")).not.toBeInTheDocument();
    expect(screen.queryByText("MATCHED")).not.toBeInTheDocument();
    for (const name of ["Same company", "Different companies", "Defer / need more evidence"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText("Review workflow prototype — no Production write")).toBeInTheDocument();
    expect(REVIEW_WRITES_ENABLED).toBe(false);
    expect(model.writesEnabled).toBe(false);
  });

  it("links only a stored SEC filing document", () => {
    const linked = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    const { unmount } = render(<EntityReview model={linked} />);
    const documents = screen.getAllByRole("link", { name: "TEST-ONLY.htm" });
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document).toHaveAttribute("href", `${EDGAR_ARCHIVES_PREFIX}9999999901/000000000099000001/TEST-ONLY.htm`);
    }
    expect(screen.getByText(/Original filing:/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inline filing" })).not.toBeInTheDocument();
    unmount();

    const blocked = assembleReview(candidate(["TEST SOURCE A"]), {
      ...emptyPayload(),
      lines: [line({ document_url: "https://example.test/filing", inline_url_state: "REPORTED", inline_url: "javascript:alert(1)" })],
    });
    render(<EntityReview model={blocked} />);
    expect(screen.queryByRole("link", { name: "TEST-ONLY.htm" })).not.toBeInTheDocument();
    expect(blocked.groups[0]?.observations[0]?.documentUrl).toBeNull();
    expect(blocked.groups[0]?.observations[0]?.inlineUrl).toBeNull();
  });

  it("does not treat different descriptors as one borrower or one instrument", () => {
    const model = assembleReview(candidate(["TEST SOURCE A", "TEST SOURCE B"]), {
      ...emptyPayload(),
      lines: [
        line({ disclosed_line_text: "TEST SOURCE A" }),
        line({ position_observation_id: "9000000002", disclosed_line_text: "TEST SOURCE B", accession_number: "0000000000-99-000002" }),
      ],
    });
    const rows = comparisonRows(model);
    const source = rows.find((row) => row.label === "Source name");
    const instrument = rows.find((row) => row.label === "Instrument resolution");
    const disclosed = rows.find((row) => row.label === "Disclosed line");
    expect(source?.section).toBe("Identity");
    expect(instrument?.section).toBe("Investment");
    expect(source?.values).toEqual(["TEST SOURCE A", "TEST SOURCE B"]);
    expect(disclosed?.values).toEqual(["TEST SOURCE A", "TEST SOURCE B"]);
    expect(instrument?.values).toEqual(["Not yet resolved", "Not yet resolved"]);
    expect(model.legalEntity).toBe("Not yet resolved");
    expect(model.economicGroup).toBe("Not yet resolved");
  });

  it("does not collapse distinct stored values and does not create a decision", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), {
      ...emptyPayload(),
      entityResolutionCount: 0,
      lines: [
        line({ position_observation_id: "9000000001" }),
        line({
          position_observation_id: "9000000002",
          accession_number: "0000000000-99-000002",
        }),
      ],
      fields: [
        {
          position_observation_id: "9000000001",
          field_code: "PRINCIPAL_AMOUNT",
          raw_value: "TEST-AMOUNT-1",
          value_state: "REPORTED",
          scale_state: "KNOWN",
          source_column_label: null,
        },
        {
          position_observation_id: "9000000002",
          field_code: "PRINCIPAL_AMOUNT",
          raw_value: "TEST-AMOUNT-2",
          value_state: "REPORTED",
          scale_state: "KNOWN",
          source_column_label: null,
        },
        {
          position_observation_id: "9000000001",
          field_code: "INTEREST_RATE",
          raw_value: "TEST-RATE",
          value_state: "REPORTED",
          scale_state: "UNRESOLVED",
          source_column_label: "TEST COLUMN",
        },
      ],
    });
    const principal = comparisonRows(model).find((row) => row.label === "Principal");
    expect(principal?.values).toEqual(["Multiple stored values"]);
    expect(model.groups[0]?.observations).toHaveLength(2);
    expect(model.groups[0]?.observations[0]?.interestRate).toBe("TEST-RATE · Scale Unresolved · TEST COLUMN");
    expect(model.groups[0]?.observations[0]?.interestRate).not.toMatch(/%/);
    expect(model.groups[0]?.observations[1]?.interestRate).toBe("Not stored");
    expect(model.candidate.status).toBe("OPEN");
    expect(model.writesEnabled).toBe(false);
  });

  it("reads with a select and rejects a descriptor that could change SQL", () => {
    const seeded = entityReviewCandidate("geo-parent-corporation")!;
    const sql = entityReviewSql(seeded);
    expect(sql).toMatch(/SET ROLE bdc_reader/);
    expect(sql).toMatch(/\bUNION ALL\b/);
    expect(sql).toMatch(/\bSELECT\b/);
    expect(sql).toContain("'PERCENT_OF_NET_ASSETS'");
    expect(sql).toContain("position_observation_id IN (SELECT position_observation_id FROM matched)");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|COPY|CREATE|ALTER|DROP|TRUNCATE|GRANT)\b/i);
    for (const scope of seeded.scopes) {
      expect(sql).toContain(`registrant_cik = '${scope.registrantCik}'`);
      expect(sql).toContain(`reported_date = '${scope.reportedDate}'`);
    }
    expect(sql).not.toMatch(/\bLIKE\b/i);
    expect(sql).not.toMatch(/bdc_pipeline_writer/);
    for (const name of seeded.descriptors) expect(sql).toContain(`'${name}'`);
    expect(() => entityReviewSql(candidate(["TEST; DELETE FROM identity.legal_entity"]))).toThrow(/cannot be queried/);
    expect(() => entityReviewSql({ ...candidate(["TEST SOURCE A"]), scopes: [] })).toThrow(/cannot be queried/);
    expect(() => entityReviewSql({ ...candidate(["TEST SOURCE A"]), scopes: [{ registrantCik: "1", reportedDate: "2099-03-31" }] })).toThrow(/cannot be queried/);
    const quoted = entityReviewSql(candidate(["TEST SOURCE O'BRIEN"]));
    expect(quoted).toContain("'TEST SOURCE O''BRIEN'");
    expect(() => parseEntityReviewPayload({ lines: [] })).toThrow();
    const unavailable = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), entityResolutionCount: 4, groupMembershipCount: 2 });
    expect(unavailable.legalEntity).toBe("Not available to this read model");
    expect(unavailable.economicGroup).toBe("Not available to this read model");
  });

  it("offers the review queue without marking the candidate resolved", () => {
    const seeded = entityReviewCandidate("geo-parent-corporation")!;
    render(<Shell><EntityReview model={assembleReview(seeded, emptyPayload())} /></Shell>);
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/review/entities");
    expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Entity resolution review", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("OPEN · Researcher review required")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Same company" })[0]).toBeDisabled();
  });

  it("shows a stored review case without write controls", () => {
    const model = assembleReview(candidate(["TEST SOURCE A"]), { ...emptyPayload(), lines: [line()] });
    render(<EntityReview model={model} durable={{
      deployed: true,
      candidate: {
        candidateId: "1",
        caseKey: "test-candidate",
        title: "TEST SOURCE",
        status: "OPEN",
        members: [{ positionObservationId: "9000000001", evidenceId: "1", disclosedLine: "TEST SOURCE A" }],
        state: {
          candidateId: "1",
          items: [],
          notes: [],
          sets: [],
          decisions: [],
          legalEntitiesCreated: 0,
          resolutionDecisionsCreated: 0,
          ingestionRunsCreated: 0,
          parserRulesModified: 0,
          productionWrites: 0,
          persisted: false,
        },
      },
    }} />);
    expect(screen.getByText("Review case")).toBeInTheDocument();
    expect(screen.getByText("This is a review case. Resolution has not been decided.")).toBeInTheDocument();
    expect(screen.getByText("OPEN · Resolution has not been decided")).toBeInTheDocument();
    expect(screen.getByText("TEST SOURCE A · Observation 9000000001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cite observation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add research evidence" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open local review candidate" })).not.toBeInTheDocument();
    for (const name of ["Same company", "Different companies", "Defer / need more evidence"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });
});
