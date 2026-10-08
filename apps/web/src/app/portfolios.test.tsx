import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PortfolioDetail } from "@/components/PortfolioDetail";
import { PortfolioLimits } from "@/components/PortfolioLimits";
import { PortfolioLines } from "@/components/PortfolioLines";
import { PortfolioList } from "@/components/PortfolioList";
import { AppShell } from "@/components/AppShell";
import {
  BLOCKED_NOTE,
  CURRENCY_NOTE,
  IDENTITY_NOTE,
  LINE_COUNT_NOTE,
  LINE_TEXT_NOTE,
  RATE_NOTE,
  VALUATION_NOTE,
  listPortfolios,
  pageWindow,
  portfolioLine,
  reportedDates,
  secUrl,
  type LineRow,
  type RegistrantRow,
} from "@/lib/portfolios";

function sentence(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text;
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/portfolios",
}));

const REGISTRANT: RegistrantRow = {
  registrant_cik: "0000000001",
  name_state: "REPORTED",
  name_raw: "TEST REGISTRANT A",
  ticker_state: "UNKNOWN",
  ticker_raw: null,
  file_number_state: "MULTIPLE_VALUES",
  file_number_raw: null,
  reported_date_count: 2,
};

function line(overrides: Partial<LineRow> = {}): LineRow {
  return {
    position_observation_id: "1",
    reported_date: "2099-03-31",
    duration_kind: "POINT_IN_TIME",
    period_role: "UNRESOLVED",
    disclosed_line_text: "TEST LINE ONE",
    accession_number: "0000000000-99-000001",
    evidence_level: "L1_STRUCTURED_DATASET",
    principal_state: "REPORTED",
    principal_raw: "1000",
    principal_currency_state: "UNKNOWN",
    maturity_source: "UNKNOWN",
    maturity_raw: null,
    maturity_filing_verified: false,
    maturity_document_url: null,
    instrument_type_state: "UNKNOWN",
    instrument_type_raw: null,
    industry_state: "UNKNOWN",
    industry_raw: null,
    affiliation_state: "UNKNOWN",
    affiliation_raw: null,
    geography_state: "UNKNOWN",
    geography_raw: null,
    acquisition_date_state: "UNKNOWN",
    acquisition_date_raw: null,
    restricted_state: "UNKNOWN",
    restricted_raw: null,
    reference_uri_state: "UNKNOWN",
    reference_uri_raw: null,
    form_state: "REPORTED",
    form_raw: "10-Q",
    filed_date_state: "REPORTED",
    filed_date_raw: "2099-05-01",
    inline_url_state: "REPORTED",
    inline_url: "https://www.sec.gov/ix?doc=/Archives/edgar/data/1/0001/test.htm",
    document_name: "test.htm",
    document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test.htm",
    release_state: "REPORTED",
    release_label: "2099q1",
    ...overrides,
  };
}

