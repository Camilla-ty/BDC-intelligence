import Link from "next/link";
import { StateText } from "@/components/StateText";
import {
  countText,
  inventoryListHref,
  listText,
  optionalText,
  processingOutcomesText,
  registrantNameText,
  type AdminFilingInventoryListRow,
} from "@/lib/admin-filings";
import { PAGE_SIZE } from "@/lib/portfolios";

export function AdminFilingInventory({
  rows,
  query,
  error,
  page,
  hasPrevious,
  hasNext,
  pastEnd,
}: {
  rows: AdminFilingInventoryListRow[];
  query: string;
  error: string | null;
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  pastEnd: boolean;
}) {
  const searching = query.trim() !== "";
  const previous = inventoryListHref(query, page - 1);
  const next = inventoryListHref(query, page + 1);
  const first = inventoryListHref(query, 1);
  return (
    <section>
      <p className="text-sm">
        <Link href="/admin" className="text-accent">Admin</Link>
        <span className="text-muted"> / Filing inventory</span>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">Filing inventory</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        SEC filings from the admin filing read model. Counts and outcomes are as stored; missing values stay Unknown.
      </p>
      <form action="/admin/filings" method="get" className="mt-4 flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="admin-filing-query">
          Search accession, registrant, form, or CIK
        </label>
        <input
          id="admin-filing-query"
          name="q"
          defaultValue={query}
          placeholder="Search accession, registrant, form, or CIK"
          className="min-w-0 w-full max-w-md flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm sm:flex-none"
        />
        <button type="submit" className="shrink-0 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}
      {pastEnd ? (
        <p className="mt-6 text-sm">
          This page is past the filing inventory. <Link href={first} className="text-accent">First page</Link>
        </p>
      ) : null}
      {!error && !pastEnd && rows.length === 0 ? (
        <p className="mt-6 text-sm">{searching ? "No filings match this search." : "No filings in the admin inventory."}</p>
      ) : null}
      {rows.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">Accession</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Registrant</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Name state</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Form</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Filed</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Period</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Docs</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Artifacts</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Processing</th>
                <th scope="col" className="py-2 pr-3 font-semibold">SOI</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Positions</th>
                <th scope="col" className="py-2 pr-3 font-semibold">NUM</th>
                <th scope="col" className="py-2 font-semibold">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.filing_id} className="border-b border-line align-top">
                  <td data-label="Accession" className="py-2 pr-3">
                    <Link href={`/admin/filings/${row.filing_id}`} className="font-semibold text-accent">
                      {row.accession_number}
                    </Link>
                  </td>
                  <td data-label="Registrant" className="py-2 pr-3">
                    <StateText text={registrantNameText(row.registrant_name_state, row.registrant_name_raw)} />
                  </td>
                  <td data-label="Name state" className="py-2 pr-3">{row.registrant_name_state}</td>
                  <td data-label="Form" className="py-2 pr-3"><StateText text={listText(row.forms)} /></td>
                  <td data-label="Filed" className="py-2 pr-3"><StateText text={listText(row.filed_dates)} /></td>
                  <td data-label="Period" className="py-2 pr-3"><StateText text={listText(row.report_periods)} /></td>
                  <td data-label="Docs" className="py-2 pr-3">{countText(row.document_count)}</td>
                  <td data-label="Artifacts" className="py-2 pr-3">{countText(row.artifact_count)}</td>
                  <td data-label="Processing" className="py-2 pr-3">
                    {row.processing_outcomes == null ? (
                      <span className="text-muted">{processingOutcomesText(null)}</span>
                    ) : (
                      processingOutcomesText(row.processing_outcomes)
                    )}
                  </td>
                  <td data-label="SOI" className="py-2 pr-3">{countText(row.soi_row_observation_count)}</td>
                  <td data-label="Positions" className="py-2 pr-3">{countText(row.position_observation_count)}</td>
                  <td data-label="NUM" className="py-2 pr-3">{countText(row.num_fact_observation_count)}</td>
                  <td data-label="Recorded" className="py-2">
                    <StateText text={optionalText(row.filing_recorded_at)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!error ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <p className="text-muted">Page {page}. {PAGE_SIZE} filings per page.</p>
          {hasPrevious || hasNext ? (
            <p>
              {hasPrevious ? <Link href={previous} className="text-accent">Previous</Link> : <span className="text-muted">Previous</span>}
              {" · "}
              {hasNext ? <Link href={next} className="text-accent">Next</Link> : <span className="text-muted">Next</span>}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
