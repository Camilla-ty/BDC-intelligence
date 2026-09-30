import Link from "next/link";
import { PortfolioLimits } from "@/components/PortfolioLimits";
import { StateText } from "@/components/StateText";
import {
  BOUNDARY_NOTE,
  MULTIPLE_MATURITY_NOTE,
  UNKNOWN_MATURITY_NOTE,
  WALL_NOTE,
  type MaturityDate,
  type MaturityYear,
} from "@/lib/maturity";
import { CIK_NOTE, type NameSourceRow, type RegistrantRow } from "@/lib/portfolios";

function attributeText(state: string, raw: string | null): string {
  if (state === "REPORTED" && raw) return raw;
  if (state === "MULTIPLE_VALUES") return "Multiple values";
  return "Unknown";
}

export function MaturityDetail({
  registrant,
  names,
  dates,
  years,
  emptyPeriods,
}: {
  registrant: RegistrantRow;
  names: NameSourceRow[];
  dates: MaturityDate[];
  years: MaturityYear[];
  emptyPeriods: string[];
}) {
  return (
    <section>
      <p className="text-sm">
        <Link href="/maturity" className="text-accent">Maturity</Link>
        {" · "}
        <Link href={`/portfolios/${registrant.registrant_cik}`} className="text-accent">Portfolio for this registrant</Link>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">{registrant.registrant_cik}</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">{CIK_NOTE}</p>
      <div className="mt-3 max-w-3xl space-y-1 text-sm text-muted">
        <p>{WALL_NOTE}</p>
        <p>{UNKNOWN_MATURITY_NOTE}</p>
        <p>{MULTIPLE_MATURITY_NOTE}</p>
        <p>{BOUNDARY_NOTE}</p>
      </div>
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
        <div className="mt-2 space-y-8">
          {dates.map((date) => {
            const dateYears = years.filter((year) => year.reportedDate === date.reportedDate);
            return (
              <section key={date.reportedDate}>
                <h3 className="text-sm font-semibold text-navy">
                  <Link
                    href={`/maturity/${registrant.registrant_cik}/lines?date=${date.reportedDate}`}
                    className="text-accent"
                  >
                    {date.reportedDate}
                  </Link>
                </h3>
                <dl className="mt-2 grid max-w-3xl gap-2 text-sm md:grid-cols-2">
                  <div>
                    <dt className="text-muted">Disclosed lines</dt>
                    <dd>{date.disclosedLines}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Reported maturity</dt>
                    <dd>{date.reportedMaturityLines}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Unknown maturity</dt>
                    <dd>
                      <Link
                        href={`/maturity/${registrant.registrant_cik}/lines?date=${date.reportedDate}&year=unknown`}
                        className="text-accent"
                      >
                        {date.unknownMaturityLines}
                      </Link>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">More than one maturity date</dt>
                    <dd>
                      <Link
                        href={`/maturity/${registrant.registrant_cik}/lines?date=${date.reportedDate}&year=multiple`}
                        className="text-accent"
                      >
                        {date.multipleMaturityLines}
                      </Link>
                    </dd>
                  </div>
                </dl>
                {dateYears.length === 0 ? (
                  <p className="mt-2 text-sm">No reported maturity date is stored for this reported date.</p>
                ) : (
                  <div className="mt-2 overflow-x-auto">
                    <table className="record-table w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                          <th scope="col" className="py-2 pr-4 font-semibold">Maturity year</th>
                          <th scope="col" className="py-2 font-semibold">Disclosed lines</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dateYears.map((year) => (
                          <tr key={year.maturityYear} className="border-b border-line">
                            <td data-label="Maturity year" className="py-3 pr-4">
                              <Link
                                href={`/maturity/${registrant.registrant_cik}/lines?date=${date.reportedDate}&year=${year.maturityYear}`}
                                className="text-accent"
                              >
                                {year.maturityYear}
                              </Link>
                            </td>
                            <td data-label="Disclosed lines" className="py-3">{year.disclosedLines}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
