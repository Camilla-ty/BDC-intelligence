import Link from "next/link";
import { PortfolioLimits } from "@/components/PortfolioLimits";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import { BOUNDARY_NOTE, UNKNOWN_MATURITY_NOTE, type MaturityLine } from "@/lib/maturity";
import { LINE_TEXT_NOTE, PAGE_SIZE } from "@/lib/portfolios";

export function MaturityLines({
  cik,
  reportedDate,
  yearLabel,
  lines,
  page,
  hasPrevious,
  hasNext,
  pastEnd,
  emptyMessage,
  emptyPeriods,
}: {
  cik: string;
  reportedDate: string;
  yearLabel: string;
  lines: MaturityLine[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  pastEnd: boolean;
  emptyMessage: string | null;
  emptyPeriods: string[];
}) {
  const yearQuery = yearLabel === "All disclosed lines" ? "" : yearLabel === "Unknown" ? "&year=unknown" : yearLabel === "Multiple values" ? "&year=multiple" : `&year=${yearLabel}`;
  const previous = `/maturity/${cik}/lines?date=${reportedDate}${yearQuery}&page=${page - 1}`;
  const next = `/maturity/${cik}/lines?date=${reportedDate}${yearQuery}&page=${page + 1}`;
  const first = `/maturity/${cik}/lines?date=${reportedDate}${yearQuery}&page=1`;
  return (
    <section>
      <p className="text-sm">
        <Link href={`/maturity/${cik}`} className="text-accent">{cik}</Link>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">Disclosed lines · {reportedDate}</h1>
      <p className="mt-1 text-sm text-muted">
        Maturity: {yearLabel === "Unknown" || yearLabel === "Multiple values" ? <StateText text={yearLabel} /> : yearLabel}
      </p>
      <p className="mt-1 max-w-3xl text-sm text-muted">{LINE_TEXT_NOTE}</p>
      <div className="mt-3 max-w-3xl space-y-1 text-sm text-muted">
        <p>{UNKNOWN_MATURITY_NOTE}</p>
        <p>{BOUNDARY_NOTE}</p>
      </div>
      <PortfolioLimits emptyPeriods={emptyPeriods} />
      {pastEnd ? (
        <p className="mt-6 text-sm">
          This page is past the disclosed lines. <Link href={first} className="text-accent">First page</Link>
        </p>
      ) : null}
      {!pastEnd && emptyMessage ? <p className="mt-6 text-sm"><StateText text={emptyMessage} /></p> : null}
      {lines.length > 0 ? (
        <div className="mt-6 space-y-4">
          {lines.map((line) => (
            <article key={line.id} className="rounded-md border border-line bg-white p-4 text-sm">
              <h2 className="font-semibold text-navy">{line.disclosedLineText}</h2>
              <dl className="mt-3 grid gap-2 md:grid-cols-2">
                <div>
                  <dt className="text-muted">Maturity</dt>
                  <dd><StateText text={line.maturity} /></dd>
                </div>
                <div>
                  <dt className="text-muted">Principal</dt>
                  <dd>
                    <StateText text={line.principal} />
                    {line.currency ? <span className="text-muted"> · {line.currency}</span> : null}
                  </dd>
                </div>
              </dl>
              <dl className="mt-3 grid gap-2 border-t border-line pt-3 md:grid-cols-2">
                <div>
                  <dt className="text-muted">Accession</dt>
                  <dd>
                    <SecLink href={line.documentUrl} missing={line.accessionNumber}>{line.accessionNumber}</SecLink>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Inline filing</dt>
                  <dd>
                    <SecLink href={line.inlineUrl}>SEC filing</SecLink>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Form</dt>
                  <dd><StateText text={line.form} /></dd>
                </div>
                <div>
                  <dt className="text-muted">Filed date</dt>
                  <dd><StateText text={line.filedDate} /></dd>
                </div>
                <div>
                  <dt className="text-muted">Evidence</dt>
                  <dd>{line.evidence}</dd>
                </div>
                <div>
                  <dt className="text-muted">Dataset release</dt>
                  <dd><StateText text={line.release} /></dd>
                </div>
              </dl>
            </article>
          ))}
          <p className="text-sm text-muted">Page {page}. {PAGE_SIZE} disclosed lines per page.</p>
          <p className="flex gap-4 text-sm">
            {hasPrevious ? <Link href={previous} className="text-accent">Previous disclosed lines</Link> : null}
            {hasNext ? <Link href={next} className="text-accent">Next disclosed lines</Link> : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
