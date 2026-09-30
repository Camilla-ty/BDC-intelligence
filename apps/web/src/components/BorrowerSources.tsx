import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import { COVERAGE_NOTE, DOCUMENT_URL_UNKNOWN, type SourceRow } from "@/lib/borrowers";

export function BorrowerSources({
  id,
  name,
  sources,
}: {
  id: string;
  name: string;
  sources: SourceRow[];
}) {
  return (
    <article>
      <p className="text-xs uppercase tracking-wider text-muted">Borrower</p>
      <h1 className="mt-1 break-words text-lg font-semibold text-navy">{name}</h1>
      <nav aria-label="Borrower sections" className="mt-4 flex flex-wrap gap-4 border-b border-line text-sm">
        <Link href={`/borrowers/${id}`} className="pb-2 text-accent">Borrower Intelligence</Link>
        <Link href={`/borrowers/${id}/sources`} className="border-b-2 border-navy pb-2 font-semibold" aria-current="page">
          Sources
        </Link>
      </nav>
      <h2 className="mt-6 text-sm font-semibold text-navy">Sources</h2>
      <p className="mt-1 text-sm text-muted">Each row is one stored observation. The source label is the EDGAR accession.</p>
      {sources.length === 0 ? (
        <p className="mt-4 text-sm"><StateText text="Unobserved. No stored source is listed for this borrower." /></p>
      ) : (
      <div className="mt-4 overflow-x-auto">
        <table className="record-table w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
              <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-semibold">Reported date</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Accession</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Evidence</th>
              <th scope="col" className="py-2 font-semibold">Name check</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.key} className="border-b border-line">
                <td data-label="Reported date" className="sticky left-0 bg-background py-2 pr-4">{source.reportedDate}</td>
                <td data-label="Accession" className="py-2 pr-4">
                  <SecLink href={source.documentUrl} missing={source.accessionNumber}>{source.accessionNumber}</SecLink>
                  <div className="text-xs text-muted"><StateText text={source.documentName} /></div>
                  {source.documentUrl ? null : (
                    <div className="text-xs"><StateText text={DOCUMENT_URL_UNKNOWN} /></div>
                  )}
                </td>
                <td data-label="Evidence" className="py-2 pr-4"><StateText text={source.evidenceLabel} /></td>
                <td data-label="Name check" className="py-2"><StateText text={source.nameCheck} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <p className="mt-3 text-sm">{COVERAGE_NOTE}</p>
    </article>
  );
}
