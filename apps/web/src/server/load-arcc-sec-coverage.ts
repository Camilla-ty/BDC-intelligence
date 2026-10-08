import {
  indexBdcFlowByAccession,
  reconcileSecFilingsWithBdcFlow,
  type SecCoverageReconciliation,
} from "@/lib/sec-coverage-reconcile";
import type { SecSubmissionsCoverage } from "@/lib/sec-submissions";
import { requireAdmin } from "@/server/auth/access";
import {
  loadArccBdcFlowOnlyCount,
  loadBdcFlowFilingRefsByAccession,
  type SqlExecutor,
} from "@/server/load-arcc-bdc-filings";
import { fetchArccSecSubmissions, type FetchArccOptions } from "@/server/sec/fetch-arcc-submissions";

export type LoadArccSecCoverageOptions = FetchArccOptions & {
  executeSqlImpl?: SqlExecutor;
  /** Test hook: skip inventory load and inject refs / error. */
  bdcFlowRefs?: {
    refs?: Awaited<ReturnType<typeof loadBdcFlowFilingRefsByAccession>>["refs"];
    error?: string | null;
    bdcFlowOnlyCount?: number | null;
    bdcFlowOnlyError?: string | null;
  };
};

export type ArccSecCoverageResult = {
  coverage: SecSubmissionsCoverage | null;
  reconciliation: SecCoverageReconciliation | null;
  reconciliationError: string | null;
  /** ARCC-linked BDC Flow filings absent from this SEC coverage set; null when unavailable. */
  bdcFlowOnlyCount: number | null;
  error: string | null;
};

/**
 * Phase 1-B loader: requireAdmin → SEC submissions fetch → admin.filing_inventory accession match.
 * SEC failure does not invent MISSING rows. Inventory failure does not classify as MISSING.
 */
export async function loadArccSecCoverage(
  options: LoadArccSecCoverageOptions = {},
): Promise<ArccSecCoverageResult> {
  await requireAdmin();

  const { coverage, error } = await fetchArccSecSubmissions(options);
  if (error || coverage == null) {
    return {
      coverage: null,
      reconciliation: null,
      reconciliationError: null,
      bdcFlowOnlyCount: null,
      error: error ?? "SEC submissions could not be loaded.",
    };
  }

  const accessions = coverage.filings.map((f) => f.accessionNumber);

  let refs: Awaited<ReturnType<typeof loadBdcFlowFilingRefsByAccession>>["refs"];
  let inventoryError: string | null;
  let bdcFlowOnlyCount: number | null;
  let bdcFlowOnlyError: string | null;

  if (options.bdcFlowRefs) {
    refs = options.bdcFlowRefs.refs ?? [];
    inventoryError = options.bdcFlowRefs.error ?? null;
    bdcFlowOnlyCount = options.bdcFlowRefs.bdcFlowOnlyCount ?? null;
    bdcFlowOnlyError = options.bdcFlowRefs.bdcFlowOnlyError ?? null;
  } else {
    const matched = await loadBdcFlowFilingRefsByAccession(accessions, {
      executeSqlImpl: options.executeSqlImpl,
    });
    refs = matched.refs;
    inventoryError = matched.error;
    const only = await loadArccBdcFlowOnlyCount(accessions, {
      cik: coverage.cik,
      executeSqlImpl: options.executeSqlImpl,
    });
    bdcFlowOnlyCount = only.count;
    bdcFlowOnlyError = only.error;
  }

  if (inventoryError) {
    return {
      coverage,
      reconciliation: null,
      reconciliationError: inventoryError,
      bdcFlowOnlyCount: bdcFlowOnlyError ? null : bdcFlowOnlyCount,
      error: null,
    };
  }

  const reconciliation = reconcileSecFilingsWithBdcFlow(
    coverage.filings,
    indexBdcFlowByAccession(refs),
  );

  return {
    coverage,
    reconciliation,
    reconciliationError: null,
    bdcFlowOnlyCount: bdcFlowOnlyError ? null : bdcFlowOnlyCount,
    error: null,
  };
}
