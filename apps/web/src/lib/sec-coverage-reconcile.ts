// Phase 1-B: accession-number reconciliation between SEC submissions rows
// and BDC Flow admin.filing_inventory. Matching is exact string equality only.

import type { SecFilingRow } from "@/lib/sec-submissions";

export type BdcFlowStatus = "RECEIVED" | "MISSING";

export type BdcFlowFilingRef = {
  accessionNumber: string;
  filingId: number;
};

export type ReconciledSecFilingRow = SecFilingRow & {
  bdcFlowStatus: BdcFlowStatus;
  filingId: number | null;
  filingDetailHref: string | null;
};

export type SecCoverageReconcileSummary = {
  secFilingsInCoverage: number;
  receivedInBdcFlow: number;
  missingFromBdcFlow: number;
  /** Integer percent 0–100; null when there are no SEC filings to cover. */
  coveragePercent: number | null;
};

export type SecCoverageReconciliation = {
  rows: ReconciledSecFilingRow[];
  summary: SecCoverageReconcileSummary;
  /** Exact accession match against admin.filing_inventory / registry.filing. */
  matchKeyNote: string;
};

export function filingDetailHref(filingId: number): string {
  return `/admin/filings/${filingId}`;
}

/**
 * Coverage = received / SEC filings in this coverage set, rounded to nearest integer percent.
 * Not a health score — only the share of displayed SEC accessions found in BDC Flow.
 */
export function coveragePercent(received: number, secFilingsInCoverage: number): number | null {
  if (secFilingsInCoverage <= 0) return null;
  if (received < 0 || received > secFilingsInCoverage) {
    throw new Error("received count is outside the SEC coverage set");
  }
  return Math.round((received / secFilingsInCoverage) * 100);
}

/** Build an exact-accession lookup. Duplicate accessions keep the first filing_id. */
export function indexBdcFlowByAccession(
  refs: ReadonlyArray<BdcFlowFilingRef>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const ref of refs) {
    if (!map.has(ref.accessionNumber)) map.set(ref.accessionNumber, ref.filingId);
  }
  return map;
}

/**
 * One output row per SEC filing, preserving SEC order.
 * RECEIVED only on exact accession string match; otherwise MISSING.
 * Does not invent BDC Flow rows for SEC-absent filings.
 */
export function reconcileSecFilingsWithBdcFlow(
  secFilings: ReadonlyArray<SecFilingRow>,
  bdcFlowByAccession: ReadonlyMap<string, number>,
): SecCoverageReconciliation {
  const rows: ReconciledSecFilingRow[] = secFilings.map((sec) => {
    const filingId = bdcFlowByAccession.get(sec.accessionNumber);
    if (filingId == null) {
      return {
        ...sec,
        bdcFlowStatus: "MISSING",
        filingId: null,
        filingDetailHref: null,
      };
    }
    return {
      ...sec,
      bdcFlowStatus: "RECEIVED",
      filingId,
      filingDetailHref: filingDetailHref(filingId),
    };
  });

  const receivedInBdcFlow = rows.filter((r) => r.bdcFlowStatus === "RECEIVED").length;
  const secFilingsInCoverage = rows.length;
  const missingFromBdcFlow = secFilingsInCoverage - receivedInBdcFlow;

  return {
    rows,
    summary: {
      secFilingsInCoverage,
      receivedInBdcFlow,
      missingFromBdcFlow,
      coveragePercent: coveragePercent(receivedInBdcFlow, secFilingsInCoverage),
    },
    matchKeyNote:
      "Reconciliation uses exact SEC accession number equality against BDC Flow filing accession numbers. MISSING means the SEC filing is present in this coverage set but no matching BDC Flow filing was found — not that ingestion failed.",
  };
}
