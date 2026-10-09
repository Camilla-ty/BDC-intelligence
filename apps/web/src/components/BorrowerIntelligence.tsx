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
  CREDIT_TIMELINE_NOTE,
  EMPTY_CREDIT_TIMELINE,
  timelineFactSummary,
  type CreditTimelineEvent,
} from "@/lib/borrower-credit-timeline";
import {
  amountReviewFields,
  COMPARISON_NOTE,
  CONTINUITY_SCOPE_NOTE,
  EMPTY_COMPARISONS,
  EVIDENCE_REVIEW_NOTE,
  type ComparisonField,
  type PositionComparison,
} from "@/lib/borrower-comparisons";
import {
  amountFieldHasTrace,
  FIELD_TRACE_NOTE,
  type AmountFieldTraceSide,
} from "@/lib/borrower-field-trace";
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
  EMPTY_MATURITY,
  EMPTY_MATURITY_CHANGE,
  MATURITY_CHANGE_NOTE,
  MATURITY_WALL_NOTE,
  OMITTED_UNRESOLVED_MATURITY,
  REFINANCING_OUTCOME_NOTE,
  YEAR_NOTE,
  storedCount,
  storedMaturityText,
  type MaturityChangeLine,
  type MaturitySummaryRow,
  type MaturityWallPoint,
  type MaturityYearDisplay,
} from "@/lib/borrower-maturity";
import {
  EMPTY_REFINANCING,
  MATURITY_CHANGED_NOTE,
  OUTCOME_STATE_NOTE,
  REFINANCING_NOTE,
  type RefinancingDisplay,
} from "@/lib/borrower-refinancing";
import {
  EMPTY_WHAT_CHANGED,
  WHAT_CHANGED_NOTE,
  whatChanged,
  type WhatChangedItem,
} from "@/lib/borrower-what-changed";
import {
  CROSS_BDC_UNAVAILABLE,
  DERIVED_NOTE,
  EMPTY_DERIVED,
  EMPTY_VALUATION,
  OMITTED_UNRESOLVED,
  VALUATION_HISTORY_NOTE,
  type ValuationHistory,
} from "@/lib/borrower-valuation";
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

