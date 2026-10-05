import Link from "next/link";
import { SecLink } from "@/components/SecLink";
import { StateText } from "@/components/StateText";
import { ResearchWorkspace } from "@/components/ResearchWorkspace";
import type { DurableLoad } from "@/lib/review-durable";
import {
  BORROWER_INSTRUMENT_NOTE,
  CANDIDATE_NOTE,
  CIK_REVIEW_NOTE,
  FILING_CELL_NOTE,
  IMMUTABILITY_NOTE,
  NOT_RESOLVED_NOTE,
  RATE_SCALE_NOTE,
  REVIEW_ACTIONS,
  REVIEW_PROTOTYPE_NOTE,
  comparisonRows,
  type ReviewModel,
  type ReviewObservation,
} from "@/lib/entity-review";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="text-sm"><StateText text={value} /></p>
    </div>
  );
}

function ObservationFacts({ observation }: { observation: ReviewObservation }) {
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="text-sm font-semibold text-navy">Observation {observation.id}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Fact label="Source name" value={observation.sourceName} />
        <Fact label="Registrant CIK" value={observation.registrantCik} />
        <Fact label="Registrant names" value={observation.registrantNames.join("; ")} />
        <Fact label="Reported date" value={observation.reportedDate} />
        <Fact label="Filed date" value={observation.filedDate} />
        <Fact label="Form" value={observation.form} />
        <Fact label="Accession number" value={observation.accessionNumber} />
        <Fact label="Industry" value={observation.industry} />
        <Fact label="Geography" value={observation.geography} />
        <Fact label="Instrument type" value={observation.instrumentType} />
        <Fact label="Instrument resolution" value={observation.instrumentResolution} />
        <Fact label="Issuer affiliation" value={observation.issuerAffiliation} />
        <Fact label="Spread" value={observation.spread} />
        <Fact label="Interest rate" value={observation.interestRate} />
        <Fact label="Maturity" value={observation.maturity} />
        <Fact label="Acquisition date" value={observation.acquisitionDate} />
        <Fact label="Principal" value={observation.principal} />
        <Fact label="Cost" value={observation.cost} />
        <Fact label="Fair value" value={observation.fairValue} />
        <Fact label="Evidence" value={observation.evidence} />
      </div>
      <p className="mt-3 text-sm">
        Filing document:{" "}
        <SecLink href={observation.documentUrl}>{observation.documentName}</SecLink>
      </p>
      <p className="mt-1 text-sm">
        Original filing:{" "}
        <SecLink href={observation.inlineUrl} missing={<StateText text="Not stored" />}>Inline filing</SecLink>
      </p>
    </div>
  );
}

export function EntityReview({
  model,
  durable = { deployed: false, candidate: null },
}: {
  model: ReviewModel;
  durable?: DurableLoad;
}) {
  const rows = comparisonRows(model);
  const stored = durable.candidate;
  const rowsWithHeadings = rows.map((row, index) => ({
    row,
    heading: index === 0 || rows[index - 1]?.section !== row.section ? row.section : null,
  }));
  return (
    <article>
      <p className="text-xs uppercase tracking-wider text-muted">{stored ? "Review case" : "Potential match"}</p>
      <h1 className="mt-1 text-lg font-semibold text-navy">{stored ? stored.title : "Entity resolution review"}</h1>
      {stored ? <p className="mt-2 text-sm">This is a review case. Resolution has not been decided.</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Fact label="Candidate" value={stored?.title ?? model.candidate.label} />
        <Fact label="Status" value={stored ? `${stored.status} · Resolution has not been decided` : `${model.candidate.status} · Researcher review required`} />
        <Fact label="Candidate type" value="Borrower" />
        <Fact label="Candidate source" value="Manual seed" />
        <Fact label="Rule version" value="Not stored" />
        <Fact label="Case members" value={stored ? String(stored.members.length) : "Not stored"} />
      </div>
      <div className="mt-4 space-y-2 text-sm text-muted">
        <p>{NOT_RESOLVED_NOTE}</p>
        <p>{CANDIDATE_NOTE}</p>
        <p>{BORROWER_INSTRUMENT_NOTE}</p>
        <p>{IMMUTABILITY_NOTE}</p>
        <p>{FILING_CELL_NOTE}</p>
        <p>{CIK_REVIEW_NOTE}</p>
        <p>{RATE_SCALE_NOTE}</p>
      </div>

      <h2 className="mt-8 text-base font-semibold text-navy">Evidence comparison</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="record-table w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col">Evidence</th>
              {model.groups.map((group) => (
                <th key={group.sourceName} scope="col">
                  <span className="block text-xs font-normal uppercase tracking-wider">Source observation</span>
                  {group.sourceName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsWithHeadings.map(({ row, heading }) => (
                <tr key={`${row.section}-${row.label}`}>
                  <th scope="row">
                    {heading ? <span className="block text-xs uppercase tracking-wider text-muted">{heading}</span> : null}
                    {row.label}
                  </th>
                  {row.values.map((value, index) => (
                    <td key={`${model.groups[index]?.sourceName ?? index}-${row.label}`}>
                      <StateText text={value} />
                    </td>
                  ))}
                </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-base font-semibold text-navy">Borrower identity</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Fact label="Legal entity" value={model.legalEntity} />
        <Fact label="Economic group" value={model.economicGroup} />
        <Fact label="Legal name" value={model.legalName} />
        <Fact label="Normalized name" value={model.normalizedName} />
        <Fact label="Issuer CIK" value={model.issuerCik} />
        <Fact label="LEI" value={model.lei} />
      </div>

      <h2 className="mt-8 text-base font-semibold text-navy">Instrument identity</h2>
      <p className="mt-2 text-sm text-muted">
        Each disclosed line remains its own instrument observation. This review does not decide that those lines are the same instrument.
      </p>

      <h2 className="mt-8 text-base font-semibold text-navy">Source observations</h2>
      {model.groups.map((group) => (
        <section key={group.sourceName} className="mt-6">
          <p className="text-xs uppercase tracking-wider text-muted">Source observation</p>
          <h3 className="text-sm font-semibold text-navy">{group.sourceName}</h3>
          {group.observations.length === 0 ? (
            <p className="mt-2 text-sm"><StateText text="No stored observation" /></p>
          ) : (
            group.observations.map((item) => <ObservationFacts key={item.id} observation={item} />)
          )}
        </section>
      ))}

      <ResearchWorkspace model={model} durable={durable} />

      <h2 className="mt-8 text-base font-semibold text-navy">Researcher review required</h2>
      <p id="review-prototype" className="mt-2 text-sm">{REVIEW_PROTOTYPE_NOTE}</p>
      <p className="mt-1 text-sm text-muted">These actions do not create a resolution decision.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {REVIEW_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!model.writesEnabled}
            aria-describedby="review-prototype"
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>
      <p className="mt-6 text-sm">
        <Link href="/review/entities" className="text-accent">Review queue</Link>
      </p>
    </article>
  );
}
