import { describe, expect, it } from "vitest";
import {
  accessionNoDashes,
  archivesCikPath,
  assembleCoverage,
  filingIndexUrl,
  parseSubmissionsMain,
  primaryDocumentUrl,
  rowsFromFilingArrays,
  viewSecFilingUrl,
} from "@/lib/sec-submissions";

function columnar(rows: Array<Record<string, unknown>>) {
  const keys = [
    "accessionNumber", "filingDate", "reportDate", "acceptanceDateTime", "act", "form",
    "fileNumber", "filmNumber", "items", "core_type", "size", "isXBRL", "isInlineXBRL",
    "isXBRLNumeric", "primaryDocument", "primaryDocDescription",
  ] as const;
  const out: Record<string, unknown[]> = Object.fromEntries(keys.map((k) => [k, []]));
  for (const row of rows) {
    for (const key of keys) out[key].push(row[key] ?? (key === "size" || key.startsWith("is") ? 0 : ""));
  }
  return out;
}

describe("SEC submissions normalization", () => {
  it("preserves accession numbers exactly and derives documented Archives URLs", () => {
    const accession = "0001628280-26-050307";
    expect(accessionNoDashes(accession)).toBe("000162828026050307");
    expect(archivesCikPath("0001287750")).toBe("1287750");
    expect(primaryDocumentUrl("0001287750", accession, "arcc-20260630.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/arcc-20260630.htm",
    );
    expect(filingIndexUrl("0001287750", accession)).toBe(
      "https://www.sec.gov/Archives/edgar/data/1287750/000162828026050307/0001628280-26-050307-index.html",
    );
  });

  it("parses form and filing date and keeps optional fields Unknown when empty", () => {
    const { rows, error } = rowsFromFilingArrays(
      columnar([
        {
          accessionNumber: "0001287750-26-000001",
          filingDate: "2026-03-15",
          reportDate: "",
          acceptanceDateTime: "2026-03-15T21:00:00.000Z",
          form: "10-K",
          primaryDocument: "arcc.htm",
        },
      ]),
      "0001287750",
      "filings.recent",
    );
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accessionNumber).toBe("0001287750-26-000001");
    expect(rows[0]?.form).toBe("10-K");
    expect(rows[0]?.filingDate).toBe("2026-03-15");
    expect(rows[0]?.reportDate).toBeNull();
    expect(rows[0]?.acceptanceDateTime).toBe("2026-03-15T21:00:00.000Z");
    expect(viewSecFilingUrl(rows[0]!)).toContain("arcc.htm");
  });

  it("does not convert malformed SEC rows into valid filings", () => {
    const { rows, error } = rowsFromFilingArrays(
      columnar([
        {
          accessionNumber: "not-an-accession",
          filingDate: "2026-03-15",
          form: "10-K",
          primaryDocument: "x.htm",
        },
        {
          accessionNumber: "0001287750-26-000002",
          filingDate: "",
          form: "10-Q",
          primaryDocument: "y.htm",
        },
        {
          accessionNumber: "0001287750-26-000003",
          filingDate: "2026-01-01",
          form: "8-K",
          primaryDocument: "../evil.htm",
        },
      ]),
      "0001287750",
      "filings.recent",
    );
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accessionNumber).toBe("0001287750-26-000003");
    expect(rows[0]?.primaryDocumentUrl).toBeNull();
    expect(rows[0]?.filingIndexUrl).toContain("0001287750-26-000003-index.html");
  });

  it("rejects unequal columnar arrays and CIK mismatches", () => {
    const bad = columnar([{ accessionNumber: "0001287750-26-000001", filingDate: "2026-01-01", form: "10-K" }]);
    bad.form.push("10-Q");
    expect(rowsFromFilingArrays(bad, "0001287750", "filings.recent").error).toMatch(/different lengths/);

    const main = parseSubmissionsMain(
      {
        cik: "0000000001",
        name: "WRONG",
        filings: { recent: columnar([]), files: [] },
      },
      "0001287750",
    );
    expect(main.error).toMatch(/cik does not equal/);
  });

  it("assembles coverage with explicit range note and SEC order (recent then history)", () => {
    const coverage = assembleCoverage({
      cik: "0001287750",
      registrantName: "Ares Capital Corporation",
      sourceUrl: "https://data.sec.gov/submissions/CIK0001287750.json",
      fetchedAt: "2099-01-01T00:00:00.000Z",
      recentRows: [
        {
          accessionNumber: "0001287750-26-000002",
          form: "10-Q",
          filingDate: "2026-05-01",
          reportDate: "2026-03-31",
          acceptanceDateTime: null,
          primaryDocument: "q.htm",
          primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1287750/000128775026000002/q.htm",
          filingIndexUrl: "https://www.sec.gov/Archives/edgar/data/1287750/000128775026000002/0001287750-26-000002-index.html",
        },
      ],
      historyFiles: [
        { name: "CIK0001287750-submissions-001.json", filingCount: 1, filingFrom: "2020-01-01", filingTo: "2020-12-31" },
      ],
      historyPageRows: [[
        {
          accessionNumber: "0001287750-20-000001",
          form: "10-K",
          filingDate: "2020-02-01",
          reportDate: "2019-12-31",
          acceptanceDateTime: null,
          primaryDocument: "k.htm",
          primaryDocumentUrl: null,
          filingIndexUrl: null,
        },
      ]],
      historyPagesFetched: 1,
      historyPagesSkipped: 0,
    });
    expect(coverage.filings.map((f) => f.accessionNumber)).toEqual([
      "0001287750-26-000002",
      "0001287750-20-000001",
    ]);
    expect(coverage.coverageNote).toMatch(/filings\.recent plus every fetched/);
    expect(coverage.coverageNote).toMatch(/does not reconcile/);
    expect(coverage.coverageFrom).toBe("2020-01-01");
    expect(coverage.coverageTo).toBe("2026-05-01");
  });
});
