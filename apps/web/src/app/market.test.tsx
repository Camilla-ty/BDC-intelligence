import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarketCoverage } from "@/components/MarketCoverage";
import { MarketDate } from "@/components/MarketDate";
import { MarketRelease } from "@/components/MarketRelease";
import { AppShell } from "@/components/AppShell";
import {
  BLOCKED_NOTE,
  CELL_NOTE,
  EMPTY_RELEASE,
  MISSING_DATE,
  MISSING_RELEASE,
  NO_IDENTIFIED_LINE,
  Q14_NOTE,
  coverageCount,
  listDateCoverage,
  listDateRegistrants,
  listRegistrantCoverage,
  listReleaseCoverage,
  listReleaseDates,
  type DateRegistrantRow,
  type RegistrantCoverageRow,
  type ReleaseCoverageRow,
  type ReleaseDateRow,
} from "@/lib/market";

function sentence(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text;
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/market",
}));

const REGISTRANTS: RegistrantCoverageRow[] = [
  { registrant_cik: "0000000001", name_state: "REPORTED", name_raw: "TEST REGISTRANT A", coverage_state: "STORED_LINES" },
  { registrant_cik: "0000000002", name_state: "UNKNOWN", name_raw: null, coverage_state: "COVERED_NO_IDENTIFIED_LINE" },
  { registrant_cik: "0000000003", name_state: "UNKNOWN", name_raw: null, coverage_state: "UNKNOWN" },
];

const RELEASES: ReleaseCoverageRow[] = [
  { release_label: "2099_06", coverage_state: "UNAVAILABLE", registrants_observed: null, reported_dates_observed: null },
  { release_label: "2099_12", coverage_state: "OBSERVED", registrants_observed: 1, reported_dates_observed: 1 },
];

function dateRow(overrides: Partial<DateRegistrantRow> = {}): DateRegistrantRow {
  return {
    registrant_cik: "0000000001",
    name_state: "REPORTED",
    name_raw: "TEST REGISTRANT A",
    disclosed_line_count: 2,
    maturity_cell_line_count: 0,
    maturity_unknown_line_count: 2,
    principal_cell_line_count: 1,
    principal_unknown_line_count: 1,
    basis_cell_line_count: 1,
    basis_unknown_line_count: 1,
    initial_cell_line_count: 0,
    initial_unknown_line_count: 2,
    ...overrides,
  };
}

describe("market coverage inventory", () => {
  it("keeps stored, covered, unknown, and unavailable distinct from zero", () => {
    expect(coverageCount("UNAVAILABLE", null)).toBe("Unavailable");
    expect(coverageCount("UNKNOWN", null)).toBe("Unknown");
    expect(coverageCount("COVERED_NO_IDENTIFIED_LINE", null)).toBe(NO_IDENTIFIED_LINE);
    expect(coverageCount("OBSERVED", 1)).toBe("1");
    const registrants = listRegistrantCoverage(REGISTRANTS, "");
    render(
      <MarketCoverage
        registrants={registrants}
        releases={listReleaseCoverage(RELEASES)}
        dates={listDateCoverage([{ reported_date: "2099-12-31", registrants_observed: 1 }])}
        query=""
        error={null}
      />,
    );
    expect(screen.getByRole("link", { name: "0000000001" })).toHaveAttribute("href", "/portfolios/0000000001");
    expect(screen.queryByRole("link", { name: "0000000002" })).not.toBeInTheDocument();
    expect(screen.getByText("0000000002")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Covered, no identified line" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unknown coverage" })).toBeInTheDocument();
    const unavailable = screen.getByRole("link", { name: "2099_06" }).closest("tr");
    const cells = unavailable?.querySelectorAll("td") ?? [];
    expect(cells[1]).toHaveTextContent("Unavailable");
    expect(cells[2]).toHaveTextContent("Unavailable");
    expect(cells[3]).toHaveTextContent("Unavailable");
    expect(screen.getByText(BLOCKED_NOTE)).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "").join(" ");
    expect(headers).not.toMatch(/total|exposure|market size|borrower count/i);
  });

  it("shows disclosure coverage for one date and leaves an unobserved date without a zero", () => {
    const rows = listDateRegistrants([dateRow()], "2099-12-31");
    const { rerender } = render(<MarketDate reportedDate="2099-12-31" rows={rows} emptyMessage={null} />);
    expect(screen.getByRole("link", { name: "SEC sources" })).toHaveAttribute(
      "href",
      "/portfolios/0000000001/lines?date=2099-12-31",
    );
    expect(screen.getByText(CELL_NOTE)).toBeInTheDocument();
    expect(screen.getByText(Q14_NOTE)).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\$|90|100/);
    rerender(<MarketDate reportedDate="2099-01-01" rows={[]} emptyMessage={MISSING_DATE} />);
    expect(screen.getByText(sentence(MISSING_DATE))).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows an empty release as unavailable and an unknown release as not observed", () => {
    const { rerender } = render(
      <MarketRelease label="2099_06" found coverageState="Unavailable" rows={[]} />,
    );
    expect(screen.getByText(sentence(EMPTY_RELEASE))).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    const observed = listReleaseDates([
      {
        registrant_cik: "0000000001",
        name_state: "UNKNOWN",
        name_raw: null,
        reported_date: "2099-12-31",
        disclosed_line_count: 2,
      } satisfies ReleaseDateRow,
    ]);
    rerender(<MarketRelease label="2099_12" found coverageState="Observed" rows={observed} />);
    expect(screen.getByRole("link", { name: "SEC sources" })).toHaveAttribute(
      "href",
      "/portfolios/0000000001/lines?date=2099-12-31",
    );
    rerender(<MarketRelease label="2099_99" found={false} coverageState={null} rows={[]} />);
    expect(screen.getByText(sentence(MISSING_RELEASE))).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("names the coverage section and rejects an amount field", () => {
    render(<AppShell signedIn isAdmin={false}><p>Body</p></AppShell>);
    expect(screen.getByText("Market coverage")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Borrowers" })).toHaveAttribute("href", "/borrowers");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("href", "/market");
    expect(screen.getByRole("link", { name: "Coverage" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
    expect(() => listDateRegistrants([dateRow({ fair_value_raw: "1" } as Partial<DateRegistrantRow>)], "2099-12-31"))
      .toThrow(/not displayable/);
  });
});
