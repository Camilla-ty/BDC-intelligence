import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import type { ReviewModel } from "@/lib/entity-review";
import {
  FILING_LINK_MISSING,
  HISTORY_EXPLANATION,
  historyChange,
  historyCoverageNotes,
  investmentHistory,
  type HistoryChange,
  type HistoryField,
  type HistoryRow,
} from "@/lib/investment-history";

function SummaryFact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function ChangedValue({ value, change }: { value: string; change: HistoryChange | undefined }) {
  return (
    <>
      <span className={change ? "font-semibold" : undefined}><StateText text={value} /></span>
      {change ? (
        <p className="mt-1 text-xs text-muted">
          <span className="block">Changed</span>
          <span className="block">Previous: {change.previous}</span>
          <span className="block">Current: {change.current}</span>
        </p>
      ) : null}
    </>
  );
}

function HistoryCell({
  label,
  row,
  field,
}: {
  label: string;
  row: HistoryRow;
  field: HistoryField;
}) {
  return (
    <td data-label={label} className="max-w-40 py-3 pr-3 align-top break-words">
      <ChangedValue value={row[field]} change={historyChange(row, field)} />
    </td>
  );
}

export function InvestmentHistory({
  model,
  memberIds,
}: {
  model: ReviewModel;
  memberIds?: readonly string[];
}) {
  const observations = model.groups.flatMap((group) => group.observations);
  const history = investmentHistory(observations, memberIds);
  const notes = historyCoverageNotes(history, {
    legalEntity: model.legalEntity,
    economicGroup: model.economicGroup,
  });
  return (
    <section className="mt-8" aria-labelledby="investment-history-heading">
      <h2 id="investment-history-heading" className="text-base font-semibold text-navy">Investment history</h2>
      <p className="mt-2 text-sm text-muted">{HISTORY_EXPLANATION}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <SummaryFact label="Source observations" value={history.observationCount} />
        <SummaryFact label="Disclosed-name variants" value={history.disclosedNameVariants} />
        <SummaryFact label="BDC registrant contexts" value={history.registrantContexts} />
        <SummaryFact label="Reporting periods" value={history.reportingPeriods} />
      </div>
      {history.unmatchedMemberCount > 0 ? (
        <p className="mt-3 text-sm">A case member was not returned by the observation read.</p>
      ) : null}
      <div className="mt-3 space-y-1 text-sm text-muted">
        {notes.map((note) => <p key={note}>{note}</p>)}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="record-table w-full border-collapse text-sm" aria-label="Investment history">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">Date</th>
              <th scope="col" className="py-2 pr-3 font-semibold">BDC</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Disclosed name</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Principal</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Cost</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Fair value</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Rate</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Spread</th>
              <th scope="col" className="py-2 pr-3 font-semibold">NAV %</th>
              <th scope="col" className="py-2 font-semibold">SEC filing</th>
            </tr>
          </thead>
          <tbody>
            {history.rows.map((row) => (
              <tr key={row.id} className="border-b border-line align-top">
                <td data-label="Date" className="py-3 pr-3 align-top whitespace-nowrap">{row.reportedDate}</td>
                <td data-label="BDC" className="py-3 pr-3 align-top break-words">
                  <p>{row.registrantName}</p>
                  <p className="mt-1 text-xs text-muted">CIK {row.registrantCik}</p>
                </td>
                <td data-label="Disclosed name" className="py-3 pr-3 align-top break-words">
                  <p>{row.disclosedName}</p>
                  <p className="mt-1 text-xs text-muted">Observation {row.id}</p>
                </td>
                <HistoryCell label="Principal" row={row} field="principal" />
                <HistoryCell label="Cost" row={row} field="cost" />
                <HistoryCell label="Fair value" row={row} field="fairValue" />
                <HistoryCell label="Rate" row={row} field="interestRate" />
                <HistoryCell label="Spread" row={row} field="spread" />
                <td data-label="NAV %" className="py-3 pr-3 align-top">
                  <StateText text={row.percentOfNetAssets} />
                </td>
                <td data-label="SEC filing" className="py-3 align-top break-words">
                  <p>{row.documentName}</p>
                  <p className="mt-1 text-xs text-muted">Filed date</p>
                  <p><StateText text={row.filedDate} /></p>
                  <p className="mt-1 text-xs text-muted">Accession</p>
                  <p className="break-all">{row.accessionNumber}</p>
                  <p className="mt-1">
                    <SecLink href={row.documentUrl} missing={FILING_LINK_MISSING}>SEC filing</SecLink>
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
