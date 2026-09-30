import Link from "next/link";
import { PortfolioLimits } from "@/components/PortfolioLimits";
import { StateText } from "@/components/StateText";
import { CIK_NOTE, EMPTY_LIST, EMPTY_SEARCH, SEARCH_NOTE, type PortfolioSummary } from "@/lib/portfolios";

export function PortfolioList({
  portfolios,
  query,
  error,
  emptyPeriods,
}: {
  portfolios: PortfolioSummary[];
  query: string;
  error: string | null;
  emptyPeriods: string[];
}) {
  const searching = query.trim() !== "";
  return (
    <section>
      <h1 className="text-lg font-semibold text-navy">BDC portfolios</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">Filing registrants with stored schedule-of-investments lines.</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{CIK_NOTE}</p>
      <PortfolioLimits emptyPeriods={emptyPeriods} />
      <form action="/portfolios" method="get" className="mt-4 flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="portfolio-query">Search CIK or reported name</label>
        <input
          id="portfolio-query"
          name="q"
          defaultValue={query}
          placeholder="Search CIK or reported name"
          className="min-w-0 w-full max-w-md flex-1 rounded-md border border-line bg-white px-3 py-2 text-sm sm:flex-none"
        />
        <button type="submit" className="shrink-0 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          Search
        </button>
      </form>
      {searching && portfolios.length > 0 ? <p className="mt-3 max-w-3xl text-sm">{SEARCH_NOTE}</p> : null}
      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}
      {!error && portfolios.length === 0 ? (
        <p className="mt-6 text-sm">{searching ? EMPTY_SEARCH : EMPTY_LIST}</p>
      ) : null}
      {portfolios.length > 0 ? (
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
              {portfolios.map((portfolio) => (
                <tr key={portfolio.cik} className="border-b border-line">
                  <td data-label="CIK" className="py-3 pr-4">
                    <Link href={`/portfolios/${portfolio.cik}`} className="font-semibold text-accent">
                      {portfolio.cik}
                    </Link>
                  </td>
                  <td data-label="Registrant name" className="py-3 pr-4">
                    <StateText text={portfolio.name} />
                  </td>
                  <td data-label="Reported dates" className="py-3">{portfolio.reportedDates}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
