import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MaturityDetail } from "@/components/MaturityDetail";
import { MaturityLines } from "@/components/MaturityLines";
import { MaturityList } from "@/components/MaturityList";
import { Shell } from "@/components/Shell";
import {
  BOUNDARY_NOTE,
  UNKNOWN_MATURITY_NOTE,
  UNRESOLVED_MATURITY_NOTE,
  WALL_NOTE,
  maturityDates,
  maturityLine,
  maturityYears,
  type MaturityLineRow,
} from "@/lib/maturity";
import { CURRENCY_NOTE, listPortfolios, type RegistrantRow } from "@/lib/portfolios";

function sentence(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text;
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/maturity",
}));

const REGISTRANT: RegistrantRow = {
  registrant_cik: "0000000001",
  name_state: "REPORTED",
  name_raw: "TEST REGISTRANT A",
  ticker_state: "UNKNOWN",
  ticker_raw: null,
  file_number_state: "UNKNOWN",
  file_number_raw: null,
  reported_date_count: 1,
};

function line(overrides: Partial<MaturityLineRow> = {}): MaturityLineRow {
  return {
    position_observation_id: "1",
    disclosed_line_text: "TEST LINE ONE",
    principal_state: "REPORTED",
    principal_raw: "1000",
    principal_currency_state: "UNKNOWN",
    maturity_source: "REPORTED_STRUCTURED",
    maturity_raw: "1899-12-31",
    maturity_year: 1899,
    maturity_filing_verified: false,
    maturity_document_url: null,
    accession_number: "0000000000-99-000001",
    evidence_level: "L1_STRUCTURED_DATASET",
    form_state: "REPORTED",
    form_raw: "10-Q",
    filed_date_state: "REPORTED",
    filed_date_raw: "2099-05-01",
    inline_url_state: "REPORTED",
    inline_url: "https://www.sec.gov/ix?doc=/Archives/edgar/data/1/0001/test.htm",
    document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm",
    release_state: "REPORTED",
    release_label: "2099q1",
    ...overrides,
  };
}

