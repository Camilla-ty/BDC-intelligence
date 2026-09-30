import Link from "next/link";
import { PortfolioLimits } from "@/components/PortfolioLimits";
import { StateText } from "@/components/StateText";
import { CIK_NOTE, EMPTY_LIST, EMPTY_SEARCH, SEARCH_NOTE, type PortfolioSummary } from "@/lib/portfolios";
import { BOUNDARY_NOTE, UNKNOWN_MATURITY_NOTE, WALL_NOTE } from "@/lib/maturity";

export function MaturityList({
  registrants,
  query,
  error,
  emptyPeriods,
}: {
  registrants: PortfolioSummary[];
  query: string;
  error: string | null;
  emptyPeriods: string[];
}) {
  const searching = query.trim() !== "";
  return (
    <section>
      <h1 className="text-lg font-semibold text-navy">Maturity wall</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">Filing registrants. Open a registrant to see disclosed maturity dates on each reported date.</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{CIK_NOTE}</p>
      <div className="mt-3 max-w-3xl space-y-1 text-sm text-muted">
        <p>{WALL_NOTE}</p>
        <p>{UNKNOWN_MATURITY_NOTE}</p>
        <p>{BOUNDARY_NOTE}</p>
      </div>
      <PortfolioLimits emptyPeriods={emptyPeriods} />
      <form action="/maturity" method="get" className="mt-4 flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="maturity-query">Search CIK or reported name</label>
        <input
          id="maturity-query"
          name="q"
          defaultValue={query}
          placeholder="Search CIK or reported name"
          className="min-w-0 w-full max-w-md flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm sm:flex-none"
        />
        <button type="submit" className="shrink-0 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      {searching && registrants.length > 0 ? <p className="mt-3 max-w-3xl text-sm">{SEARCH_NOTE}</p> : null}
      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}
      {!error && registrants.length === 0 ? (
        <p className="mt-6 text-sm">{searching ? EMPTY_SEARCH : EMPTY_LIST}</p>
      ) : null}
      {registrants.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">CIK</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Registrant name</th>
                <th scope="col" className="py-2 font-semibold">Reported dates</th>
              </tr>
            </thead>
            <tbody>
              {registrants.map((registrant) => (
                <tr key={registrant.cik} className="border-b border-line">
                  <td data-label="CIK" className="py-3 pr-4">
                    <Link href={`/maturity/${registrant.cik}`} className="font-semibold text-accent">
                      {registrant.cik}
                    </Link>
                  </td>
                  <td data-label="Registrant name" className="py-3 pr-4">
                    <StateText text={registrant.name} />
                  </td>
                  <td data-label="Reported dates" className="py-3">{registrant.reportedDates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
