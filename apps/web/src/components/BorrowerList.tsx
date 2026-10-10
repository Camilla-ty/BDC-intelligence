import Link from "next/link";
import {
  COMPARISON_LIST_NOTE,
  COUNT_NOTE,
  EMPTY_LIST,
  EMPTY_SEARCH,
  SEARCH_NOTE,
  comparisonAvailabilityLabel,
  type BorrowerSummary,
} from "@/lib/borrowers";
import { StateText } from "@/components/StateText";

export function BorrowerList({
  borrowers,
  query,
  error,
  comparisonError = null,
}: {
  borrowers: BorrowerSummary[];
  query: string;
  error: string | null;
  comparisonError?: string | null;
}) {
  const searching = query.trim() !== "";
  return (
    <section>
      <h1 className="text-lg font-semibold text-navy">Borrowers</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">Entities with a stored matched name.</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{COUNT_NOTE}</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{COMPARISON_LIST_NOTE}</p>
      <form action="/borrowers" method="get" className="mt-4 flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="borrower-query">Search stored borrower names</label>
        <input
          id="borrower-query"
          name="q"
          defaultValue={query}
          placeholder="Search stored names"
          className="min-w-0 w-full max-w-md flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm sm:flex-none"
        />
        <button type="submit" className="shrink-0 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      {searching && borrowers.length > 0 ? <p className="mt-3 max-w-3xl text-sm">{SEARCH_NOTE}</p> : null}
      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}
      {!error && comparisonError ? (
        <p className="mt-6 text-sm text-foreground">{comparisonError}</p>
      ) : null}
      {!error && borrowers.length === 0 ? (
        <p className="mt-6 text-sm">{searching ? EMPTY_SEARCH : EMPTY_LIST}</p>
      ) : null}
      {borrowers.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-semibold">Borrower</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Period comparisons</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Name resolution</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Instrument identity</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Linked registrants</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Observed dates</th>
                <th scope="col" className="py-2 font-semibold">Stored observations</th>
              </tr>
            </thead>
            <tbody>
              {borrowers.map((borrower) => (
                <tr key={borrower.id} className="border-b border-line">
                  <td data-label="Borrower" className="sticky left-0 bg-background py-3 pr-4">
                    <Link href={`/borrowers/${borrower.id}`} className="font-semibold text-accent">
                      {borrower.name}
                    </Link>
                  </td>
                  <td data-label="Period comparisons" className="py-3 pr-4">
                    <StateText text={comparisonAvailabilityLabel(borrower)} />
                  </td>
                  <td data-label="Name resolution" className="py-3 pr-4">
                    <StateText text={`${borrower.entityState} · ${borrower.entityMethod}`} />
                  </td>
                  <td data-label="Instrument identity" className="py-3 pr-4">
                    <StateText text={`${borrower.instrumentState} · ${borrower.instrumentMethod}`} />
                  </td>
                  <td data-label="Linked registrants" className="py-3 pr-4">{borrower.linkedRegistrants}</td>
                  <td data-label="Observed dates" className="py-3 pr-4">{borrower.observedDates}</td>
                  <td data-label="Stored observations" className="py-3">{borrower.storedObservations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
