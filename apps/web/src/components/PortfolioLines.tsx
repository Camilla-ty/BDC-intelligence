import Link from "next/link";
import { MaturityText } from "@/components/MaturityText";
import { PortfolioLimits } from "@/components/PortfolioLimits";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import { LINE_TEXT_NOTE, PAGE_SIZE, type PortfolioLine } from "@/lib/portfolios";
import { UNOBSERVED_DATE } from "@/lib/states";

export function PortfolioLines({
  cik,
  reportedDate,
  lines,
  page,
  hasPrevious,
  hasNext,
  pastEnd,
  emptyPeriods,
}: {
  cik: string;
  reportedDate: string;
  lines: PortfolioLine[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  pastEnd: boolean;
  emptyPeriods: string[];
}) {
  const previous = `/portfolios/${cik}/lines?date=${reportedDate}&page=${page - 1}`;
  const next = `/portfolios/${cik}/lines?date=${reportedDate}&page=${page + 1}`;
  const first = `/portfolios/${cik}/lines?date=${reportedDate}&page=1`;
  return (
    <section>
      <p className="text-sm">
        <Link href={`/portfolios/${cik}`} className="text-accent">{cik}</Link>
      </p>
      <h1 className="mt-2 text-lg font-semibold text-navy">Disclosed lines · {reportedDate}</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">{LINE_TEXT_NOTE}</p>
      <PortfolioLimits emptyPeriods={emptyPeriods} />
      {pastEnd ? (
        <p className="mt-6 text-sm">
          This page is past the disclosed lines. <Link href={first} className="text-accent">First page</Link>
        </p>
      ) : null}
      {!pastEnd && lines.length === 0 ? (
        <p className="mt-6 text-sm"><StateText text={UNOBSERVED_DATE} /></p>
      ) : null}
      {lines.length > 0 ? (
        <div className="mt-6 space-y-4">
          {lines.map((line) => (
            <article key={line.id} className="rounded-md border border-line bg-white p-4 text-sm">
              <h2 className="font-semibold text-navy">{line.disclosedLineText}</h2>
              <dl className="mt-3 grid gap-2 md:grid-cols-2">
                <div>
                  <dt className="text-muted">Duration</dt>
                  <dd>{line.duration}</dd>
                </div>
                <div>
                  <dt className="text-muted">Period role</dt>
                  <dd><StateText text={line.periodRole} /></dd>
                </div>
                <div>
                  <dt className="text-muted">Principal</dt>
                  <dd>
                    <StateText text={line.principal} />
                    {line.currency ? <span className="text-muted"> · {line.currency}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Maturity</dt>
                  <dd><MaturityText maturity={line.maturity} source={line.maturitySource} documentUrl={line.maturityDocumentUrl} /></dd>
                </div>
                {line.attributes.map((attribute) => (
                  <div key={attribute.label}>
                    <dt className="text-muted">{attribute.label}</dt>
                    <dd><StateText text={attribute.text} /></dd>
                  </div>
                ))}
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
