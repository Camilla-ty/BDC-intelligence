import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import { viewSecFilingUrl, type SecSubmissionsCoverage } from "@/lib/sec-submissions";
import { ARCC_CIK, ARCC_NAME, ARCC_TICKER } from "@/server/sec/config";

export function ArccSecCoverage({
  coverage,
  error,
}: {
  coverage: SecSubmissionsCoverage | null;
  error: string | null;
}) {
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
        This page shows the filing list reported by the official SEC submissions API.
        It does not reconcile those filings with BDC Flow, and it does not update or ingest filings.
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
              <dt className="text-xs uppercase tracking-wider text-muted">Filings in this list</dt>
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
          </dl>
          <p className="mt-4 max-w-4xl text-sm text-muted">{coverage.coverageNote}</p>

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
                    <th scope="col" className="py-2 pr-3 font-semibold">Report Date</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Primary Document</th>
                    <th scope="col" className="py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.filings.map((row) => {
                    const viewUrl = viewSecFilingUrl(row);
                    return (
                      <tr key={row.accessionNumber} className="border-b border-line align-top">
                        <td data-label="SEC Accession" className="py-2 pr-3 font-semibold">
                          {row.accessionNumber}
                        </td>
                        <td data-label="Form" className="py-2 pr-3">{row.form}</td>
                        <td data-label="Filed" className="py-2 pr-3">{row.filingDate}</td>
                        <td data-label="Report Date" className="py-2 pr-3">
                          <StateText text={row.reportDate ?? "Unknown"} />
                        </td>
                        <td data-label="Primary Document" className="py-2 pr-3 break-all">
                          {row.primaryDocument ? (
                            row.primaryDocumentUrl ? (
                              <SecLink href={row.primaryDocumentUrl}>{row.primaryDocument}</SecLink>
                            ) : (
                              row.primaryDocument
                            )
                          ) : (
                            <StateText text="Unknown" />
                          )}
                          {row.acceptanceDateTime ? (
                            <div className="mt-1 text-xs text-muted">Accepted {row.acceptanceDateTime}</div>
                          ) : null}
                        </td>
                        <td data-label="Action" className="py-2">
                          {viewUrl ? (
                            <SecLink href={viewUrl}>View SEC filing</SecLink>
                          ) : (
                            <span className="text-muted">Unavailable</span>
                          )}
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
