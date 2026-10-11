import Link from "next/link";
import {
  COMPARISON_FILTER_NOTE,
  COMPARISON_LIST_NOTE,
  COUNT_NOTE,
  EMPTY_COMPARISON_FILTER,
  EMPTY_LIST,
  EMPTY_SEARCH,
  SEARCH_NOTE,
  comparisonAvailabilityLabel,
  type BorrowerListSort,
  type BorrowerSummary,
  type ComparisonAvailabilityFilter,
} from "@/lib/borrowers";
import { StateText } from "@/components/StateText";

export function BorrowerList({
  borrowers,
  query,
  comparisonFilter = "all",
  sort = "name",
  error,
  comparisonError = null,
  matchedBeforeComparisonFilter,
}: {
  borrowers: BorrowerSummary[];
  query: string;
  comparisonFilter?: ComparisonAvailabilityFilter;
  sort?: BorrowerListSort;
  error: string | null;
  comparisonError?: string | null;
  /** Count after name search, before comparison filter; used for empty-state selection. */
  matchedBeforeComparisonFilter?: number;
}) {
  const searching = query.trim() !== "";
  const comparisonFiltered = comparisonFilter !== "all";
  const priorMatchCount = matchedBeforeComparisonFilter ?? borrowers.length;
  let emptyMessage: string | null = null;
  // When availability failed, has/none exclude Unavailable rows; do not imply a known empty match set.
  if (!error && borrowers.length === 0 && !(comparisonError && comparisonFiltered)) {
    if (searching && priorMatchCount === 0) emptyMessage = EMPTY_SEARCH;
    else if (comparisonFiltered) emptyMessage = EMPTY_COMPARISON_FILTER;
    else emptyMessage = searching ? EMPTY_SEARCH : EMPTY_LIST;
  }
  return (
    <section>
      <h1 className="text-lg font-semibold text-navy">Borrowers</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">Entities with a stored matched name.</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{COUNT_NOTE}</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{COMPARISON_LIST_NOTE}</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{COMPARISON_FILTER_NOTE}</p>
      <form action="/borrowers" method="get" className="mt-4 flex flex-wrap items-end gap-2" role="search">
        <label className="sr-only" htmlFor="borrower-query">Search stored borrower names</label>
        <input
          id="borrower-query"
          name="q"
          defaultValue={query}
          placeholder="Search stored names"
          className="min-w-0 w-full max-w-md flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm sm:flex-none"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="borrower-comparisons" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Comparisons
          </label>
          <select
            id="borrower-comparisons"
            name="comparisons"
            defaultValue={comparisonFilter}
            className="rounded-md border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="all">All borrowers</option>
            <option value="has">Has comparisons</option>
            <option value="none">No comparisons</option>
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="borrower-sort" className="text-xs font-semibold uppercase tracking-wider text-muted">
            Sort
          </label>
          <select
            id="borrower-sort"
            name="sort"
            defaultValue={sort}
            className="rounded-md border border-line bg-white px-3 py-2 text-sm"
          >
            <option value="name">Name</option>
            <option value="comparisons_desc">Comparison count (high to low)</option>
            <option value="comparisons_asc">Comparison count (low to high)</option>
            <option value="latest_desc">Latest comparison (newest)</option>
            <option value="latest_asc">Latest comparison (oldest)</option>
          </select>
        </div>
        <button type="submit" className="shrink-0 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          Apply
        </button>
      </form>
      {searching && priorMatchCount > 0 ? <p className="mt-3 max-w-3xl text-sm">{SEARCH_NOTE}</p> : null}
      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}
      {!error && comparisonError ? (
        <p className="mt-6 text-sm text-foreground">{comparisonError}</p>
      ) : null}
      {emptyMessage ? <p className="mt-6 text-sm">{emptyMessage}</p> : null}
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
