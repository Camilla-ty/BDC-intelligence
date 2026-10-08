import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import { CIK_NOTE } from "@/lib/portfolios";
import {
  CHANGE_NOTE,
  EMPTY_CHANGES,
  EMPTY_HOLDINGS,
  PERIOD_NOTE,
  TOTAL_NOTE,
  type ChangeView,
  type HoldingView,
  type SummaryView,
} from "@/lib/portfolio-holdings";

export function PortfolioHoldings({
  cik,
  name,
  reportedDate,
  summary,
  holdings,
  changes,
  page,
  hasPrevious,
  hasNext,
  pastEnd,
}: {
  cik: string;
  name: string;
  reportedDate: string;
  summary: SummaryView;
  holdings: HoldingView[];
  changes: ChangeView[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  pastEnd: boolean;
}) {
  const previous = `/portfolios/${cik}/holdings?date=${reportedDate}&page=${page - 1}`;
  const next = `/portfolios/${cik}/holdings?date=${reportedDate}&page=${page + 1}`;
  const first = `/portfolios/${cik}/holdings?date=${reportedDate}`;
  return (
    <section>
      <p className="text-sm">
        <Link href={`/portfolios/${cik}`} className="text-accent">{cik}</Link>
        {" · "}
        <Link href={`/portfolios/${cik}/lines?date=${reportedDate}`} className="text-accent">Disclosed lines</Link>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">BDC Portfolio</h1>
      <dl className="mt-3 grid max-w-3xl gap-2 text-sm">
        <div>
          <dt className="text-muted">BDC</dt>
          <dd><StateText text={name} /></dd>
        </div>
        <div>
          <dt className="text-muted">CIK</dt>
          <dd>{cik}</dd>
        </div>
        <div>
          <dt className="text-muted">Reporting period</dt>
          <dd>{reportedDate}</dd>
        </div>
      </dl>
      <p className="mt-2 max-w-3xl text-sm text-muted">{CIK_NOTE}</p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{PERIOD_NOTE}</p>

      <h2 className="mt-6 text-sm font-semibold text-navy">Portfolio summary</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">{TOTAL_NOTE}</p>
      <dl className="mt-3 grid max-w-3xl gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Positions observed</dt><dd>{summary.observations}</dd></div>
        <div><dt className="text-muted">Resolved positions</dt><dd>{summary.resolved}</dd></div>
        <div><dt className="text-muted">Unresolved positions</dt><dd>{summary.unresolved}</dd></div>
        <div><dt className="text-muted">Known principal</dt><dd>{summary.knownPrincipal}</dd></div>
        <div><dt className="text-muted">Known fair value</dt><dd>{summary.knownFairValue}</dd></div>
        <div><dt className="text-muted">Known maturity</dt><dd>{summary.knownMaturity}</dd></div>
        <div><dt className="text-muted">Unknown or ambiguous currency</dt><dd>{summary.unknownCurrency}</dd></div>
        <div><dt className="text-muted">Principal total</dt><dd><StateText text={summary.principalTotal} /></dd></div>
        <div><dt className="text-muted">Fair value total</dt><dd><StateText text={summary.fairValueTotal} /></dd></div>
      </dl>

      <h2 className="mt-6 text-sm font-semibold text-navy">Portfolio changes</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">{CHANGE_NOTE}</p>
      {changes.length === 0 ? <p className="mt-2 text-sm"><StateText text={EMPTY_CHANGES} /></p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">Position</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Report dates</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Principal</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Fair value</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Maturity</th>
                <th scope="col" className="py-2 font-semibold">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.positionId} className="border-b border-line">
                  <td data-label="Position" className="py-3 pr-4">{change.positionId}</td>
                  <td data-label="Report dates" className="py-3 pr-4">{change.dates}</td>
                  <td data-label="Principal" className="py-3 pr-4"><StateText text={change.principal} /></td>
                  <td data-label="Fair value" className="py-3 pr-4"><StateText text={change.fairValue} /></td>
                  <td data-label="Maturity" className="py-3 pr-4">{change.maturity}</td>
                  <td data-label="Evidence" className="py-3">{change.accessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-6 text-sm font-semibold text-navy">Portfolio holdings</h2>
      {pastEnd ? (
        <p className="mt-2 text-sm">
          This page is past the stored holdings. <Link href={first} className="text-accent">First page</Link>
        </p>
      ) : null}
      {!pastEnd && holdings.length === 0 ? <p className="mt-2 text-sm"><StateText text={EMPTY_HOLDINGS} /></p> : null}
      {holdings.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">Borrower</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Instrument</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Type</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Principal</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Cost</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Fair value</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Maturity</th>
                <th scope="col" className="py-2 font-semibold">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.observationId} className="border-b border-line">
                  <td data-label="Borrower" className="py-3 pr-4"><StateText text={holding.borrower} /></td>
                  <td data-label="Instrument" className="py-3 pr-4">{holding.instrument}</td>
                  <td data-label="Type" className="py-3 pr-4"><StateText text={holding.instrumentType} /></td>
                  <td data-label="Principal" className="py-3 pr-4">{holding.principal}</td>
                  <td data-label="Cost" className="py-3 pr-4">{holding.cost}</td>
                  <td data-label="Fair value" className="py-3 pr-4">{holding.fairValue}</td>
                  <td data-label="Maturity" className="py-3 pr-4"><StateText text={holding.maturity} /></td>
                  <td data-label="Evidence" className="py-3">
                    <span className="text-muted">{holding.resolution}. </span>
                    <SecLink href={holding.documentUrl} missing={holding.accessionNumber}>{holding.accessionNumber}</SecLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {hasPrevious || hasNext ? (
        <p className="mt-3 text-sm">
          {hasPrevious ? <Link href={previous} className="text-accent">Previous</Link> : <span className="text-muted">Previous</span>}
          {" · "}
          {hasNext ? <Link href={next} className="text-accent">Next</Link> : <span className="text-muted">Next</span>}
        </p>
      ) : null}
    </section>
  );
}
