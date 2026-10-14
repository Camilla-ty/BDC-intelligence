"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveLegalEntityConsolidation,
  loadEntityConsolidationPreview,
  proposeLegalEntityConsolidation,
  rejectLegalEntityConsolidationProposal,
  reverseLegalEntityConsolidation,
  type EntityPreview,
  type PendingConsolidation,
} from "@/server/consolidations";

function PreviewBlock({ title, preview }: { title: string; preview: EntityPreview | null }) {
  if (preview == null) {
    return (
      <div className="mt-3 rounded-md border border-line p-3 text-sm text-muted">
        {title}: not loaded
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-line p-3 text-sm">
      <h3 className="font-semibold text-navy">{title}</h3>
      <dl className="mt-2 grid gap-1">
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">UUID</dt>
          <dd className="font-mono text-xs">{preview.legal_entity_id}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Canonical UUID</dt>
          <dd className="font-mono text-xs">{preview.canonical_legal_entity_id ?? "Unknown"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Creation reason</dt>
          <dd>{preview.creation_reason}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Aliases</dt>
          <dd>
            {preview.aliases.length === 0
              ? "None"
              : preview.aliases.map((a) => `${a.alias_text} (${a.verification_state})`).join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-muted">Current consolidation</dt>
          <dd>
            {preview.current_consolidation == null
              ? "None"
              : `${preview.current_consolidation.state} / ${preview.current_consolidation.method} → ${
                  preview.current_consolidation.to_legal_entity_id ?? "none"
                } (head ${preview.current_consolidation.id})`}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function AdminConsolidations({
  pending,
  pendingError,
}: {
  pending: PendingConsolidation[];
  pendingError: string | null;
}) {
  const router = useRouter();
  const [pendingUi, startTransition] = useTransition();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [rationale, setRationale] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [citationUrl, setCitationUrl] = useState("");
  const [citationTitle, setCitationTitle] = useState("");
  const [citationExcerpt, setCitationExcerpt] = useState("");
  const [fromPreview, setFromPreview] = useState<EntityPreview | null>(null);
  const [toPreview, setToPreview] = useState<EntityPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [approveRationale, setApproveRationale] = useState<Record<string, string>>({});
  const [rejectRationale, setRejectRationale] = useState<Record<string, string>>({});
  const [reverseRationale, setReverseRationale] = useState("");
  const [reverseEvidenceId, setReverseEvidenceId] = useState("");
  const [reverseCitationUrl, setReverseCitationUrl] = useState("");
  const [reverseCitationTitle, setReverseCitationTitle] = useState("");
  const [reverseCitationExcerpt, setReverseCitationExcerpt] = useState("");
  const [reverseConfirmed, setReverseConfirmed] = useState(false);

  function refreshPreviews() {
    startTransition(async () => {
      setMessage(null);
      const [fromResult, toResult] = await Promise.all([
        fromId.trim() ? loadEntityConsolidationPreview(fromId.trim()) : Promise.resolve({ preview: null, error: null }),
        toId.trim() ? loadEntityConsolidationPreview(toId.trim()) : Promise.resolve({ preview: null, error: null }),
      ]);
      if (fromResult.error) setMessage(fromResult.error);
      else if (toResult.error) setMessage(toResult.error);
      setFromPreview(fromResult.preview);
      setToPreview(toResult.preview);
    });
  }

  function submitProposal() {
    startTransition(async () => {
      setMessage(null);
      const expected =
        fromPreview?.current_consolidation?.id != null
          ? String(fromPreview.current_consolidation.id)
          : "";
      const result = await proposeLegalEntityConsolidation({
        fromLegalEntityId: fromId,
        toLegalEntityId: toId,
        rationale,
        evidenceId,
        citationUrl,
        citationTitle,
        citationExcerpt,
        expectedCurrentId: expected,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(`Proposal ${result.id} recorded. Canonical identity is unchanged until approval.`);
      setRationale("");
      router.refresh();
      refreshPreviews();
    });
  }

  function submitApproval(proposalId: number) {
    startTransition(async () => {
      setMessage(null);
      const rationaleText = (approveRationale[String(proposalId)] ?? "").trim();
      const result = await approveLegalEntityConsolidation({
        proposalId: String(proposalId),
        rationale: rationaleText,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(`Approval ${result.id} recorded. Canonical reads now follow the approved mapping.`);
      router.refresh();
    });
  }

  function submitRejection(proposalId: number) {
    startTransition(async () => {
      setMessage(null);
      const rationaleText = (rejectRationale[String(proposalId)] ?? "").trim();
      const result = await rejectLegalEntityConsolidationProposal({
        proposalId: String(proposalId),
        rationale: rationaleText,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(
        `Proposal rejection ${result.id} recorded. Any previously approved mapping for that source remains effective.`,
      );
      router.refresh();
      refreshPreviews();
    });
  }

  function submitReversal() {
    startTransition(async () => {
      setMessage(null);
      const headId = fromPreview?.current_consolidation?.id;
      if (headId == null) {
        setMessage("Load a source entity with a current consolidation head before reversing.");
        return;
      }
      const result = await reverseLegalEntityConsolidation({
        fromLegalEntityId: fromId,
        expectedCurrentId: String(headId),
        rationale: reverseRationale,
        evidenceId: reverseEvidenceId,
        citationUrl: reverseCitationUrl,
        citationTitle: reverseCitationTitle,
        citationExcerpt: reverseCitationExcerpt,
        confirmed: reverseConfirmed,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setMessage(`Reversal ${result.id} recorded. Historical decisions were preserved.`);
      setReverseConfirmed(false);
      router.refresh();
      refreshPreviews();
    });
  }

  return (
    <section>
      <h1 className="text-lg font-semibold text-navy">Legal-entity consolidations</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Propose and approve an append-only mapping from a source Borrower UUID to a canonical
        survivor. Pending proposals never change borrower pages. Approval is a separate explicit
        action. Researcher citations are not marked as verified SEC evidence.
      </p>

      {message ? <p className="mt-4 text-sm text-foreground">{message}</p> : null}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Propose</h2>
      <div className="mt-3 grid max-w-3xl gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Source (non-canonical) UUID</span>
          <input
            className="rounded-md border border-line px-3 py-2 font-mono text-xs"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Survivor (canonical) UUID</span>
          <input
            className="rounded-md border border-line px-3 py-2 font-mono text-xs"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Rationale</span>
          <textarea
            className="min-h-20 rounded-md border border-line px-3 py-2"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Structured evidence id (optional)</span>
          <input
            className="rounded-md border border-line px-3 py-2 font-mono text-xs"
            value={evidenceId}
            onChange={(e) => setEvidenceId(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Researcher citation URL (https)</span>
          <input
            className="rounded-md border border-line px-3 py-2"
            value={citationUrl}
            onChange={(e) => setCitationUrl(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Researcher citation title</span>
          <input
            className="rounded-md border border-line px-3 py-2"
            value={citationTitle}
            onChange={(e) => setCitationTitle(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Researcher citation excerpt</span>
          <textarea
            className="min-h-16 rounded-md border border-line px-3 py-2"
            value={citationExcerpt}
            onChange={(e) => setCitationExcerpt(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={pendingUi}
            onClick={refreshPreviews}
          >
            Load entity previews
          </button>
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={pendingUi}
            onClick={submitProposal}
          >
            Submit proposal
          </button>
        </div>
      </div>

      <PreviewBlock title="Source entity" preview={fromPreview} />
      <PreviewBlock title="Survivor entity" preview={toPreview} />

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Pending proposals</h2>
      {pendingError ? <p className="mt-3 text-sm">{pendingError}</p> : null}
      {!pendingError && pending.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No pending consolidation proposals.</p>
      ) : null}
      {pending.length > 0 ? (
        <ul className="mt-3 grid gap-4">
          {pending.map((row) => (
            <li key={row.id} className="rounded-md border border-line p-3 text-sm">
              <p className="font-mono text-xs">
                #{row.id}: {row.from_legal_entity_id} → {row.to_legal_entity_id}
              </p>
              <p className="mt-1 text-muted">
                Proposed by {row.decided_by} at {row.decided_at}
              </p>
              <p className="mt-1">{row.rationale}</p>
              {row.researcher_citation_url ? (
                <p className="mt-1 text-xs text-muted">
                  Researcher citation: {row.researcher_citation_title} (
                  <a className="text-accent" href={row.researcher_citation_url}>
                    link
                  </a>
                  ) — not verified SEC evidence. Excerpt: {row.researcher_citation_excerpt}
                </p>
              ) : null}
              {row.evidence_id != null ? (
                <p className="mt-1 text-xs text-muted">Structured evidence id: {row.evidence_id}</p>
              ) : null}
              <label className="mt-3 grid gap-1">
                <span className="text-xs uppercase tracking-wider text-muted">Approval rationale</span>
                <textarea
                  className="min-h-16 rounded-md border border-line px-3 py-2"
                  value={approveRationale[String(row.id)] ?? ""}
                  onChange={(e) =>
                    setApproveRationale((prev) => ({ ...prev, [String(row.id)]: e.target.value }))
                  }
                />
              </label>
              <label className="mt-3 grid gap-1">
                <span className="text-xs uppercase tracking-wider text-muted">Rejection rationale</span>
                <textarea
                  className="min-h-16 rounded-md border border-line px-3 py-2"
                  value={rejectRationale[String(row.id)] ?? ""}
                  onChange={(e) =>
                    setRejectRationale((prev) => ({ ...prev, [String(row.id)]: e.target.value }))
                  }
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={pendingUi}
                  onClick={() => submitApproval(row.id)}
                >
                  Approve consolidation
                </button>
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50"
                  disabled={pendingUi}
                  onClick={() => submitRejection(row.id)}
                >
                  Reject proposal
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-muted">Reverse approved mapping</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Load the source entity above first. Reversal requires explicit confirmation and does not delete
        historical decisions. A pending proposal on top of an approved mapping is cleared together with
        the approved edge.
      </p>
      <div className="mt-3 grid max-w-3xl gap-3 text-sm">
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Reversal rationale</span>
          <textarea
            className="min-h-16 rounded-md border border-line px-3 py-2"
            value={reverseRationale}
            onChange={(e) => setReverseRationale(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Structured evidence id (optional)</span>
          <input
            className="rounded-md border border-line px-3 py-2 font-mono text-xs"
            value={reverseEvidenceId}
            onChange={(e) => setReverseEvidenceId(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Researcher citation URL (https)</span>
          <input
            className="rounded-md border border-line px-3 py-2"
            value={reverseCitationUrl}
            onChange={(e) => setReverseCitationUrl(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Researcher citation title</span>
          <input
            className="rounded-md border border-line px-3 py-2"
            value={reverseCitationTitle}
            onChange={(e) => setReverseCitationTitle(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs uppercase tracking-wider text-muted">Researcher citation excerpt</span>
          <textarea
            className="min-h-16 rounded-md border border-line px-3 py-2"
            value={reverseCitationExcerpt}
            onChange={(e) => setReverseCitationExcerpt(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={reverseConfirmed}
            onChange={(e) => setReverseConfirmed(e.target.checked)}
          />
          I confirm this reverses the effective approved consolidation for the loaded source UUID.
        </label>
        <button
          type="button"
          className="w-fit rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={pendingUi || !reverseConfirmed}
          onClick={submitReversal}
        >
          Reverse consolidation
        </button>
      </div>
    </section>
  );
}