describe("maturity wall", () => {
  it("lists registrants without a maturity total", () => {
    render(
      <MaturityList
        registrants={listPortfolios([REGISTRANT], "")}
        query=""
        error={null}
        emptyPeriods={["2099_06"]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Maturity wall" })).toBeInTheDocument();
    expect(screen.getByText(WALL_NOTE)).toBeInTheDocument();
    expect(screen.getByText(UNKNOWN_MATURITY_NOTE)).toBeInTheDocument();
    expect(screen.getByText(BOUNDARY_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0000000001" })).toHaveAttribute("href", "/maturity/0000000001");
    expect(screen.getByText(/Releases: 2099_06/)).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "").join(" ");
    expect(headers).not.toMatch(/fair value|principal|portfolio total|borrower/i);
  });

  it("counts reported years and keeps unknown maturity out of those years", () => {
    const dates = maturityDates([{
      reported_date: "2099-12-31",
      disclosed_line_count: 3,
      maturity_reported_count: 2,
      maturity_structured_count: 1,
      maturity_filing_count: 1,
      maturity_unknown_count: 1,
      maturity_unresolved_count: 0,
    }]);
    const years = maturityYears([
      { reported_date: "2099-12-31", maturity_year: 3032, disclosed_line_count: 1 },
      { reported_date: "2099-12-31", maturity_year: 1899, disclosed_line_count: 1 },
    ]);
    expect(years.map((year) => year.maturityYear)).toEqual(["1899", "3032"]);
    render(
      <MaturityDetail
        registrant={REGISTRANT}
        names={[]}
        dates={dates}
        years={years}
        emptyPeriods={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "1899" })).toHaveAttribute(
      "href",
      "/maturity/0000000001/lines?date=2099-12-31&year=1899",
    );
    expect(screen.getByRole("link", { name: "3032" })).toBeInTheDocument();
    expect(screen.getByText("Unknown maturity")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute(
      "href",
      "/maturity/0000000001/lines?date=2099-12-31&year=unknown",
    );
    expect(screen.getByText("Maturity from the structured SEC data set")).toBeInTheDocument();
    expect(screen.getByText("Maturity from the original EDGAR filing")).toBeInTheDocument();
    expect(screen.getByText(UNRESOLVED_MATURITY_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0" })).toHaveAttribute(
      "href",
      "/maturity/0000000001/lines?date=2099-12-31&year=unresolved",
    );
    expect(document.body.textContent).not.toMatch(/Multiple values/);
    expect(screen.queryByRole("link", { name: "2099" })).not.toBeInTheDocument();
    expect(screen.getByText("Cost and fair value remain an open question and are not shown.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it("shows a reported maturity date, unknown maturity, and principal without a total", () => {
    const reported = maturityLine(line());
    const unknown = maturityLine(line({
      position_observation_id: "2",
      principal_state: "UNKNOWN",
      principal_raw: null,
      maturity_source: "UNKNOWN",
      maturity_raw: null,
      maturity_year: null,
      document_url: "https://example.com/not-sec",
      inline_url: "https://example.com/not-sec",
    }));
    expect(reported.maturity).toBe("1899-12-31");
    expect(reported.currency).toBe(CURRENCY_NOTE);
    expect(unknown.maturity).toBe("Unknown");
    expect(unknown.principal).toBe("Unknown");
    expect(unknown.currency).toBeNull();
    expect(unknown.documentUrl).toBeNull();
    render(
      <MaturityLines
        cik="0000000001"
        reportedDate="2099-12-31"
        yearLabel="1899"
        lines={[reported, unknown]}
        page={1}
        hasPrevious={false}
        hasNext={false}
        pastEnd={false}
        emptyMessage={null}
        emptyPeriods={[]}
      />,
    );
    expect(screen.getAllByRole("heading", { name: "TEST LINE ONE" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "SEC filing" })).toHaveAttribute("href", reported.inlineUrl);
    expect(screen.getByRole("link", { name: "SEC filing" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "SEC filing" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("term", { name: /interest rate|spread|fair value|cost/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it("does not treat a missing maturity year as zero lines", () => {
    render(
      <MaturityLines
        cik="0000000001"
        reportedDate="2099-12-31"
        yearLabel="2100"
        lines={[]}
        page={1}
        hasPrevious={false}
        hasNext={false}
        pastEnd={false}
        emptyMessage="Unobserved. This maturity year was not observed on this reported date."
        emptyPeriods={[]}
      />,
    );
    expect(screen.getByText(sentence("Unobserved. This maturity year was not observed on this reported date."))).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("names the maturity section from the maturity path", () => {
    render(<Shell><p>Body</p></Shell>);
    expect(screen.getByText("Maturity wall")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Portfolios" })).toHaveAttribute("href", "/portfolios");
    expect(screen.getByRole("link", { name: "Maturity" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("href", "/market");
    expect(screen.queryByRole("link", { name: /refinancing/i })).not.toBeInTheDocument();
  });

  it("labels each maturity by its source and shows no date for unknown or unresolved maturity", () => {
    const structured = maturityLine(line());
    const filing = maturityLine(line({
      position_observation_id: "2",
      maturity_source: "FILING_DISPLAYED",
      maturity_raw: "4/13/2099",
      maturity_year: 2099,
      maturity_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test-maturity.htm",
    }));
    const verified = maturityLine(line({
      position_observation_id: "3",
      maturity_filing_verified: true,
      maturity_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test-maturity.htm",
    }));
    const unknown = maturityLine(line({ position_observation_id: "4", maturity_source: "UNKNOWN", maturity_raw: null, maturity_year: null }));
    const unresolved = maturityLine(line({ position_observation_id: "5", maturity_source: "UNRESOLVED", maturity_raw: null, maturity_year: null }));
    expect(structured.maturitySource).toBe("Structured SEC data set");
    expect(structured.maturityDocumentUrl).toBeNull();
    expect(filing.maturity).toBe("4/13/2099");
    expect(filing.maturitySource).toBe("Original EDGAR filing");
    expect(filing.maturityDocumentUrl).toBe("https://www.sec.gov/Archives/edgar/data/1/0001/test-maturity.htm");
    expect(verified.maturitySource).toBe("Structured SEC data set; the original EDGAR filing shows the same date");
    expect(unknown.maturity).toBe("Unknown");
    expect(unknown.maturitySource).toBeNull();
    expect(unresolved.maturity).toBe("Unresolved");
    expect(unresolved.maturitySource).toBeNull();
    const raw = maturityLine(line({ position_observation_id: "6", maturity_source: "UNKNOWN", maturity_raw: "Expiration - December 18, 2099" }));
    expect(raw.maturity).toBe("Unknown");
    render(
      <MaturityLines
        cik="0000000001"
        reportedDate="2099-12-31"
        yearLabel="All disclosed lines"
        lines={[structured, filing, unknown, unresolved]}
        page={1}
        hasPrevious={false}
        hasNext={false}
        pastEnd={false}
        emptyMessage={null}
        emptyPeriods={[]}
      />,
    );
    expect(screen.getByText("4/13/2099")).toBeInTheDocument();
    expect(screen.getByText(/Original EDGAR filing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Filing document" })).toHaveAttribute("href", filing.maturityDocumentUrl);
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
  });

  it("rejects a valuation field on a maturity line", () => {
    expect(() => maturityLine(line({ fair_value_raw: "1" } as Partial<MaturityLineRow>))).toThrow(/not displayable/);
  });
});
