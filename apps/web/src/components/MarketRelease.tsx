import Link from "next/link";
import { StateText } from "@/components/StateText";
import {
  ABSENCE_NOTE,
  EMPTY_RELEASE,
  IDENTITY_NOTE,
  LINE_NOTE,
  MISSING_RELEASE,
  NO_IDENTIFIED_LINE,
  RELEASE_NOTE,
  SOURCE_NOTE,
  type ReleaseDate,
} from "@/lib/market";

export function MarketRelease({
  label,
  found,
  coverageState,
  rows,
}: {
  label: string;
  found: boolean;
  coverageState: string | null;
  rows: ReleaseDate[];
}) {
  const unavailable = coverageState === "Unavailable";
  const noLine = coverageState === "Covered, no identified line" || coverageState === "Unknown";
  return (
    <section>
      <p className="text-sm"><Link href="/market" className="text-accent">Coverage</Link></p>
      <h1 className="mt-2 text-lg font-semibold text-navy">Release {label}</h1>
      <div className="mt-3 max-w-3xl space-y-1 text-sm text-muted">
        <p>{RELEASE_NOTE}</p>
        <p>{LINE_NOTE}</p>
        <p>{SOURCE_NOTE}</p>
        <p>{ABSENCE_NOTE}</p>
        <p>{IDENTITY_NOTE}</p>
      </div>
      {!found ? <p className="mt-6 text-sm"><StateText text={MISSING_RELEASE} /></p> : null}
      {unavailable ? <p className="mt-6 text-sm"><StateText text={EMPTY_RELEASE} /></p> : null}
      {noLine ? (
        <p className="mt-6 text-sm">{coverageState === "Unknown" ? <StateText text="Unknown" /> : NO_IDENTIFIED_LINE}</p>
      ) : null}
      {found && !unavailable && !noLine && rows.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-2 pr-4 font-semibold">CIK</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Registrant name</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Reported date</th>
                <th scope="col" className="py-2 pr-4 font-semibold">Disclosed lines</th>
                <th scope="col" className="py-2 font-semibold">SEC sources</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.cik}-${row.reportedDate}`} className="border-b border-line">
                  <td data-label="CIK" className="py-3 pr-4">
                    <Link href={`/portfolios/${row.cik}`} className="font-semibold text-accent">{row.cik}</Link>
                    <div><Link href={`/maturity/${row.cik}`} className="text-accent">Maturity</Link></div>
                  </td>
                  <td data-label="Registrant name" className="py-3 pr-4"><StateText text={row.name} /></td>
                  <td data-label="Reported date" className="py-3 pr-4">
                    <Link href={`/market/dates/${row.reportedDate}`} className="text-accent">{row.reportedDate}</Link>
                  </td>
                  <td data-label="Disclosed lines" className="py-3 pr-4">{row.disclosedLines}</td>
                  <td data-label="SEC sources" className="py-3">
                    <Link href={row.sourceHref} className="text-accent">SEC sources</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
