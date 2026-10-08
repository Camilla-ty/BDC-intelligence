import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArccSecCoverage } from "@/components/ArccSecCoverage";
import type { SecSubmissionsCoverage } from "@/lib/sec-submissions";

const COVERAGE: SecSubmissionsCoverage = {
  cik: "0001287750",
  registrantName: "Ares Capital Corporation",
  sourceUrl: "https://data.sec.gov/submissions/CIK0001287750.json",
  fetchedAt: "2099-01-01T00:00:00.000Z",
  recentCount: 1,
  historyFiles: [],
  historyPagesFetched: 0,
  historyPagesSkipped: 0,
  coverageFrom: "2026-07-29",
  coverageTo: "2026-07-29",
  filings: [
    {
      accessionNumber: "0001628280-26-050307",
      form: "10-Q",
      filingDate: "2026-07-29",
      reportDate: null,
      acceptanceDateTime: "2026-07-29T21:00:00.000Z",
      primaryDocument: "arcc-20260630.htm",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/arcc-20260630.htm",
      filingIndexUrl: "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/0001628280-26-050307-index.html",
    },
  ],
  coverageNote:
    "SEC submissions recent window: 1 filing(s). This page does not reconcile SEC filings with BDC Flow.",
};

describe("ARCC SEC coverage UI", () => {
  it("states that the list is SEC-reported and not reconciled with BDC Flow", () => {
    render(<ArccSecCoverage coverage={COVERAGE} error={null} />);
    expect(screen.getByRole("heading", { name: "ARCC — SEC Filing Coverage" })).toBeTruthy();
    expect(screen.getByText("Ares Capital Corporation")).toBeTruthy();
    expect(screen.getByText(/CIK 0001287750/)).toBeTruthy();
    expect(screen.getByText(/does not reconcile those filings with BDC Flow/i)).toBeTruthy();
    expect(screen.getByText("0001628280-26-050307")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View SEC filing" })).toHaveAttribute(
      "href",
      "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/arcc-20260630.htm",
    );
    expect(screen.queryByText(/^Update$/)).toBeNull();
  });

  it("shows Unavailable when no SEC view URL can be built", () => {
    render(
      <ArccSecCoverage
        coverage={{
          ...COVERAGE,
          filings: [
            {
              ...COVERAGE.filings[0]!,
              primaryDocument: null,
              primaryDocumentUrl: null,
              filingIndexUrl: null,
            },
          ],
        }}
        error={null}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
});
