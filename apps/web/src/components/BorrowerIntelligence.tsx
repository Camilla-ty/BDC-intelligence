import Link from "next/link";
import { MaturityText } from "@/components/MaturityText";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import {
  ACTIVITY_NOTE,
  DIFFERENCE_NOTE,
  NO_COMPARABLE_DIFFERENCE,
  observedActivity,
  storedDifferences,
} from "@/lib/borrower-activity";
import {
  COMPARISON_NOTE,
  EMPTY_COMPARISONS,
  type PositionComparison,
} from "@/lib/borrower-comparisons";
import {
  ACQUISITION_LABEL,
  EMPTY_POSITIONS,
  EVIDENCE_SCOPE_NOTE,
  POSITION_HISTORY_NOTE,
  POSITION_VALUE_NOTE,
  RESEARCH_FIELD_NOTE,
  TIMELINE_NOTE,
  periodBands,
  positionGroups,
  type HistoricalPosition,
  type StoredField,
} from "@/lib/borrower-positions";
import {
  ABSENT_EVENT_LABEL,
  CIK_NOTE,
  COVERAGE_NOTE,
  ENTITY_NOTE,
  EVENT_SCOPE_NOTE,
  VALUATION_NOTE,
  type BorrowerDetail,
} from "@/lib/borrowers";

function ObservedValue({ value, currency }: { value: string; currency: string | null }) {
  return (
    <>
      <StateText text={value} />
      {currency ? <span className="text-muted"> · {currency}</span> : null}
    </>
  );
}

function ComparisonAmount({ value, currency }: { value: string; currency: string | null }) {
  return (
    <>
      <StateText text={value} />
      {currency ? <span className="text-muted"> · {currency}</span> : null}
    </>
  );
}

function StoredResearch({ field }: { field: StoredField }) {
  return (
    <>
      <StateText text={field.text} />
      {field.evidenceLabel ? <span className="text-muted"> · {field.evidenceLabel}</span> : null}
    </>
  );
}

