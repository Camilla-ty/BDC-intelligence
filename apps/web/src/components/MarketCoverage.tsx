import Link from "next/link";
import { StateText } from "@/components/StateText";
import { CIK_NOTE, EMPTY_SEARCH, SEARCH_NOTE } from "@/lib/portfolios";
import {
  ABSENCE_NOTE,
  BLOCKED_NOTE,
  COVERAGE_NOTE,
  DATE_NOTE,
  IDENTITY_NOTE,
  LINE_NOTE,
  RELEASE_NOTE,
  type DateCoverage,
  type RegistrantCoverage,
  type ReleaseCoverage,
} from "@/lib/market";

export function MarketCoverage({
  registrants,
  releases,
  dates,
  query,
  error,
}: {
  registrants: RegistrantCoverage[];
  releases: ReleaseCoverage[];
  dates: DateCoverage[];
  query: string;
  error: string | null;
}) {
  const searching = query.trim() !== "";
  const stored = registrants.filter((row) => row.state === "Stored lines");
  const covered = registrants.filter((row) => row.state === "Covered, no identified line");
  const unknown = registrants.filter((row) => row.state === "Unknown");
  return (
    <section>
      <h1 className="text-lg font-semibold text-navy">Market coverage</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Filing registrants, releases, and reported dates in the stored dataset.
      </p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{CIK_NOTE}</p>
      <div className="mt-3 max-w-3xl space-y-1 text-sm text-muted">
        <p>{COVERAGE_NOTE}</p>
        <p>{RELEASE_NOTE}</p>
        <p>{DATE_NOTE}</p>
        <p>{LINE_NOTE}</p>
        <p>{ABSENCE_NOTE}</p>
        <p>{BLOCKED_NOTE}</p>
        <p>{IDENTITY_NOTE}</p>
      </div>
      {error ? <p className="mt-6 text-sm text-foreground">{error}</p> : null}
      {!error ? (
        <>
          <form action="/market" method="get" className="mt-4 flex flex-wrap gap-2" role="search">
            <label className="sr-only" htmlFor="market-query">Search CIK or reported name</label>
            <input
              id="market-query"
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
          {searching && registrants.length === 0 ? <p className="mt-6 text-sm">{EMPTY_SEARCH}</p> : null}
          <RegistrantTable heading="Stored lines" rows={stored} />
          <RegistrantTable heading="Covered, no identified line" rows={covered} />
          <RegistrantTable heading="Unknown coverage" rows={unknown} />
          <h2 className="mt-8 text-base font-semibold text-navy">Releases</h2>
          <ReleaseTable rows={releases} />
          <h2 className="mt-8 text-base font-semibold text-navy">Reported dates</h2>
          <DateTable rows={dates} />
        </>
      ) : null}
    </section>
  );
}

function RegistrantTable({ heading, rows }: { heading: string; rows: RegistrantCoverage[] }) {
  return (
    <div className="mt-6">
      <h2 className="text-base font-semibold text-navy">{heading}</h2>
      {rows.length === 0 ? <p className="mt-2 text-sm">No registrant is listed in this state.</p> : null}
      {rows.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">CIK</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Registrant name</th>
                <th scope="col" className="py-2 font-semibold">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cik} className="border-b border-line">
                  <td data-label="CIK" className="py-3 pr-4">
                    {row.href ? (
                      <Link href={row.href} className="font-semibold text-accent">{row.cik}</Link>
                    ) : (
                      <span className="font-semibold">{row.cik}</span>
                    )}
                  </td>
                  <td data-label="Registrant name" className="py-3 pr-4"><StateText text={row.name} /></td>
                  <td data-label="Coverage" className="py-3"><StateText text={row.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function ReleaseTable({ rows }: { rows: ReleaseCoverage[] }) {
  if (rows.length === 0) return <p className="mt-2 text-sm">No release is stored.</p>;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="record-table w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
            <th scope="col" className="py-2 pr-4 font-semibold">Release</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Coverage</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Registrants observed</th>
            <th scope="col" className="py-2 font-semibold">Reported dates observed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line">
              <td data-label="Release" className="py-3 pr-4">
                <Link href={`/market/releases/${row.label}`} className="font-semibold text-accent">{row.label}</Link>
              </td>
              <td data-label="Coverage" className="py-3 pr-4"><StateText text={row.state} /></td>
              <td data-label="Registrants observed" className="py-3 pr-4"><StateText text={row.registrants} /></td>
              <td data-label="Reported dates observed" className="py-3"><StateText text={row.reportedDates} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DateTable({ rows }: { rows: DateCoverage[] }) {
  if (rows.length === 0) return <p className="mt-2 text-sm">No reported date is stored.</p>;
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="record-table w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
            <th scope="col" className="py-2 pr-4 font-semibold">Reported date</th>
            <th scope="col" className="py-2 font-semibold">Registrants observed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.reportedDate} className="border-b border-line">
              <td data-label="Reported date" className="py-3 pr-4">
                <Link href={`/market/dates/${row.reportedDate}`} className="font-semibold text-accent">
                  {row.reportedDate}
                </Link>
              </td>
              <td data-label="Registrants observed" className="py-3">{row.registrants}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
