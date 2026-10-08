import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArccSecCoverage } from "@/components/ArccSecCoverage";
import type { SecCoverageReconciliation } from "@/lib/sec-coverage-reconcile";
import type { SecSubmissionsCoverage } from "@/lib/sec-submissions";

const COVERAGE: SecSubmissionsCoverage = {
  cik: "0001287750",
  registrantName: "Ares Capital Corporation",
  sourceUrl: "https://data.sec.gov/submissions/CIK0001287750.json",
  fetchedAt: "2099-01-01T00:00:00.000Z",
  recentCount: 2,
  historyFiles: [],
  historyPagesFetched: 0,
  historyPagesSkipped: 0,
  coverageFrom: "2026-07-29",
  coverageTo: "2026-09-10",
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
    {
      accessionNumber: "0001104659-26-106734",
      form: "424B2",
      filingDate: "2026-09-10",
      reportDate: null,
      acceptanceDateTime: null,
      primaryDocument: "tm.htm",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1287750/000110465926106734/tm.htm",
      filingIndexUrl: null,
    },
  ],
  coverageNote:
    "SEC submissions recent window: 2 filing(s). BDC Flow reconciliation, when available, matches this SEC list to inventory by exact accession number only.",
};

const RECONCILIATION: SecCoverageReconciliation = {
  rows: [
    {
      ...COVERAGE.filings[0]!,
      bdcFlowStatus: "RECEIVED",
      filingId: 42,
      filingDetailHref: "/admin/filings/42",
    },
    {
      ...COVERAGE.filings[1]!,
      bdcFlowStatus: "MISSING",
      filingId: null,
      filingDetailHref: null,
    },
  ],
  summary: {
    secFilingsInCoverage: 2,
    receivedInBdcFlow: 1,
    missingFromBdcFlow: 1,
    coveragePercent: 50,
  },
  matchKeyNote:
    "Reconciliation uses exact SEC accession number equality against BDC Flow filing accession numbers. MISSING means the SEC filing is present in this coverage set but no matching BDC Flow filing was found — not that ingestion failed.",
};

describe("ARCC SEC coverage UI", () => {
  it("shows accession reconciliation summary and RECEIVED/MISSING actions", () => {
    render(
      <ArccSecCoverage
        coverage={COVERAGE}
        reconciliation={RECONCILIATION}
        reconciliationError={null}
        bdcFlowOnlyCount={2}
        error={null}
      />,
    );
    expect(screen.getByRole("heading", { name: "ARCC — SEC Filing Coverage" })).toBeTruthy();
    expect(screen.getAllByText(/exact accession number only/i).length).toBeGreaterThan(0);
    expect(screen.getByText("SEC filings in coverage")).toBeTruthy();
    expect(screen.getByText("Received in BDC Flow")).toBeTruthy();
    expect(screen.getByText("Missing from BDC Flow")).toBeTruthy();
    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getByText("50.00%")).toBeTruthy();
    expect(screen.getByText("RECEIVED")).toBeTruthy();
    expect(screen.getByText("MISSING")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/admin/filings/42");
    expect(screen.getByRole("link", { name: "View SEC filing" })).toHaveAttribute(
      "href",
      "https://www.sec.gov/Archives/edgar/data/1287750/000110465926106734/tm.htm",
    );
    expect(screen.getByText("Update (not available yet)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
    expect(screen.getByText(/not in this SEC coverage list: 2/)).toBeTruthy();
  });

  it("does not invent MISSING when reconciliation fails", () => {
    render(
      <ArccSecCoverage
        coverage={COVERAGE}
        reconciliation={null}
        reconciliationError="The BDC Flow filing inventory could not be read for reconciliation."
        bdcFlowOnlyCount={null}
        error={null}
      />,
    );
    expect(screen.getByText(/Reconciliation unavailable/)).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("RECEIVED")).toBeNull();
    expect(screen.queryByText("MISSING")).toBeNull();
    expect(screen.getByText("0001628280-26-050307")).toBeTruthy();
  });

  it("does not invent a zero-MISSING table when SEC fetch failed", () => {
    render(
      <ArccSecCoverage
        coverage={null}
        reconciliation={null}
        reconciliationError={null}
        bdcFlowOnlyCount={null}
        error="SEC_USER_AGENT must be set"
      />,
    );
    expect(screen.getByText(/SEC_USER_AGENT must be set/)).toBeTruthy();
    expect(screen.queryByText("RECEIVED")).toBeNull();
    expect(screen.queryByText("MISSING")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
