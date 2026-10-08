import Link from "next/link";
import { StateText } from "@/components/StateText";
import {
  countText,
  listText,
  processingOutcomesText,
  registrantNameText,
  type AdminDashboardSummary,
} from "@/lib/admin-filings";

export function AdminDashboard({
  summary,
  error,
}: {
  summary: AdminDashboardSummary | null;
  error: string | null;
}) {
  return (
    <section>
      <h1 className="text-lg font-semibold text-navy">Admin</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Read-only view of what was received from the SEC, how it was processed, and what was produced.
      </p>
      <p className="mt-3 flex flex-wrap gap-4">
        <Link href="/admin/filings" className="text-sm font-semibold text-accent">
          Filing inventory
        </Link>
        <Link href="/admin/coverage/arcc" className="text-sm font-semibold text-accent">
          ARCC SEC coverage
        </Link>
      </p>
      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}
      {!error && summary == null ? (
        <p className="mt-6 text-sm"><StateText text="Unknown" /></p>
      ) : null}
      {summary ? (
        <>
          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Total filings</dt>
              <dd className="mt-1 font-semibold">{countText(summary.total_filings)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">With documents</dt>
              <dd className="mt-1 font-semibold">{countText(summary.filings_with_documents)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">With artifacts</dt>
              <dd className="mt-1 font-semibold">{countText(summary.filings_with_artifacts)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">With processing rows</dt>
              <dd className="mt-1 font-semibold">{countText(summary.filings_with_processing)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">With observations</dt>
              <dd className="mt-1 font-semibold">{countText(summary.filings_with_observations)}</dd>
            </div>
          </dl>
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Recent filings</h2>
          {summary.recent.length === 0 ? (
            <p className="mt-3 text-sm">No filings in the admin inventory.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="record-table w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                    <th scope="col" className="py-2 pr-4 font-semibold">Accession</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Registrant</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Form</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Filed</th>
                    <th scope="col" className="py-2 font-semibold">Processing</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((row) => (
                    <tr key={row.filing_id} className="border-b border-line">
                      <td data-label="Accession" className="py-3 pr-4">
                        <Link href={`/admin/filings/${row.filing_id}`} className="font-semibold text-accent">
                          {row.accession_number}
                        </Link>
                      </td>
                      <td data-label="Registrant" className="py-3 pr-4">
                        <StateText text={registrantNameText(row.registrant_name_state, row.registrant_name_raw)} />
                      </td>
                      <td data-label="Form" className="py-3 pr-4">
                        <StateText text={listText(row.forms)} />
                      </td>
                      <td data-label="Filed" className="py-3 pr-4">
                        <StateText text={listText(row.filed_dates)} />
                      </td>
                      <td data-label="Processing" className="py-3">
                        {row.processing_outcomes == null ? (
                          <span className="text-muted">{processingOutcomesText(null)}</span>
                        ) : (
                          processingOutcomesText(row.processing_outcomes)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
