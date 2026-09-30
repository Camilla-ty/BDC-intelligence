import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import {
  ABSENT_EVENT_LABEL,
  CIK_NOTE,
  COVERAGE_NOTE,
  ENTITY_NOTE,
  EVENT_SCOPE_NOTE,
  VALUATION_NOTE,
  type BorrowerDetail,
} from "@/lib/borrowers";
import { StateText } from "@/components/StateText";

export function BorrowerIntelligence({ borrower }: { borrower: BorrowerDetail }) {
  return (
    <article>
      <p className="text-xs uppercase tracking-wider text-muted">Borrower</p>
      <h1 className="mt-1 break-words text-lg font-semibold text-navy">{borrower.name}</h1>
      <nav aria-label="Borrower sections" className="mt-4 flex flex-wrap gap-4 border-b border-line text-sm">
        <Link href={`/borrowers/${borrower.id}`} className="border-b-2 border-navy pb-2 font-semibold" aria-current="page">
          Borrower Intelligence
        </Link>
        <Link href={`/borrowers/${borrower.id}/sources`} className="pb-2 text-accent">
          Sources
        </Link>
      </nav>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-navy">Identity</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Legal entity name</dt>
            <dd className="break-words">{borrower.name}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Name resolution</dt>
            <dd><StateText text={`${borrower.entityState} · ${borrower.entityMethod}`} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Instrument identity</dt>
            <dd><StateText text={`${borrower.instrumentState} · ${borrower.instrumentMethod}`} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Investment type</dt>
            <dd><StateText text={borrower.instrumentType} /></dd>
          </div>
        </dl>
        <p className="mt-3 text-sm">{ENTITY_NOTE}</p>
        <p className="mt-2 text-sm">{VALUATION_NOTE}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">BDC registrants</h2>
        <p className="mt-1 text-xs text-muted">{CIK_NOTE}</p>
        {borrower.registrants.map((registrant) => (
          <div key={`${registrant.cik}-${registrant.name}-${registrant.history[0]?.key}`} className="mt-4">
            <h3 className="break-words text-sm font-semibold"><StateText text={registrant.name} /></h3>
            <p className="text-xs text-muted">
              Registrant CIK <StateText text={registrant.cik} /> · <StateText text={registrant.linkStatus} />
            </p>
            <div className="overflow-x-auto">
              <table className="record-table mt-2 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                    <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-semibold">Reported date</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Accession</th>
                    <th scope="col" className="py-2 font-semibold">Event</th>
                  </tr>
                </thead>
                <tbody>
                  {registrant.history.map((row) => (
                    <tr key={row.key} className="border-b border-line">
                      <td data-label="Reported date" className="sticky left-0 bg-background py-2 pr-4">{row.reportedDate}</td>
                      <td data-label="Accession" className="py-2 pr-4">
                        <SecLink href={row.documentUrl} missing={row.accessionNumber}>{row.accessionNumber}</SecLink>
                      </td>
                      <td data-label="Event" className="py-2">{row.eventLabel ?? ABSENT_EVENT_LABEL}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="mt-3 text-sm">{COVERAGE_NOTE}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">Registrant first observed</h2>
        <p className="mt-1 text-sm">{EVENT_SCOPE_NOTE}</p>
        {borrower.events.length === 0 ? <p className="mt-2 text-sm"><StateText text="Unknown" /></p> : (
          <ul className="mt-2 text-sm">
            {borrower.events.map((event) => (
              <li key={event.key} className="break-words">
                {event.reportedDate}
                {" · "}
                <SecLink href={event.documentUrl} missing={event.accessionNumber}>{event.accessionNumber}</SecLink>
                {" · "}
                <StateText text={event.registrantName} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
