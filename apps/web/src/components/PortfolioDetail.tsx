import Link from "next/link";
import { PortfolioLimits } from "@/components/PortfolioLimits";
import { StateText } from "@/components/StateText";
import { CIK_NOTE, type NameSourceRow, type RegistrantRow, type ReportedDate } from "@/lib/portfolios";

function attributeText(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw) return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}

export function PortfolioDetail({
  registrant,
  names,
  dates,
  emptyPeriods,
}: {
  registrant: RegistrantRow;
  names: NameSourceRow[];
  dates: ReportedDate[];
  emptyPeriods: string[];
}) {
  return (
    <section>
      <p className="text-sm">
        <Link href="/portfolios" className="text-accent">Portfolios</Link>
        {" · "}
        <Link href={`/maturity/${registrant.registrant_cik}`} className="text-accent">Maturity for this registrant</Link>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">{registrant.registrant_cik}</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">{CIK_NOTE}</p>
      <PortfolioLimits emptyPeriods={emptyPeriods} />
      <h2 className="mt-6 text-sm font-semibold text-navy">Registrant name sources</h2>
      {names.length === 0 ? <p className="mt-2 text-sm"><StateText text="Unknown" /></p> : (
        <ul className="mt-2 space-y-1 text-sm">
          {names.map((name, index) => (
            <li key={index}>
              {name.raw_value} <span className="text-muted">({name.source_type_code})</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="mt-4 grid max-w-xl gap-2 text-sm">
        <div>
          <dt className="text-muted">Ticker</dt>
          <dd><StateText text={attributeText(registrant.ticker_state, registrant.ticker_raw)} /></dd>
        </div>
        <div>
          <dt className="text-muted">File number</dt>
          <dd><StateText text={attributeText(registrant.file_number_state, registrant.file_number_raw)} /></dd>
        </div>
      </dl>
      <h2 className="mt-6 text-sm font-semibold text-navy">Reported dates</h2>
      {dates.length === 0 ? <p className="mt-2 text-sm"><StateText text="Unknown" /></p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">Reported date</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Disclosed lines</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Point in time lines</th>
                <th scope="col" className="py-2 font-semibold">Duration lines</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => (
                <tr key={date.reportedDate} className="border-b border-line">
                  <td data-label="Reported date" className="py-3 pr-4">
                    <Link
                      href={`/portfolios/${registrant.registrant_cik}/lines?date=${date.reportedDate}`}
                      className="text-accent"
                    >
                      {date.reportedDate}
                    </Link>
                  </td>
                  <td data-label="Disclosed lines" className="py-3 pr-4">{date.disclosedLines}</td>
                  <td data-label="Point in time lines" className="py-3 pr-4">{date.pointInTimeLines}</td>
                  <td data-label="Duration lines" className="py-3">{date.durationLines}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
