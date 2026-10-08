import { describe, expect, it } from "vitest";
import type { SecFilingRow } from "@/lib/sec-submissions";
import {
  coveragePercent,
  filingDetailHref,
  indexBdcFlowByAccession,
  reconcileSecFilingsWithBdcFlow,
} from "@/lib/sec-coverage-reconcile";

function sec(partial: Partial<SecFilingRow> & Pick<SecFilingRow, "accessionNumber">): SecFilingRow {
  return {
    form: "10-Q",
    filingDate: "2026-07-29",
    reportDate: null,
    acceptanceDateTime: null,
    primaryDocument: "a.htm",
    primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/a.htm",
    filingIndexUrl: "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/0001628280-26-050307-index.html",
    ...partial,
  };
}

describe("sec-coverage-reconcile", () => {
  it("marks exact accession match as RECEIVED and uses filing_id for detail navigation", () => {
    const result = reconcileSecFilingsWithBdcFlow(
      [sec({ accessionNumber: "0001628280-26-050307" })],
      indexBdcFlowByAccession([{ accessionNumber: "0001628280-26-050307", filingId: 42 }]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.bdcFlowStatus).toBe("RECEIVED");
    expect(result.rows[0]?.filingId).toBe(42);
    expect(result.rows[0]?.filingDetailHref).toBe(filingDetailHref(42));
    expect(result.rows[0]?.filingDetailHref).toBe("/admin/filings/42");
    expect(result.summary).toEqual({
      secFilingsInCoverage: 1,
      receivedInBdcFlow: 1,
      missingFromBdcFlow: 0,
      coveragePercent: 100,
    });
  });

  it("marks exact accession absence as MISSING and keeps SEC URLs", () => {
    const row = sec({ accessionNumber: "0001104659-26-106734" });
    const result = reconcileSecFilingsWithBdcFlow([row], new Map());
    expect(result.rows[0]?.bdcFlowStatus).toBe("MISSING");
    expect(result.rows[0]?.filingId).toBeNull();
    expect(result.rows[0]?.filingDetailHref).toBeNull();
    expect(result.rows[0]?.primaryDocumentUrl).toBe(row.primaryDocumentUrl);
    expect(result.summary.missingFromBdcFlow).toBe(1);
    expect(result.summary.coveragePercent).toBe(0);
  });

  it("does not match similar-but-not-equal accession strings", () => {
    const result = reconcileSecFilingsWithBdcFlow(
      [sec({ accessionNumber: "0001628280-26-050307" })],
      indexBdcFlowByAccession([
        { accessionNumber: "0001628280-26-050308", filingId: 1 },
        { accessionNumber: "000162828026050307", filingId: 2 },
        { accessionNumber: "0001628280-26-050307 ", filingId: 3 },
      ]),
    );
    expect(result.rows[0]?.bdcFlowStatus).toBe("MISSING");
    expect(result.rows[0]?.filingId).toBeNull();
  });

  it("preserves SEC order and summary counts", () => {
    const result = reconcileSecFilingsWithBdcFlow(
      [
        sec({ accessionNumber: "0001628280-26-050307", form: "10-Q" }),
        sec({ accessionNumber: "0001287750-19-000001", form: "10-K" }),
        sec({ accessionNumber: "0001104659-26-106734", form: "424B2" }),
      ],
      indexBdcFlowByAccession([
        { accessionNumber: "0001287750-19-000001", filingId: 9 },
        { accessionNumber: "0001104659-26-106734", filingId: 8 },
      ]),
    );
    expect(result.rows.map((r) => r.accessionNumber)).toEqual([
      "0001628280-26-050307",
      "0001287750-19-000001",
      "0001104659-26-106734",
    ]);
    expect(result.rows.map((r) => r.bdcFlowStatus)).toEqual(["MISSING", "RECEIVED", "RECEIVED"]);
    expect(result.summary).toEqual({
      secFilingsInCoverage: 3,
      receivedInBdcFlow: 2,
      missingFromBdcFlow: 1,
      coveragePercent: 67,
    });
    expect(result.matchKeyNote).toMatch(/exact SEC accession number/);
    expect(result.matchKeyNote).toMatch(/not that ingestion failed/i);
  });

  it("computes coverage percent without inventing a health score when empty", () => {
    expect(coveragePercent(0, 0)).toBeNull();
    expect(coveragePercent(0, 4)).toBe(0);
    expect(coveragePercent(1, 4)).toBe(25);
    expect(coveragePercent(2, 3)).toBe(67);
    expect(coveragePercent(3, 3)).toBe(100);
  });
});
