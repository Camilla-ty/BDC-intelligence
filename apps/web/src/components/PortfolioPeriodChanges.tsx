import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import {
  EMPTY_PORTFOLIO_CREDIT,
  PORTFOLIO_CREDIT_NOTE,
  isLinkableLegalEntityId,
  portfolioCreditEvidence,
  portfolioCreditFactSummary,
  type PortfolioCreditEvent,
} from "@/lib/portfolio-credit-intelligence";
import {
  AMBIGUOUS_PERIOD_NOTE,
  BOTH_PERIOD_NOTE,
  EMPTY_CHANGED,
  EMPTY_EXIT,
  EMPTY_NEW,
  EXIT_NOTE,
  NEW_NOTE,
  SELECT_EARLIER,
  SELECT_LATER,
  UNRESOLVED_PERIOD_NOTE,
  type PeriodChangeView,
  type PeriodSummaryView,
} from "@/lib/portfolio-changes";
import { CIK_NOTE, secUrl } from "@/lib/portfolios";

function ChangeTable({
  rows,
  columns,
}: {
  rows: PeriodChangeView[];
  columns: Array<{ label: string; value: (row: PeriodChangeView) => string }>;
}) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="record-table w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
            {columns.map((column) => (
              <th key={column.label} scope="col" className="py-2 pr-4 font-semibold">{column.label}</th>
            ))}
            <th scope="col" className="py-2 font-semibold">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line">
              {columns.map((column) => (
                <td key={column.label} data-label={column.label} className="py-3 pr-4">
                  <StateText text={column.value(row)} />
                </td>
              ))}
              <td data-label="Evidence" className="py-3">
                <SecLink href={row.documentUrl} missing={row.accessionNumber}>{row.accessionNumber}</SecLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function instrumentLabel(event: PortfolioCreditEvent): string {
  if (event.instrument_type_state === "REPORTED" && event.instrument_type_raw != null && event.instrument_type_raw.trim() !== "") {
    return event.instrument_type_raw;
  }
  if (event.holding_descriptor_raw != null && event.holding_descriptor_raw.trim() !== "") {
    return event.holding_descriptor_raw;
  }
  if (event.instrument_type_state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}

function BorrowerLabel({ event }: { event: PortfolioCreditEvent }) {
  const name = event.borrower_name_raw != null && event.borrower_name_raw.trim() !== ""
    ? event.borrower_name_raw
    : "Unknown";
  if (isLinkableLegalEntityId(event.legal_entity_id)) {
    return (
      <Link href={`/borrowers/${event.legal_entity_id}`} className="text-accent">
        {name}
      </Link>
    );
  }
  return <StateText text={name} />;
}

export function PortfolioPeriodChanges({
  cik,
  name,
  dates,
  earlier,
  later,
  summary,
  intelligence = [],
  confirmed,
  observed,
  absent,
}: {
  cik: string;
  name: string;
  dates: string[];
  earlier: string | null;
  later: string | null;
  summary: PeriodSummaryView | null;
  intelligence?: PortfolioCreditEvent[];
  confirmed: PeriodChangeView[];
  observed: PeriodChangeView[];
  absent: PeriodChangeView[];
}) {
  const laterChoices = earlier == null ? [] : dates.filter((date) => date > earlier);
  return (
    <section>
      <p className="text-sm">
        <Link href={`/portfolios/${cik}`} className="text-accent">{cik}</Link>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">Historical Portfolio Changes</h1>
      <dl className="mt-3 grid max-w-3xl gap-2 text-sm">
        <div>
          <dt className="text-muted">BDC</dt>
          <dd><StateText text={name} /></dd>
        </div>
        <div>
          <dt className="text-muted">CIK</dt>
          <dd>{cik}</dd>
        </div>
      </dl>
      <p className="mt-2 max-w-3xl text-sm text-muted">{CIK_NOTE}</p>

      <h2 className="mt-6 text-sm font-semibold text-navy">Earlier period</h2>
      {earlier == null ? <p className="mt-2 text-sm">{SELECT_EARLIER}</p> : <p className="mt-2 text-sm">{earlier}</p>}
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {dates.map((date) => (
          <li key={`earlier-${date}`}>
            <Link href={`/portfolios/${cik}/changes?earlier=${date}`} className="text-accent">{date}</Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-6 text-sm font-semibold text-navy">Later period</h2>
      {later == null ? <p className="mt-2 text-sm">{SELECT_LATER}</p> : <p className="mt-2 text-sm">{later}</p>}
      {earlier != null ? (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {laterChoices.map((date) => (
            <li key={`later-${date}`}>
              <Link href={`/portfolios/${cik}/changes?earlier=${earlier}&later=${date}`} className="text-accent">{date}</Link>
            </li>
          ))}
        </ul>
      ) : null}

      {summary == null ? null : (
        <>
          <h2 className="mt-6 text-sm font-semibold text-navy">Comparison</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{BOTH_PERIOD_NOTE}</p>
          <p className="mt-1 max-w-3xl text-sm text-muted">{UNRESOLVED_PERIOD_NOTE}</p>
          <p className="mt-1 max-w-3xl text-sm text-muted">{AMBIGUOUS_PERIOD_NOTE}</p>
          <dl className="mt-3 grid max-w-3xl gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Earlier observations</dt><dd>{summary.earlierObservations}</dd></div>
            <div><dt className="text-muted">Later observations</dt><dd>{summary.laterObservations}</dd></div>
            <div><dt className="text-muted">Unresolved observations</dt><dd>{summary.unresolved}</dd></div>
            <div><dt className="text-muted">Resolved positions in both periods</dt><dd>{summary.observedInBoth}</dd></div>
            <div><dt className="text-muted">Confirmed position changes</dt><dd>{summary.changed}</dd></div>
            <div><dt className="text-muted">New positions observed</dt><dd>{summary.newPositions}</dd></div>
            <div><dt className="text-muted">Positions no longer observed</dt><dd>{summary.noLonger}</dd></div>
            <div><dt className="text-muted">Ambiguous positions</dt><dd>{summary.ambiguous}</dd></div>
          </dl>

          <h2 className="mt-6 text-sm font-semibold text-navy">Portfolio Credit Intelligence</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{PORTFOLIO_CREDIT_NOTE}</p>
          {intelligence.length === 0 ? <p className="mt-2 text-sm">{EMPTY_PORTFOLIO_CREDIT}</p> : (
            <ul className="mt-3 flex max-w-3xl flex-col gap-3 text-sm">
              {intelligence.map((event) => {
                const evidence = portfolioCreditEvidence(event);
                return (
                  <li key={event.key} className="border-t border-line pt-3">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span className="font-semibold text-navy">{event.report_date}</span>
                      <span className="text-xs uppercase tracking-wider text-muted">{event.event_type}</span>
                    </div>
                    <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-muted">Borrower</dt>
                        <dd><BorrowerLabel event={event} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wider text-muted">Instrument</dt>
                        <dd><StateText text={instrumentLabel(event)} /></dd>
                      </div>
                    </dl>
                    <p className="mt-2"><StateText text={portfolioCreditFactSummary(event)} /></p>
                    <p className="mt-1">
                      <SecLink href={secUrl(evidence.documentUrl)} missing={evidence.accessionNumber}>
                        {evidence.accessionNumber}
                      </SecLink>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          <h2 className="mt-6 text-sm font-semibold text-navy">Confirmed Position Changes</h2>
          {confirmed.length === 0 ? <p className="mt-2 text-sm">{EMPTY_CHANGED}</p> : (
            <ChangeTable
              rows={confirmed}
              columns={[
                { label: "Borrower", value: (row) => row.borrower },
                { label: "Instrument", value: (row) => row.instrument },
                { label: "Type", value: (row) => row.instrumentType },
                { label: "Fair value", value: (row) => row.fairValue },
                { label: "Principal", value: (row) => row.principal },
                { label: "Cost", value: (row) => row.cost },
                { label: "Maturity", value: (row) => row.maturity },
              ]}
            />
          )}

          <h2 className="mt-6 text-sm font-semibold text-navy">New Positions Observed</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{NEW_NOTE}</p>
          {observed.length === 0 ? <p className="mt-2 text-sm">{EMPTY_NEW}</p> : (
            <ChangeTable
              rows={observed}
              columns={[
                { label: "Borrower", value: (row) => row.borrower },
                { label: "Instrument", value: (row) => row.instrument },
                { label: "Type", value: (row) => row.instrumentType },
                { label: "Report date", value: (row) => row.reportDate },
                { label: "Principal", value: (row) => row.principal },
                { label: "Fair value", value: (row) => row.fairValue },
                { label: "Maturity", value: (row) => row.maturity },
              ]}
            />
          )}

          <h2 className="mt-6 text-sm font-semibold text-navy">Positions No Longer Observed</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{EXIT_NOTE}</p>
          {absent.length === 0 ? <p className="mt-2 text-sm">{EMPTY_EXIT}</p> : (
            <ChangeTable
              rows={absent}
              columns={[
                { label: "Borrower", value: (row) => row.borrower },
                { label: "Instrument", value: (row) => row.instrument },
                { label: "Type", value: (row) => row.instrumentType },
                { label: "Last observed date", value: (row) => row.reportDate },
                { label: "Principal", value: (row) => row.principal },
                { label: "Fair value", value: (row) => row.fairValue },
                { label: "Maturity", value: (row) => row.maturity },
              ]}
            />
          )}
        </>
      )}
    </section>
  );
}