describe("portfolio listing", () => {
  it("keeps a missing name unknown and does not search unresolved names as entities", () => {
    const rows: RegistrantRow[] = [
      REGISTRANT,
      { ...REGISTRANT, registrant_cik: "0000000002", name_state: "MULTIPLE_VALUES", name_raw: null },
    ];
    const listed = listPortfolios(rows, "test registrant");
    expect(listed.map((row) => row.cik)).toEqual(["0000000001"]);
    expect(listPortfolios(rows, "")[1]?.name).toBe("Multiple values");
  });

  it("labels blocked states and counts disclosed lines", () => {
    render(<PortfolioList portfolios={listPortfolios([REGISTRANT], "")} query="" error={null} emptyPeriods={["2099_06"]} />);
    expect(screen.getByText(BLOCKED_NOTE)).toBeInTheDocument();
    expect(screen.getByText(IDENTITY_NOTE)).toBeInTheDocument();
    expect(screen.getByText(VALUATION_NOTE)).toBeInTheDocument();
    expect(screen.getByText(RATE_NOTE)).toBeInTheDocument();
    expect(screen.getByText(LINE_COUNT_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Reported dates" })).toBeInTheDocument();
    expect(screen.getByText(/Releases: 2099_06/)).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "").join(" ");
    expect(headers).not.toMatch(/fair value|borrower count|portfolio total|current holdings/i);
  });
});

describe("reported dates", () => {
  it("keeps an absent date off the timeline", () => {
    const dates = reportedDates([
      { reported_date: "2099-06-30", disclosed_line_count: 2, point_in_time_line_count: 1, duration_line_count: 1 },
      { reported_date: "2099-03-31", disclosed_line_count: 1, point_in_time_line_count: 1, duration_line_count: 0 },
    ]);
    render(
      <PortfolioDetail
        registrant={REGISTRANT}
        names={[{ source_type_code: "SUBMISSIONS_JSON", raw_value: "TEST REGISTRANT A", documentation_status: "DOCUMENTED" }]}
        dates={dates}
        emptyPeriods={[]}
      />,
    );
    expect(screen.getByRole("link", { name: "2099-03-31" })).toHaveAttribute(
      "href",
      "/portfolios/0000000001/lines?date=2099-03-31",
    );
    expect(screen.queryByText("2099-09-30")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Disclosed lines" })).toBeInTheDocument();
  });
});

describe("disclosed lines", () => {
  it("shows reported principal, unknown maturity, and keeps duplicate lines", () => {
    const first = portfolioLine(line());
    const second = portfolioLine(line({
      position_observation_id: "2",
      principal_state: "REPORTED",
      principal_raw: "0",
      maturity_source: "REPORTED_STRUCTURED",
      maturity_raw: "2099-12-31",
      document_url: "https://example.com/not-sec",
      inline_url: "https://example.com/not-sec",
    }));
    expect(first.principal).toBe("1000");
    expect(first.currency).toBe(CURRENCY_NOTE);
    expect(first.maturity).toBe("Unknown");
    expect(second.principal).toBe("0");
    expect(second.maturity).toBe("2099-12-31");
    expect(second.documentUrl).toBeNull();
    expect(second.inlineUrl).toBeNull();
    expect(secUrl("https://example.com/not-sec")).toBeNull();
    render(
      <PortfolioLines
        cik="0000000001"
        reportedDate="2099-03-31"
        lines={[first, second]}
        page={1}
        hasPrevious={false}
        hasNext={false}
        pastEnd={false}
        emptyPeriods={[]}
      />,
    );
    expect(screen.getAllByRole("heading", { name: "TEST LINE ONE" })).toHaveLength(2);
    expect(screen.getByText(LINE_TEXT_NOTE)).toBeInTheDocument();
    expect(screen.getByText(VALUATION_NOTE)).toBeInTheDocument();
    expect(screen.getByText(RATE_NOTE)).toBeInTheDocument();
    expect(screen.getAllByText("Unresolved")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "SEC filing" })).toHaveAttribute("href", first.inlineUrl);
    expect(screen.getByRole("link", { name: "SEC filing" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "SEC filing" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("term", { name: /interest rate|spread|fair value|cost/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$/);
    expect(document.body.textContent).not.toMatch(/qtrs/);
  });

  it("shows a filing-displayed maturity with its source and no date for unknown or unresolved maturity", () => {
    const filing = portfolioLine(line({
      maturity_source: "FILING_DISPLAYED",
      maturity_raw: "4/13/2099",
      maturity_document_url: "https://www.sec.gov/Archives/edgar/data/1/0001/test-maturity.htm",
      acquisition_date_state: "REPORTED",
      acquisition_date_raw: "1/2/2099",
    }));
    const unknown = portfolioLine(line({ position_observation_id: "2", maturity_source: "UNKNOWN" }));
    const unresolved = portfolioLine(line({ position_observation_id: "3", maturity_source: "UNRESOLVED" }));
    expect(filing.maturity).toBe("4/13/2099");
    expect(filing.maturitySource).toBe("Original EDGAR filing");
    expect(filing.maturityDocumentUrl).toBe("https://www.sec.gov/Archives/edgar/data/1/0001/test-maturity.htm");
    expect(filing.attributes.find((attribute) => attribute.label === "Acquisition date")?.text).toBe("1/2/2099");
    expect(unknown.maturity).toBe("Unknown");
    expect(unknown.maturitySource).toBeNull();
    expect(unresolved.maturity).toBe("Unresolved");
    expect(unresolved.maturitySource).toBeNull();
    render(
      <PortfolioLines
        cik="0000000001"
        reportedDate="2099-03-31"
        lines={[filing, unknown]}
        page={1}
        hasPrevious={false}
        hasNext={false}
        pastEnd={false}
        emptyPeriods={[]}
      />,
    );
    expect(screen.getByText("4/13/2099")).toBeInTheDocument();
    expect(screen.getByText(/Original EDGAR filing/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Filing document" })).toHaveAttribute("href", filing.maturityDocumentUrl);
  });

  it("does not treat a missing date as zero lines", () => {
    render(
      <PortfolioLines
        cik="0000000001"
        reportedDate="2099-09-30"
        lines={[]}
        page={1}
        hasPrevious={false}
        hasNext={false}
        pastEnd={false}
        emptyPeriods={[]}
      />,
    );
    expect(screen.getByText(sentence("Unobserved. This reported date was not observed."))).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

describe("portfolio states", () => {
  it("rejects a field the page must not display", () => {
    expect(() => portfolioLine(line({ fair_value_raw: "1" } as Partial<LineRow>))).toThrow(/not displayable/);
  });

  it("pages disclosed lines without totaling them", () => {
    expect(pageWindow(2, 51)).toMatchObject({ start: 50, end: 51, hasPrevious: true, hasNext: false, pastEnd: false });
    expect(pageWindow(3, 51).pastEnd).toBe(true);
  });

  it("names the portfolio section without replacing borrowers", () => {
    render(<AppShell signedIn isAdmin={false}><PortfolioLimits emptyPeriods={[]} /></AppShell>);
    expect(screen.getByText("BDC portfolios")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("href", "/borrowers");
    expect(screen.getByRole("link", { name: "Portfolios" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Maturity" })).toHaveAttribute("href", "/maturity");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("href", "/market");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
  });
});
