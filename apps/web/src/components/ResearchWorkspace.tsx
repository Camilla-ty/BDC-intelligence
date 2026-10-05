"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { SecLink } from "@/components/SecLink";
import {
  DECISION_WRITES_ENABLED,
  EVIDENCE_SET_NOTE,
  EXTERNAL_SOURCE_TYPES,
  FUTURE_DECISION_NOTE,
  NOT_CURRENTLY_EXPOSED,
  READER_GAPS,
  RESEARCH_QUESTIONS,
  RESEARCHER_ADDED_SOURCE_LABEL,
  RESEARCHER_INTERPRETATION_LABEL,
  SOURCE_FACT_LABEL,
  WORKSPACE_PROTOTYPE_NOTE,
  addEvidenceSet,
  addExternalEvidence,
  addResearcherNote,
  questionLabel,
  sourceTypeLabel,
  workspaceFromReview,
  type EvidenceItem,
  type ResearchWorkspaceState,
} from "@/lib/research-workspace";
import type { ReviewModel } from "@/lib/entity-review";
import { DURABLE_ABSENT_NOTE, type DurableLoad } from "@/lib/review-durable";
import {
  addExternalReviewEvidence,
  addReviewEvidenceSet,
  addReviewNote,
  openReviewCandidate,
} from "@/server/review-actions";

const fieldClass = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm";

function Label({ htmlFor, children }: { htmlFor: string; children: string }) {
  return <label htmlFor={htmlFor} className="block text-xs uppercase tracking-wider text-muted">{children}</label>;
}