function PositionTable({ rows }: { rows: HistoricalPosition[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="record-table mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
            <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-semibold">Reported date</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Instrument type</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Principal</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Amortized cost</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Fair value</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Maturity</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Interest rate</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Spread</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Interest-rate floor</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Industry</th>
            <th scope="col" className="py-2 pr-4 font-semibold">{ACQUISITION_LABEL}</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Instrument identity</th>
            <th scope="col" className="py-2 font-semibold">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line">
              <td data-label="Reported date" className="sticky left-0 bg-background py-2 pr-4">{row.reportedDate}</td>
              <td data-label="Instrument type" className="py-2 pr-4"><StoredResearch field={row.instrumentType} /></td>
              <td data-label="Principal" className="py-2 pr-4"><ObservedValue value={row.principal} currency={row.principalCurrency} /></td>
              <td data-label="Amortized cost" className="py-2 pr-4"><ObservedValue value={row.cost} currency={row.costCurrency} /></td>
              <td data-label="Fair value" className="py-2 pr-4"><ObservedValue value={row.fairValue} currency={row.fairValueCurrency} /></td>
              <td data-label="Maturity" className="py-2 pr-4">
                <MaturityText maturity={row.maturity} source={row.maturitySource} documentUrl={row.maturityDocumentUrl} />
              </td>
              <td data-label="Interest rate" className="py-2 pr-4"><StateText text={row.interestRate} /></td>
              <td data-label="Spread" className="py-2 pr-4"><StateText text={row.spread} /></td>
              <td data-label="Interest-rate floor" className="py-2 pr-4"><StateText text={row.interestRateFloor} /></td>
              <td data-label="Industry" className="py-2 pr-4"><StoredResearch field={row.industry} /></td>
              <td data-label={ACQUISITION_LABEL} className="py-2 pr-4"><StateText text={row.acquisition} /></td>
              <td data-label="Instrument identity" className="py-2 pr-4">
                <StateText text={row.instrumentState} />
                <span className="text-muted"> · Position continuity </span>
                <StateText text={row.continuityState} />
                <span className="text-muted"> · Economic group </span>
                <StateText text={row.economicGroupState} />
              </td>
              <td data-label="Evidence" className="py-2">
                <StateText text={row.evidenceLabel} />
                <div>
                  <SecLink href={row.documentUrl} missing={row.accessionNumber}>{row.accessionNumber}</SecLink>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function bdcName(borrower: BorrowerDetail, cik: string): string {
  const matches = borrower.registrants.filter((registrant) => registrant.cik === cik);
  if (matches.length !== 1) return "Unknown";
  return matches[0].name;
}

function ObservationSource({
  label,
  observation,
}: {
  label: string;
  observation: PositionComparison["earlier"];
}) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider text-muted">{label}</h4>
      <p className="mt-1">
        {observation.reportedDate}
        {" · "}
        <SecLink href={observation.documentUrl} missing={observation.accessionNumber}>
          {observation.accessionNumber}
        </SecLink>
        {" · "}
        <StateText text={observation.evidenceLabel} />
        {" · Registrant CIK "}
        <StateText text={observation.registrantCik} />
      </p>
    </div>
  );
}

export function BorrowerIntelligence({
  borrower,
  positions = [],
  positionError = null,
  researchError = null,
  comparisons = [],
  comparisonError = null,
}: {
  borrower: BorrowerDetail;
  positions?: HistoricalPosition[];
  positionError?: string | null;
  researchError?: string | null;
  comparisons?: PositionComparison[];
  comparisonError?: string | null;
}) {
  const groups = positionGroups(positions);
  const activity = observedActivity(positions, comparisons);
  const differences = storedDifferences(comparisons);
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
        <h2 className="text-sm font-semibold text-navy">Credit Intelligence</h2>
        <h3 className="mt-3 text-sm font-semibold text-navy">Observed activity</h3>
        <p className="mt-1 text-sm">{ACTIVITY_NOTE}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {activity.facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-xs uppercase tracking-wider text-muted">{fact.label}</dt>
              <dd>{fact.value} stored</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Earliest reported date</dt>
            <dd><StateText text={activity.earliest} /></dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-muted">Latest reported date</dt>
            <dd><StateText text={activity.latest} /></dd>
          </div>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">Historical positions</h2>
        <p className="mt-1 text-sm">{POSITION_HISTORY_NOTE}</p>
        <p className="mt-2 text-sm">{TIMELINE_NOTE}</p>
        <p className="mt-2 text-sm">{POSITION_VALUE_NOTE}</p>
        <p className="mt-2 text-sm">{RESEARCH_FIELD_NOTE}</p>
        <p className="mt-2 text-sm">{EVIDENCE_SCOPE_NOTE}</p>
        {positionError ? <p className="mt-3 text-sm">{positionError}</p> : null}
        {researchError ? <p className="mt-3 text-sm">{researchError}</p> : null}
        {!positionError && positions.length === 0 ? <p className="mt-3 text-sm">{EMPTY_POSITIONS}</p> : null}
        {!positionError && groups.map((group) => (
          <div key={group.key} className="mt-6">
            <h3 className="text-sm font-semibold text-navy">
              <StateText text={bdcName(borrower, group.registrantCik)} />
            </h3>
            <p className="text-xs text-muted">
              Registrant CIK <StateText text={group.registrantCik} />
            </p>
            {periodBands(group.positions).map((band) => (
              <div key={`${group.key}:${band.reportedDate}`}>
                <h4 className="mt-4 text-xs uppercase tracking-wider text-muted">
                  Reporting period {band.reportedDate}
                </h4>
                <PositionTable rows={band.positions} />
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">Confirmed Position Changes</h2>
        <p className="mt-1 text-sm">{COMPARISON_NOTE}</p>
        {comparisonError ? <p className="mt-3 text-sm">{comparisonError}</p> : null}
        {!comparisonError && comparisons.length === 0 ? <p className="mt-3 text-sm">{EMPTY_COMPARISONS}</p> : null}
        {!comparisonError && comparisons.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-sm font-semibold text-navy">Stored differences</h3>
            <p className="mt-1 text-sm">{DIFFERENCE_NOTE}</p>
            {differences.length === 0 ? <p className="mt-2 text-sm">{NO_COMPARABLE_DIFFERENCE}</p> : (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {differences.map((difference) => <li key={difference.key}>{difference.text}</li>)}
              </ul>
            )}
          </div>
        ) : null}
        {!comparisonError && comparisons.length > 0 ? (
          <div className="mt-3 flex flex-col gap-6">
            {comparisons.map((comparison) => (
              <article key={comparison.key} className="border-t border-line pt-4">
                <h3 className="text-sm font-semibold text-navy">
                  {comparison.earlierDate}
                  {" to "}
                  {comparison.laterDate}
                </h3>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Stored position</dt>
                    <dd className="break-all">{comparison.positionId}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">BDC</dt>
                    <dd><StateText text={bdcName(borrower, comparison.registrantCik)} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Registrant CIK</dt>
                    <dd><StateText text={comparison.registrantCik} /></dd>
                  </div>
                </dl>
                <div className="overflow-x-auto">
                  <table className="record-table mt-3 w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                        <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-semibold">Field</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Earlier</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Later</th>
                        <th scope="col" className="py-2 pr-4 font-semibold">Stored change</th>
                        <th scope="col" className="py-2 font-semibold">Comparison state</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.fields.map((field) => (
                        <tr key={field.label} className="border-b border-line">
                          <th scope="row" data-label="Field" className="sticky left-0 bg-background py-2 pr-4 text-left font-normal">{field.label}</th>
                          <td data-label="Earlier" className="py-2 pr-4">
                            <ComparisonAmount value={field.earlier} currency={field.earlierCurrency} />
                          </td>
                          <td data-label="Later" className="py-2 pr-4">
                            <ComparisonAmount value={field.later} currency={field.laterCurrency} />
                          </td>
                          <td data-label="Stored change" className="py-2 pr-4"><StateText text={field.change} /></td>
                          <td data-label="Comparison state" className="py-2"><StateText text={field.state} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <ObservationSource label="Earlier observation" observation={comparison.earlier} />
                  <ObservationSource label="Later observation" observation={comparison.later} />
                </div>
              </article>
            ))}
          </div>
        ) : null}
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
