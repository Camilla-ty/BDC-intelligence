import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/borrowers",
}));
import { BorrowerIntelligence } from "@/components/BorrowerIntelligence";
import { BorrowerList } from "@/components/BorrowerList";
import { BorrowerSources } from "@/components/BorrowerSources";
import { Shell } from "@/components/Shell";
import {
  COUNT_NOTE,
  EDGAR_DOCUMENT_PREFIX,
  EMPTY_SEARCH,
  ENTITY_NOTE,
  SEARCH_NOTE,
  VALUATION_NOTE,
  borrowerDetail,
  listBorrowers,
  sourceRows,
  type BorrowerSummary,
  type ObservationRow,
} from "@/lib/borrowers";

const ID = "00000000-0000-4000-8000-000000000001";

function row(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    legal_entity_id: ID,
    alias_text: "TEST BORROWER A",
    verification_state: "VERIFIED",
    entity_resolution_state: "MATCHED",
    entity_resolution_method: "EXACT_NORMALIZED_NAME",
    reported_date: "2099-03-31",
    accession_number: "0000000000-99-000001",
    document_name: "test-filing.htm",
    document_url: `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
    registrant_link_status: "LINKED",
    registrant_cik: "0000000001",
    registrant_name: "TEST BDC ONE",
    instrument_resolution_state: "UNRESOLVED",
    instrument_resolution_method: "UNKNOWN_INSTRUMENT_ATTRIBUTES",
    instrument_type_state: "UNKNOWN",
    event_code: null,
    observation_evidence_level: "L2_ORIGINAL_FILING",
    name_validation_outcome: "PASS",
    ...overrides,
  };
}

describe("borrower retrieval", () => {
  it("lists only supplied entities and filters by the stored name", () => {
    const rows = [
      row(),
      row({
        legal_entity_id: "00000000-0000-4000-8000-000000000002",
        alias_text: "TEST BORROWER B",
        accession_number: "0000000000-99-000002",
      }),
    ];
    expect(listBorrowers(rows, "").map((item) => item.name)).toEqual([
      "TEST BORROWER A",
      "TEST BORROWER B",
    ]);
    expect(listBorrowers(rows, "borrower b").map((item) => item.name)).toEqual(["TEST BORROWER B"]);
    expect(listBorrowers([row({ alias_text: "TEST HOLDINGS" })], "holdco")).toEqual([]);
    expect(listBorrowers([], "").length).toBe(0);
  });

  it("does not render a borrower that was not retrieved", () => {
    render(<BorrowerList borrowers={[]} query="missing" error={null} />);
    expect(screen.getByText(EMPTY_SEARCH)).toBeInTheDocument();
    expect(screen.queryByText(/TEST BORROWER/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fuzzy|probable match/i)).not.toBeInTheDocument();
  });

  it("labels a partial stored-name result as text containment", () => {
    render(<BorrowerList borrowers={[summary("181")]} query="borrow" error={null} />);
    expect(screen.getByText(SEARCH_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/fuzzy/i)).not.toBeInTheDocument();
  });
});

describe("historical observations", () => {
  it("keeps every reported date and does not show a missing quarter as zero", () => {
    const detail = borrowerDetail(
      [
        row({ reported_date: "2099-09-30", accession_number: "0000000000-99-000003" }),
        row({ reported_date: "2099-03-31" }),
      ],
      ID,
    );
    expect(detail?.history.map((item) => item.reportedDate)).toEqual(["2099-03-31", "2099-09-30"]);
    render(<BorrowerIntelligence borrower={detail!} />);
    expect(screen.getByText("2099-03-31")).toBeInTheDocument();
    expect(screen.getByText("2099-09-30")).toBeInTheDocument();
    expect(screen.queryByText("2099-06-30")).not.toBeInTheDocument();
    expect(screen.getByText(/not zero exposure/i)).toBeInTheDocument();
    expect(screen.queryByText(/^0$/)).not.toBeInTheDocument();
  });
});

describe("unknown and unresolved states", () => {
  it("shows unresolved instrument identity and unknown type and registrant", () => {
    const detail = borrowerDetail(
      [row({
        registrant_link_status: "UNKNOWN",
        registrant_cik: null,
        registrant_name: null,
        instrument_type_state: "UNKNOWN",
        instrument_resolution_state: "UNRESOLVED",
      })],
      ID,
    );
    expect(detail?.instrumentState).toBe("Unresolved");
    expect(detail?.instrumentType).toBe("Unknown");
    render(<BorrowerIntelligence borrower={detail!} />);
    const instrument = screen.getByText("Instrument identity").closest("div")?.querySelector("dd");
    expect(instrument).toHaveTextContent("Unresolved · UNKNOWN_INSTRUMENT_ATTRIBUTES");
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.getByText(/Registrant CIK/)).toHaveTextContent("Unknown");
    expect(screen.getByText(/Registrant CIK/).parentElement).toHaveTextContent("Unknown");
    expect(screen.getByText(/CIK identifies the filing registrant, not the borrower/)).toBeInTheDocument();
    expect(document.querySelector(".state-unknown")).toBeTruthy();
    expect(document.querySelector(".state-unresolved")).toBeTruthy();
  });

  it("keeps an unknown registrant link distinct from unresolved instrument identity", () => {
    const detail = borrowerDetail(
      [
        row({
          registrant_link_status: "UNKNOWN",
          registrant_cik: null,
          registrant_name: null,
          accession_number: "0000000000-99-000010",
        }),
        row({
          registrant_link_status: "UNKNOWN",
          registrant_cik: null,
          registrant_name: null,
          accession_number: "0000000000-99-000011",
          reported_date: "2099-06-30",
        }),
      ],
      ID,
    );
    expect(detail?.registrants).toHaveLength(2);
    expect(detail?.registrants.every((item) => item.linkStatus === "Unknown")).toBe(true);
    expect(detail?.instrumentState).toBe("Unresolved");
  });
});

describe("source linkage", () => {
  it("links the accession to the EDGAR document and not to an internal id", () => {
    const sources = sourceRows([row()], ID);
    render(<BorrowerSources id={ID} name="TEST BORROWER A" sources={sources} />);
    const link = screen.getByRole("link", { name: "0000000000-99-000001" });
    expect(link).toHaveAttribute("href", sources[0].documentUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(sources[0].documentUrl?.startsWith(EDGAR_DOCUMENT_PREFIX)).toBe(true);
    expect(screen.getByText("Original EDGAR filing")).toBeInTheDocument();
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
    expect(screen.getByText(/identifier text found in the filing document/i)).toBeInTheDocument();
  });

  it("does not describe a failed name check as unchecked", () => {
    const sources = sourceRows([row({ name_validation_outcome: "FAIL", document_url: null })], ID);
    render(<BorrowerSources id={ID} name="TEST BORROWER A" sources={sources} />);
    expect(screen.getByText("Identifier text was not found in the filing document")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Document URL Unknown");
    expect(screen.queryByRole("link", { name: "0000000000-99-000001" })).not.toBeInTheDocument();
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
  });
});

describe("no fabricated valuation or instrument facts", () => {
  it("does not show cost, fair value, or a matched instrument", () => {
    const detail = borrowerDetail([
      row({ event_code: "REGISTRANT_FIRST_OBSERVED_NAME" }),
    ], ID);
    const { container } = render(<BorrowerIntelligence borrower={detail!} />);
    expect(screen.getByText(VALUATION_NOTE)).toBeInTheDocument();
    expect(screen.getByText(ENTITY_NOTE)).toBeInTheDocument();
    expect(screen.getAllByText("Registrant first observed").length).toBeGreaterThan(0);
    expect(screen.queryByText(/new investment|new position|new borrower/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/NEW_POSITION|VALUATION_MOVEMENT|PIK|NON_ACCRUAL/)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$\s?\d/);
    const instrument = screen.getByText("Instrument identity").closest("div")?.querySelector("dd");
    expect(instrument).toHaveTextContent("Unresolved · UNKNOWN_INSTRUMENT_ATTRIBUTES");
    expect(instrument).not.toHaveTextContent("Matched");
    const nameResolution = screen.getByText("Name resolution").closest("div")?.querySelector("dd");
    expect(nameResolution).toHaveTextContent("Matched · EXACT_NORMALIZED_NAME");
    const accessionLinks = screen.getAllByRole("link", { name: "0000000000-99-000001" });
    expect(accessionLinks.length).toBeGreaterThan(0);
    for (const link of accessionLinks) {
      expect(link).toHaveAttribute(
        "href",
        `${EDGAR_DOCUMENT_PREFIX}0000000000/000000000099000001/test-filing.htm`,
      );
    }
  });

  it("refuses a listing row that carries a valuation field", () => {
    expect(() => listBorrowers([row({ fair_value: "10" } as Partial<ObservationRow>)], "")).toThrow(/not displayable/);
  });
});

function summary(storedObservations: string): BorrowerSummary {
  return {
    id: ID,
    name: "TEST BORROWER A",
    entityState: "Matched",
    entityMethod: "EXACT_NORMALIZED_NAME",
    instrumentState: "Unresolved",
    instrumentMethod: "UNKNOWN_INSTRUMENT_ATTRIBUTES",
    linkedRegistrants: "24",
    observedDates: "16",
    storedObservations,
  };
}

describe("stored observation labels", () => {
  it("keeps a stored-observation count distinct from exposure or coverage", () => {
    render(<BorrowerList borrowers={[summary("181")]} query="" error={null} />);
    expect(screen.getByRole("columnheader", { name: "Stored observations" })).toBeInTheDocument();
    expect(screen.getByText("181")).toBeInTheDocument();
    expect(screen.getByText(COUNT_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name resolution" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Instrument identity" })).toBeInTheDocument();
    expect(screen.getByText(/Matched · EXACT_NORMALIZED_NAME/)).toBeInTheDocument();
    const instrumentCell = screen.getByRole("columnheader", { name: "Instrument identity" });
    const instrumentIndex = [...instrumentCell.parentElement!.children].indexOf(instrumentCell);
    const row = screen.getByRole("row", { name: /TEST BORROWER A/ });
    expect(row.children[instrumentIndex]).toHaveTextContent("Unresolved · UNKNOWN_INSTRUMENT_ATTRIBUTES");
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "").join(" ");
    expect(headers).not.toMatch(/exposure|coverage|active holdings|positions/i);
    expect(document.querySelector(".overflow-x-auto")).toBeTruthy();
  });
});

describe("navigation", () => {
  it("offers Borrowers, Portfolios, Maturity, and Coverage, and keeps the borrower heading", () => {
    render(<Shell><p>Body</p></Shell>);
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("href", "/borrowers");
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Portfolios" })).toHaveAttribute("href", "/portfolios");
    expect(screen.getByRole("link", { name: "Maturity" })).toHaveAttribute("href", "/maturity");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("href", "/market");
    expect(screen.getByText("Find Borrowers")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /refinancing|screener/i })).not.toBeInTheDocument();
  });
});