function Provenance({ item }: { item: EvidenceItem }) {
  const internal = item.origin === "INTERNAL";
  return (
    <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted">Candidate</dt>
        <dd>{item.provenance.candidateId}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted">Observation</dt>
        <dd>{item.provenance.observationId ?? "Not part of a stored observation"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted">Filing</dt>
        <dd>{item.provenance.accessionNumber ?? "Not part of the stored SEC corpus"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted">Artifact</dt>
        <dd>{internal ? NOT_CURRENTLY_EXPOSED : "Not ingested"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted">Locator</dt>
        <dd>{internal ? NOT_CURRENTLY_EXPOSED : "No stored locator"}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-wider text-muted">Retrieved</dt>
        <dd>{item.retrievedAt ?? (internal ? NOT_CURRENTLY_EXPOSED : "Not provided")}</dd>
      </div>
    </dl>
  );
}

function EvidenceCard({ item }: { item: EvidenceItem }) {
  const external = item.origin === "EXTERNAL";
  return (
    <article className="rounded-md border border-line p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-navy">{SOURCE_FACT_LABEL}</p>
      {external ? <p className="mt-1 text-xs font-semibold uppercase tracking-wider">{RESEARCHER_ADDED_SOURCE_LABEL}</p> : null}
      <p className="mt-2 text-sm">{item.relevantExcerpt}</p>
      <p className="mt-2 text-sm">
        {sourceTypeLabel(item.sourceType)}
        {item.questionId ? ` · ${questionLabel(item.questionId)}` : null}
        {item.sourceDocumentDate ? ` · ${item.sourceDocumentDate}` : null}
      </p>
      <p className="mt-1 text-sm">
        {item.sourceUrl ? <SecLink href={item.sourceUrl}>{item.sourceTitle}</SecLink> : item.sourceTitle}
      </p>
      {external ? (
        <p className="mt-1 text-sm text-muted">Added by {item.createdBy} · {item.createdAt}</p>
      ) : null}
      <Provenance item={item} />
    </article>
  );
}

export function ResearchWorkspace({
  model,
  durable = { deployed: false, candidate: null },
}: {
  model: ReviewModel;
  durable?: DurableLoad;
}) {
  const router = useRouter();
  const initial = useMemo(() => workspaceFromReview(model), [model]);
  const [workspace, setWorkspace] = useState<ResearchWorkspaceState>(initial);
  const recorded = durable.candidate?.state ?? null;
  const working = recorded ?? workspace;
  const [questionId, setQuestionId] = useState<string>(RESEARCH_QUESTIONS[0].id);
  const [sourceType, setSourceType] = useState<string>(EXTERNAL_SOURCE_TYPES[0].id);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceDocumentDate, setSourceDocumentDate] = useState("");
  const [relevantExcerpt, setRelevantExcerpt] = useState("");
  const [researcherNote, setResearcherNote] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [noteEvidenceId, setNoteEvidenceId] = useState(initial.items[0]?.evidenceId ?? "");
  const [noteText, setNoteText] = useState("");
  const [noteAuthor, setNoteAuthor] = useState("");
  const [setTitle, setSetTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-navy">Research evidence workspace</h2>
      <p className="mt-2 text-sm">{durable.candidate ? "Stored review case. Resolution has not been decided." : durable.deployed ? "Local review layer. A stored case is not an identity decision." : DURABLE_ABSENT_NOTE}</p>
      {durable.candidate ? null : <p className="mt-1 text-sm">{WORKSPACE_PROTOTYPE_NOTE}</p>}
      <p className="mt-1 text-sm text-muted">
        Source facts stay separate from researcher interpretation. This workspace does not create a legal entity, a resolution decision, or an ingestion run.
      </p>

      <h3 className="mt-6 text-sm font-semibold text-navy">Stored SEC evidence</h3>
      <p className="mt-1 text-sm text-muted">Each row is a stored source observation. The excerpt is the disclosed line. Artifact and locator are not on this read path.</p>
      {initial.items.some((item) => item.origin === "INTERNAL") ? (
        <div className="mt-3 overflow-x-auto">
          <table className="record-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Excerpt</th>
                <th scope="col">Observation</th>
                <th scope="col">Accession</th>
                <th scope="col">Filing</th>
                <th scope="col">Artifact</th>
                <th scope="col">Locator</th>
              </tr>
            </thead>
            <tbody>
              {initial.items.filter((item) => item.origin === "INTERNAL").map((item) => (
                <tr key={item.evidenceId}>
                  <th scope="row">{SOURCE_FACT_LABEL}</th>
                  <td>{item.relevantExcerpt}</td>
                  <td>{item.provenance.observationId}</td>
                  <td>{item.provenance.accessionNumber}</td>
                  <td>{item.sourceUrl ? <SecLink href={item.sourceUrl}>{item.sourceTitle}</SecLink> : item.sourceTitle}</td>
                  <td>{NOT_CURRENTLY_EXPOSED}</td>
                  <td>{NOT_CURRENTLY_EXPOSED}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm">No stored observation</p>
      )}

      <h3 className="mt-6 text-sm font-semibold text-navy">Reader exposure</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {READER_GAPS.map((gap) => (
          <li key={gap}>
            {gap}: <span>{NOT_CURRENTLY_EXPOSED}</span>
          </li>
        ))}
      </ul>

      {durable.deployed && !durable.candidate ? (
        <button
          type="button"
          className="mt-4 rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white"
          onClick={() => {
            if (createdBy.trim() === "") {
              setError("Enter the researcher name.");
              return;
            }
            void openReviewCandidate({
              caseKey: model.candidate.id,
              title: model.candidate.label,
              createdBy,
              positionObservationIds: model.groups.flatMap((group) => group.observations.map((item) => item.id)),
            }).then((result) => {
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setError(null);
              router.refresh();
            });
          }}
        >
          Open local review candidate
        </button>
      ) : null}
      {durable.candidate ? (
        <div className="mt-4">
          <p className="text-sm">Stored case status {durable.candidate.status}. Membership is {durable.candidate.members.length} source observations.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {durable.candidate.members.map((member) => (
              <li key={member.positionObservationId}>
                {member.disclosedLine} · Observation {member.positionObservationId}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {durable.candidate ? null : <>
      <h3 className="mt-6 text-sm font-semibold text-navy">Add research evidence</h3>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (durable.candidate) {
            void addExternalReviewEvidence({
              caseKey: durable.candidate.caseKey,
              candidateId: durable.candidate.candidateId,
              sourceType,
              title: sourceTitle,
              sourceUrl,
              documentDate: sourceDocumentDate,
              excerpt: relevantExcerpt,
              noteText: researcherNote,
              positionObservationId: null,
              createdBy,
            }).then((result) => {
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setSourceTitle("");
              setSourceUrl("");
              setSourceDocumentDate("");
              setRelevantExcerpt("");
              setResearcherNote("");
              setError(null);
              router.refresh();
            });
            return;
          }
          const note = researcherNote.trim();
          const result = addExternalEvidence(workspace, {
            questionId,
            sourceType,
            sourceTitle,
            sourceUrl,
            sourceDocumentDate,
            relevantExcerpt,
            researcherNote,
            createdBy,
          }, {
            evidenceId: crypto.randomUUID(),
            noteId: note === "" ? null : crypto.randomUUID(),
            now: new Date().toISOString(),
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setWorkspace(result.workspace);
          setSourceTitle("");
          setSourceUrl("");
          setSourceDocumentDate("");
          setRelevantExcerpt("");
          setResearcherNote("");
          setError(null);
        }}
      >
        <div>
          <Label htmlFor="research-question">Research question</Label>
          <select id="research-question" className={fieldClass} value={questionId} onChange={(event) => setQuestionId(event.target.value)}>
            {RESEARCH_QUESTIONS.map((question) => <option key={question.id} value={question.id}>{question.label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="research-source-type">Source type</Label>
          <select id="research-source-type" className={fieldClass} value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            {EXTERNAL_SOURCE_TYPES.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="research-title">Source title</Label>
          <input id="research-title" className={fieldClass} value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="research-url">Source URL</Label>
          <input id="research-url" className={fieldClass} inputMode="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="research-date">Document date</Label>
          <input id="research-date" className={fieldClass} placeholder="YYYY-MM-DD" value={sourceDocumentDate} onChange={(event) => setSourceDocumentDate(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="research-author">Researcher</Label>
          <input id="research-author" className={fieldClass} value={createdBy} onChange={(event) => setCreatedBy(event.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="research-excerpt">Relevant excerpt</Label>
          <textarea id="research-excerpt" className={fieldClass} rows={3} value={relevantExcerpt} onChange={(event) => setRelevantExcerpt(event.target.value)} />
          <p className="mt-1 text-xs text-muted">What the source says. This is a source fact, including when a researcher typed the excerpt.</p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="research-note">Researcher note</Label>
          <textarea id="research-note" className={fieldClass} rows={3} value={researcherNote} onChange={(event) => setResearcherNote(event.target.value)} />
          <p className="mt-1 text-xs text-muted">What you think the source means. A note is researcher interpretation, not a source fact.</p>
        </div>
        <div>
          <button type="submit" className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">Add research evidence</button>
        </div>
      </form>

      <h3 className="mt-6 text-sm font-semibold text-navy">Researcher-added sources</h3>
      {working.items.some((item) => item.origin === "EXTERNAL") ? (
        <div className="mt-3 space-y-3">
          {working.items.filter((item) => item.origin === "EXTERNAL").map((item) => (
            <EvidenceCard key={item.evidenceId} item={item} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm">No researcher-added source</p>
      )}

      <h3 className="mt-6 text-sm font-semibold text-navy">Add a researcher note</h3>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (durable.candidate) {
            void addReviewNote({
              caseKey: durable.candidate.caseKey,
              candidateId: durable.candidate.candidateId,
              evidenceItemId: noteEvidenceId,
              text: noteText,
              createdBy: noteAuthor,
            }).then((result) => {
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setNoteText("");
              setError(null);
              router.refresh();
            });
            return;
          }
          const result = addResearcherNote(workspace, {
            evidenceId: noteEvidenceId,
            text: noteText,
            createdBy: noteAuthor,
          }, { noteId: crypto.randomUUID(), now: new Date().toISOString() });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setWorkspace(result.workspace);
          setNoteText("");
          setError(null);
        }}
      >
        <div>
          <Label htmlFor="note-evidence">Evidence</Label>
          <select id="note-evidence" className={fieldClass} value={noteEvidenceId} onChange={(event) => setNoteEvidenceId(event.target.value)}>
            {working.items.length === 0 ? <option value="">No stored observation</option> : null}
            {working.items.map((item) => (
              <option key={item.evidenceId} value={item.evidenceId}>
                {item.relevantExcerpt}{item.provenance.observationId ? ` · Observation ${item.provenance.observationId}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="note-text">Researcher note</Label>
          <textarea id="note-text" className={fieldClass} rows={3} value={noteText} onChange={(event) => setNoteText(event.target.value)} />
        </div>
        <div>
          <Label htmlFor="note-author">Researcher</Label>
          <input id="note-author" className={fieldClass} value={noteAuthor} onChange={(event) => setNoteAuthor(event.target.value)} />
        </div>
        <div>
          <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-navy">Add researcher note</button>
        </div>
      </form>

      <h3 className="mt-6 text-sm font-semibold text-navy">{RESEARCHER_INTERPRETATION_LABEL}</h3>
      <p className="mt-1 text-sm text-muted">These notes are the researcher&apos;s reading. They are not source facts and they are not a resolution decision.</p>
      {working.notes.length === 0 ? (
        <p className="mt-2 text-sm">No researcher note</p>
      ) : (
        <div className="mt-3 space-y-3">
          {working.notes.map((note) => {
            const item = working.items.find((entry) => entry.evidenceId === note.evidenceId);
            return (
              <article key={note.noteId} className="rounded-md border border-dashed border-line p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-navy">{RESEARCHER_INTERPRETATION_LABEL}</p>
                <p className="mt-2 text-sm">{note.text}</p>
                <p className="mt-2 text-xs text-muted">
                  {note.createdBy} · {note.createdAt}
                  {item ? ` · interprets “${item.relevantExcerpt}”` : null}
                </p>
              </article>
            );
          })}
        </div>
      )}

      <h3 className="mt-6 text-sm font-semibold text-navy">EVIDENCE SET — NOT A DECISION</h3>
      <p className="mt-1 text-sm text-muted">{EVIDENCE_SET_NOTE}</p>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (durable.candidate) {
            void addReviewEvidenceSet({
              caseKey: durable.candidate.caseKey,
              candidateId: durable.candidate.candidateId,
              title: setTitle,
              evidenceItemIds: selectedIds,
              createdBy: createdBy || noteAuthor,
            }).then((result) => {
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setSetTitle("");
              setSelectedIds([]);
              setError(null);
              router.refresh();
            });
            return;
          }
          const result = addEvidenceSet(workspace, { title: setTitle, evidenceIds: selectedIds }, { setId: crypto.randomUUID() });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setWorkspace(result.workspace);
          setSetTitle("");
          setSelectedIds([]);
          setError(null);
        }}
      >
        <div>
          <Label htmlFor="evidence-set-title">Evidence set name</Label>
          <input id="evidence-set-title" className={fieldClass} value={setTitle} onChange={(event) => setSetTitle(event.target.value)} />
        </div>
        <fieldset>
          <legend className="text-xs uppercase tracking-wider text-muted">Evidence in this set</legend>
          {working.items.length === 0 ? <p className="mt-2 text-sm">No stored observation</p> : (
            <div className="mt-2 space-y-2">
              {working.items.map((item) => (
                <label key={item.evidenceId} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedIds.includes(item.evidenceId)}
                    onChange={(event) => {
                      setSelectedIds((current) => event.target.checked
                        ? [...current, item.evidenceId]
                        : current.filter((id) => id !== item.evidenceId));
                    }}
                  />
                  <span>
                    {item.relevantExcerpt}
                    {item.provenance.observationId ? ` · Observation ${item.provenance.observationId}` : ""}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <div>
          <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-navy">Group selected evidence</button>
        </div>
      </form>
      </>}
      {working.sets.length === 0 ? (
        <p className="mt-3 text-sm">No evidence set</p>
      ) : (
        <div className="mt-3 space-y-3">
          {working.sets.map((set) => (
            <article key={set.setId} className="rounded-md border border-line p-3">
              <h4 className="text-sm font-semibold text-navy">{set.title}</h4>
              <p className="mt-1 text-xs text-muted">Not a decision</p>
              <ul className="mt-2 list-disc pl-5 text-sm">
                {set.evidenceIds.map((id) => {
                  const item = working.items.find((entry) => entry.evidenceId === id);
                  return <li key={id}>{item?.relevantExcerpt ?? id}</li>;
                })}
              </ul>
            </article>
          ))}
        </div>
      )}

      {error ? <p className="mt-4 text-sm" role="alert">{error}</p> : null}

      <h3 className="mt-6 text-sm font-semibold text-navy">Future decision</h3>
      <p className="mt-2 text-sm">{FUTURE_DECISION_NOTE}</p>
      <p className="mt-1 text-sm text-muted">
        Decision state, researcher, timestamp, rationale, evidence set, and previous decision are not recorded here.
        {DECISION_WRITES_ENABLED ? "" : " Decision writes are off."}
      </p>
    </section>
  );
}
