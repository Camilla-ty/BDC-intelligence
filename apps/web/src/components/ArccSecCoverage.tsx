import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import {
  formatCoveragePercent,
  type SecCoverageReconciliation,
} from "@/lib/sec-coverage-reconcile";
import { viewSecFilingUrl, type SecSubmissionsCoverage } from "@/lib/sec-submissions";
import { ARCC_CIK, ARCC_NAME, ARCC_TICKER } from "@/server/sec/config";

export function ArccSecCoverage({
  coverage,
  reconciliation,
  reconciliationError,
  bdcFlowOnlyCount,
  error,
}: {
  coverage: SecSubmissionsCoverage | null;
  reconciliation: SecCoverageReconciliation | null;
  reconciliationError: string | null;
  bdcFlowOnlyCount: number | null;
  error: string | null;
}) {
  const summary = reconciliation?.summary;

  return (
    <section>
      <p className="text-sm">
        <Link href="/admin" className="text-accent">Admin</Link>
        <span className="text-muted"> / SEC coverage / {ARCC_TICKER}</span>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">{ARCC_TICKER} — SEC Filing Coverage</h1>
      <p className="mt-1 text-sm font-semibold">{coverage?.registrantName ?? ARCC_NAME}</p>
      <p className="mt-1 text-sm text-muted">CIK {coverage?.cik ?? ARCC_CIK}</p>
      <p className="mt-3 max-w-3xl text-sm text-muted">
        This page shows the filing list reported by the official SEC submissions API and reconciles
        it with BDC Flow by exact accession number only. It does not update or ingest filings.
        MISSING means the SEC filing is in this coverage set but no matching BDC Flow filing was found —
        not that ingestion failed.
      </p>

      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}

      {coverage ? (
        <>
          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">SEC source</dt>
              <dd className="mt-1 break-all">
                <SecLink href={coverage.sourceUrl}>{coverage.sourceUrl}</SecLink>
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Last fetched</dt>
              <dd className="mt-1">{coverage.fetchedAt}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">SEC filings in coverage</dt>
              <dd className="mt-1 font-semibold">{coverage.filings.length}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Recent window count</dt>
              <dd className="mt-1">{coverage.recentCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">History pages fetched</dt>
              <dd className="mt-1">
                {coverage.historyPagesFetched}
                {coverage.historyPagesSkipped > 0
                  ? ` (${coverage.historyPagesSkipped} skipped)`
                  : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Filing-date span</dt>
              <dd className="mt-1">
                <StateText
                  text={
                    coverage.coverageFrom && coverage.coverageTo
                      ? `${coverage.coverageFrom} to ${coverage.coverageTo}`
                      : "Unknown"
                  }
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Received in BDC Flow</dt>
              <dd className="mt-1 font-semibold">
                {summary ? summary.receivedInBdcFlow : <StateText text="Unavailable" />}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Missing from BDC Flow</dt>
              <dd className="mt-1 font-semibold">
                {summary ? summary.missingFromBdcFlow : <StateText text="Unavailable" />}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Coverage</dt>
              <dd className="mt-1 font-semibold">
                {summary ? (
                  formatCoveragePercent(summary.coveragePercent)
                ) : (
                  <StateText text="Unavailable" />
                )}
              </dd>
            </div>
          </dl>

          <p className="mt-4 max-w-4xl text-sm text-muted">{coverage.coverageNote}</p>
          {reconciliation ? (
            <p className="mt-2 max-w-4xl text-sm text-muted">{reconciliation.matchKeyNote}</p>
          ) : null}
          {reconciliationError ? (
            <p className="mt-2 max-w-4xl text-sm text-foreground">
              Reconciliation unavailable: {reconciliationError} SEC filings are listed below without
              RECEIVED/MISSING classification.
            </p>
          ) : null}
          {bdcFlowOnlyCount != null ? (
            <p className="mt-2 max-w-4xl text-sm text-muted">
              BDC Flow filings linked to ARCC CIK but not in this SEC coverage list: {bdcFlowOnlyCount}.
              Those rows are not shown in the table below.
            </p>
          ) : null}

          {coverage.filings.length === 0 ? (
            <p className="mt-6 text-sm">No SEC filings were returned for this CIK.</p>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="record-table w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                    <th scope="col" className="py-2 pr-3 font-semibold">SEC Accession</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Form</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Filed</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">BDC Flow</th>
                    <th scope="col" className="py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(reconciliation?.rows ?? coverage.filings.map((sec) => ({
                    ...sec,
                    bdcFlowStatus: null as null,
                    filingId: null as null,
                    filingDetailHref: null as null,
                  }))).map((row) => {
                    const viewUrl = viewSecFilingUrl(row);
                    return (
                      <tr key={row.accessionNumber} className="border-b border-line align-top">
                        <td data-label="SEC Accession" className="py-2 pr-3 font-semibold">
                          {row.accessionNumber}
                        </td>
                        <td data-label="Form" className="py-2 pr-3">{row.form}</td>
                        <td data-label="Filed" className="py-2 pr-3">{row.filingDate}</td>
                        <td data-label="BDC Flow" className="py-2 pr-3">
                          {row.bdcFlowStatus == null ? (
                            <StateText text="Unavailable" />
                          ) : (
                            row.bdcFlowStatus
                          )}
                        </td>
                        <td data-label="Action" className="py-2">
                          {row.bdcFlowStatus === "RECEIVED" && row.filingDetailHref ? (
                            <Link href={row.filingDetailHref} className="text-accent font-semibold">
                              View
                            </Link>
                          ) : null}
                          {row.bdcFlowStatus === "MISSING" || row.bdcFlowStatus == null ? (
                            <span className="inline-flex flex-col gap-1">
                              {viewUrl ? (
                                <SecLink href={viewUrl}>View SEC filing</SecLink>
                              ) : (
                                <span className="text-muted">SEC link unavailable</span>
                              )}
                              {row.bdcFlowStatus === "MISSING" ? (
                                <span className="text-muted" title="Ingestion arrives in a later phase">
                                  Update (not available yet)
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