function WhatChangedList({ items }: { items: WhatChangedItem[] }) {
  return (
    <div className="mt-3 flex flex-col gap-4">
      {items.map((item) => (
        <article key={item.key} className="text-sm">
          <h4 className="font-semibold text-navy">{item.statement}</h4>
          <dl className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Legal entity</dt>
              <dd className="break-words">{item.legalEntityName}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Instrument</dt>
              <dd><StateText text={item.instrument} /></dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Position</dt>
              <dd className="break-all">{item.positionId}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Reporting dates</dt>
              <dd>{item.earlierDate} to {item.laterDate}</dd>
            </div>
            {item.storedDelta != null ? (
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted">Stored delta</dt>
                <dd>{item.storedDelta}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Earlier accession</dt>
              <dd>
                <SecLink href={item.earlierUrl} missing={item.earlierAccession}>{item.earlierAccession}</SecLink>
                {" · "}
                <StateText text={item.earlierEvidence} />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Earlier observation evidence</dt>
              <dd><StateText text={item.earlierEvidenceId} /></dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Later accession</dt>
              <dd>
                <SecLink href={item.laterUrl} missing={item.laterAccession}>{item.laterAccession}</SecLink>
                {" · "}
                <StateText text={item.laterEvidence} />
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Later observation evidence</dt>
              <dd><StateText text={item.laterEvidenceId} /></dd>
            </div>
          </dl>
        </article>
      ))}
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
      <dl className="mt-1 grid gap-1">
        <div>
          <dt className="text-xs text-muted">Reporting period</dt>
          <dd>{observation.reportedDate}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">SEC accession</dt>
          <dd>
            <SecLink href={observation.documentUrl} missing={observation.accessionNumber}>
              {observation.accessionNumber}
            </SecLink>
            {observation.documentUrl == null ? (
              <span className="text-muted"> · Filing URL unavailable</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Evidence</dt>
          <dd>
            <StateText text={observation.evidenceLabel} />
            {" · Observation evidence "}
            <StateText text={observation.evidenceId} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Registrant CIK</dt>
          <dd><StateText text={observation.registrantCik} /></dd>
        </div>
      </dl>
    </div>
  );
}

function FieldTraceSideBlock({
  title,
  side,
}: {
  title: string;
  side: AmountFieldTraceSide;
}) {
  return (
    <div className="rounded border border-line p-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      {side.headNote ? <p className="mt-1 text-xs text-muted">{side.headNote}</p> : null}
      <dl className="mt-2 grid gap-1 text-sm">
        <div>
          <dt className="text-xs text-muted">Observed value</dt>
          <dd><StateText text={side.observedValue} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Normalized stored value</dt>
          <dd><StateText text={side.normalizedValue} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Currency code</dt>
          <dd><StateText text={side.currencyCode} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Currency state</dt>
          <dd><StateText text={side.currencyState} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Scale state</dt>
          <dd><StateText text={side.scaleState} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Field evidence id</dt>
          <dd><StateText text={side.fieldEvidenceId} /></dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Normalization rule version</dt>
          <dd><StateText text={side.normalizationRuleVersionId} /></dd>
        </div>
      </dl>
    </div>
  );
}

function AmountFieldTraceReview({ field, comparison }: { field: ComparisonField; comparison: PositionComparison }) {
  if (!amountFieldHasTrace(field)) return null;
  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wider text-muted">Field trace</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <FieldTraceSideBlock title={`Earlier (${comparison.earlierDate})`} side={field.earlierTrace} />
        <FieldTraceSideBlock title={`Later (${comparison.laterDate})`} side={field.laterTrace} />
      </div>
    </div>
  );
}

function AmountEvidenceReview({ comparison }: { comparison: PositionComparison }) {
  const fields = amountReviewFields(comparison);
  return (
    <div className="mt-4">
      <h4 className="text-xs uppercase tracking-wider text-muted">Amount evidence</h4>
      <p className="mt-1 text-sm text-muted">{FIELD_TRACE_NOTE}</p>
      <ul className="mt-2 flex flex-col gap-3">
        {fields.map((field) => (
          <li key={field.label} className="text-sm">
            <p className="font-semibold text-navy">{field.label}</p>
            <p className="text-xs text-muted">Comparison amounts (period read path)</p>
            <dl className="mt-1 grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted">Earlier ({comparison.earlierDate})</dt>
                <dd><ComparisonAmount value={field.earlier} currency={field.earlierCurrency} /></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Later ({comparison.laterDate})</dt>
                <dd><ComparisonAmount value={field.later} currency={field.laterCurrency} /></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Comparison state</dt>
                <dd><StateText text={field.state} /></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Stored delta</dt>
                <dd>
                  {field.state === "Comparable" ? (
                    <StateText text={field.change} />
                  ) : (
                    <StateText text="Not shown" />
                  )}
                </dd>
              </div>
            </dl>
            <AmountFieldTraceReview field={field} comparison={comparison} />
            {field.reviewNote ? <p className="mt-1 text-sm text-muted">{field.reviewNote}</p> : null}
          </li>
        ))}
      </ul>
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
  timeline = [],
  valuation = null,
  valuationError = null,
  maturity = null,
  maturityError = null,
  refinancing = null,
  refinancingError = null,
}: {
  borrower: BorrowerDetail;
  positions?: HistoricalPosition[];
  positionError?: string | null;
  researchError?: string | null;
  comparisons?: PositionComparison[];
  comparisonError?: string | null;
  timeline?: CreditTimelineEvent[];
  valuation?: ValuationHistory | null;
  valuationError?: string | null;
  maturity?: {
    wall: { points: MaturityWallPoint[]; omittedUnresolved: boolean; definition: string };
    summary: MaturitySummaryRow | null;
    years: MaturityYearDisplay[];
    changes: MaturityChangeLine[];
  } | null;
  maturityError?: string | null;
  refinancing?: RefinancingDisplay[] | null;
  refinancingError?: string | null;
}) {
  const groups = positionGroups(positions);
  const activity = observedActivity(positions, comparisons);
  const differences = storedDifferences(comparisons);
  const changes = whatChanged(comparisons, positions, borrower.name);
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
        <h3 className="mt-4 text-sm font-semibold text-navy">What Changed</h3>
        <p className="mt-1 text-sm">{WHAT_CHANGED_NOTE}</p>
        {comparisonError ? <p className="mt-3 text-sm">{comparisonError}</p> : null}
        {!comparisonError && changes.length === 0 ? <p className="mt-3 text-sm">{EMPTY_WHAT_CHANGED}</p> : null}
        {!comparisonError && changes.length > 0 ? <WhatChangedList items={changes} /> : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">Credit Timeline</h2>
        <p className="mt-1 text-sm">{CREDIT_TIMELINE_NOTE}</p>
        {timeline.length === 0 ? <p className="mt-3 text-sm">{EMPTY_CREDIT_TIMELINE}</p> : (
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {timeline.map((event) => (
              <li key={event.key} className="border-t border-line pt-3">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-semibold text-navy">{event.report_date}</span>
                  <span className="text-xs uppercase tracking-wider text-muted">{event.event_type}</span>
                </div>
                <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Position</dt>
                    <dd className="break-all"><StateText text={event.position_id ?? "Unknown"} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Instrument</dt>
                    <dd className="break-all"><StateText text={event.instrument_id ?? "Unknown"} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Registrant CIK</dt>
                    <dd><StateText text={event.registrant_cik ?? "Unknown"} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Accession</dt>
                    <dd className="break-all">{event.later_accession_number}</dd>
                  </div>
                </dl>
                <p className="mt-2"><StateText text={timelineFactSummary(event)} /></p>
              </li>
            ))}
          </ul>
        )}
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
        <p className="mt-2 text-sm">{CONTINUITY_SCOPE_NOTE}</p>
        <p className="mt-2 text-sm">{EVIDENCE_REVIEW_NOTE}</p>
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
                  {`Evidence & change review · ${comparison.earlierDate} to ${comparison.laterDate}`}
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
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <ObservationSource label="Earlier source filing" observation={comparison.earlier} />
                  <ObservationSource label="Later source filing" observation={comparison.later} />
                </div>
                <AmountEvidenceReview comparison={comparison} />
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
                          <td data-label="Stored change" className="py-2 pr-4">
                            <StateText text={field.change} />
                            {field.reviewNote && field.state !== "Comparable" ? (
                              <p className="mt-1 text-xs text-muted">{field.reviewNote}</p>
                            ) : null}
                          </td>
                          <td data-label="Comparison state" className="py-2"><StateText text={field.state} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">Valuation & Pricing</h2>
        <h3 className="mt-3 text-sm font-semibold text-navy">Historical Fair Value</h3>
        <p className="mt-1 text-sm">{VALUATION_HISTORY_NOTE}</p>
        {valuationError ? <p className="mt-3 text-sm">{valuationError}</p> : null}
        {!valuationError && (!valuation || valuation.timeline.length === 0) ? <p className="mt-3 text-sm">{EMPTY_VALUATION}</p> : null}
        {!valuationError && valuation && valuation.omittedUnresolved ? <p className="mt-3 text-sm">{OMITTED_UNRESOLVED}</p> : null}
        {!valuationError && valuation && valuation.timeline.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="record-table mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-semibold">Report date</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">BDC</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Instrument</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Fair value</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Principal</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Cost</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Fair value change</th>
                  <th scope="col" className="py-2 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody>
                {valuation.timeline.map((point) => (
                  <tr key={point.id} className="border-b border-line">
                    <td data-label="Report date" className="sticky left-0 bg-background py-2 pr-4">{point.reportedDate}</td>
                    <td data-label="BDC" className="py-2 pr-4"><StateText text={bdcName(borrower, point.registrantCik)} /></td>
                    <td data-label="Instrument" className="py-2 pr-4">
                      <StateText text={point.instrument} />
                      <span className="text-muted"> · </span>
                      <StateText text={point.instrumentState} />
                      <span className="text-muted"> · Position continuity </span>
                      <StateText text={point.continuityState} />
                    </td>
                    <td data-label="Fair value" className="py-2 pr-4"><ObservedValue value={point.fairValue} currency={point.fairValueCurrency} /></td>
                    <td data-label="Principal" className="py-2 pr-4"><ObservedValue value={point.principal} currency={point.principalCurrency} /></td>
                    <td data-label="Cost" className="py-2 pr-4"><ObservedValue value={point.cost} currency={point.costCurrency} /></td>
                    <td data-label="Fair value change" className="py-2 pr-4"><StateText text={point.fairValueChange} /></td>
                    <td data-label="Source" className="py-2">
                      <StateText text={point.evidenceLabel} />
                      <div>
                        <SecLink href={point.documentUrl} missing={point.accessionNumber}>{point.accessionNumber}</SecLink>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!valuationError && valuation && valuation.timeline.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-navy">Derived metrics</h3>
            <p className="mt-1 text-sm">{DERIVED_NOTE}</p>
            <p className="mt-1 text-xs text-muted">{valuation.definition}</p>
            {valuation.derived.length === 0 ? <p className="mt-2 text-sm">{EMPTY_DERIVED}</p> : (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {valuation.derived.map((metric) => <li key={metric.key}>{metric.text}</li>)}
              </ul>
            )}
          </div>
        ) : null}
        <p className="mt-3 text-sm">{CROSS_BDC_UNAVAILABLE}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">Maturity Wall</h2>
        <p className="mt-1 text-sm">{MATURITY_WALL_NOTE}</p>
        {maturityError ? <p className="mt-3 text-sm">{maturityError}</p> : null}
        {!maturityError && maturity?.summary ? (
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Earliest calendar maturity</dt>
              <dd><StateText text={storedMaturityText(maturity.summary.earliest_calendar_maturity)} /></dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Earliest month maturity</dt>
              <dd><StateText text={storedMaturityText(maturity.summary.earliest_month_maturity)} /></dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Resolved observations</dt>
              <dd>{storedCount(maturity.summary.resolved_observation_count)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Known maturity</dt>
              <dd>{storedCount(maturity.summary.known_maturity_count)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Unknown maturity</dt>
              <dd>{storedCount(maturity.summary.unknown_maturity_count)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted">Unresolved instrument or position</dt>
              <dd>{storedCount(maturity.summary.unresolved_count)}</dd>
            </div>
          </dl>
        ) : null}
        {!maturityError && (!maturity || maturity.wall.points.length === 0) ? <p className="mt-3 text-sm">{EMPTY_MATURITY}</p> : null}
        {!maturityError && maturity?.wall.omittedUnresolved ? <p className="mt-3 text-sm">{OMITTED_UNRESOLVED_MATURITY}</p> : null}
        {!maturityError && maturity && maturity.wall.points.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="record-table mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                  <th scope="col" className="sticky left-0 bg-background py-2 pr-4 font-semibold">Maturity</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">BDC</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Instrument</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Type</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Principal</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Fair value</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Report date</th>
                  <th scope="col" className="py-2 font-semibold">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {maturity.wall.points.map((point) => (
                  <tr key={point.id} className="border-b border-line">
                    <td data-label="Maturity" className="sticky left-0 bg-background py-2 pr-4">
                      <StateText text={point.maturity} />
                      <div className="text-muted">{point.precision}</div>
                    </td>
                    <td data-label="BDC" className="py-2 pr-4"><StateText text={bdcName(borrower, point.registrantCik)} /></td>
                    <td data-label="Instrument" className="py-2 pr-4">
                      <StateText text={point.instrumentState} />
                      <span className="text-muted"> · Position continuity </span>
                      <StateText text={point.continuityState} />
                    </td>
                    <td data-label="Type" className="py-2 pr-4"><StateText text={point.instrument} /></td>
                    <td data-label="Principal" className="py-2 pr-4"><ObservedValue value={point.principal} currency={point.principalCurrency} /></td>
                    <td data-label="Fair value" className="py-2 pr-4"><ObservedValue value={point.fairValue} currency={point.fairValueCurrency} /></td>
                    <td data-label="Report date" className="py-2 pr-4">{point.reportedDate}</td>
                    <td data-label="Evidence" className="py-2">
                      <StateText text={point.evidenceLabel} />
                      {point.maturitySource ? <div className="text-muted">{point.maturitySource}</div> : null}
                      <div>
                        <SecLink href={point.documentUrl} missing={point.accessionNumber}>{point.accessionNumber}</SecLink>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!maturityError && maturity && maturity.years.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-navy">Maturity years</h3>
            <p className="mt-1 text-sm">{YEAR_NOTE}</p>
            <div className="overflow-x-auto">
              <table className="record-table mt-3 w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                    <th scope="col" className="py-2 pr-4 font-semibold">Year</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Precision</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Observations</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Principal total</th>
                    <th scope="col" className="py-2 font-semibold">Fair value total</th>
                  </tr>
                </thead>
                <tbody>
                  {maturity.years.map((year) => (
                    <tr key={year.key} className="border-b border-line">
                      <td className="py-2 pr-4">{year.year}</td>
                      <td className="py-2 pr-4">{year.precision}</td>
                      <td className="py-2 pr-4">{year.count}</td>
                      <td className="py-2 pr-4"><StateText text={year.principal} /></td>
                      <td className="py-2"><StateText text={year.fairValue} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <h3 className="mt-4 text-sm font-semibold text-navy">Maturity changes</h3>
        <p className="mt-1 text-sm">{MATURITY_CHANGE_NOTE}</p>
        {!maturityError && !comparisonError && maturity && maturity.changes.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {maturity.changes.map((change) => <li key={change.key}>{change.text}</li>)}
          </ul>
        ) : null}
        {!maturityError && !comparisonError && (!maturity || maturity.changes.length === 0) ? <p className="mt-2 text-sm">{EMPTY_MATURITY_CHANGE}</p> : null}
        <p className="mt-3 text-sm">{REFINANCING_OUTCOME_NOTE}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-navy">Refinancing Intelligence</h2>
        <p className="mt-1 text-sm">{REFINANCING_NOTE}</p>
        <p className="mt-1 text-sm">{OUTCOME_STATE_NOTE}</p>
        {refinancingError ? <p className="mt-3 text-sm">{refinancingError}</p> : null}
        {!refinancingError && (!refinancing || refinancing.length === 0) ? <p className="mt-3 text-sm">{EMPTY_REFINANCING}</p> : null}
        {!refinancingError && refinancing && refinancing.length > 0 ? (
          <div className="mt-3 space-y-4">
            {refinancing.map((item) => (
              <article key={item.key} className="text-sm">
                <p>{item.statement}</p>
                <p className="mt-1 text-muted">{MATURITY_CHANGED_NOTE}</p>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Refinancing outcome</dt>
                    <dd><StateText text={item.outcomeState} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Transaction date</dt>
                    <dd><StateText text={item.transactionDate} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Report dates</dt>
                    <dd>{item.reportDates}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">BDC</dt>
                    <dd><StateText text={bdcName(borrower, item.registrantCik)} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Instrument</dt>
                    <dd>
                      <StateText text={item.instrument} />
                      <span className="text-muted"> · </span>
                      <StateText text={item.instrumentState} />
                      <span className="text-muted"> · Position continuity </span>
                      <StateText text={item.continuityState} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Previous maturity</dt>
                    <dd><StateText text={item.earlierMaturity} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Subsequent maturity</dt>
                    <dd><StateText text={item.laterMaturity} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Previous principal</dt>
                    <dd><ObservedValue value={item.earlierPrincipal} currency={item.earlierPrincipalCurrency} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wider text-muted">Subsequent principal</dt>
                    <dd><ObservedValue value={item.laterPrincipal} currency={item.laterPrincipalCurrency} /></dd>
                  </div>
                </dl>
                <p className="mt-2">
                  <StateText text={item.evidenceLabel} />
                  <span className="text-muted"> · </span>
                  <SecLink href={item.earlierUrl} missing={item.earlierAccession}>{item.earlierAccession}</SecLink>
                  {item.laterAccession !== item.earlierAccession ? (
                    <>
                      <span className="text-muted"> · </span>
                      <SecLink href={item.laterUrl} missing={item.laterAccession}>{item.laterAccession}</SecLink>
                    </>
                  ) : null}
                </p>
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
