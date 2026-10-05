import type { ReviewModel, ReviewObservation } from "@/lib/entity-review";

// Session-only research workspace. evidence.evidence is a locator inside an
// ingested artifact and requires a pipeline run, so an external URL or a
// researcher note cannot be stored there without inventing an artifact.
// No table is created and nothing is written.

export const NOT_CURRENTLY_EXPOSED = "NOT CURRENTLY EXPOSED";
export const SOURCE_FACT_LABEL = "SOURCE FACT";
export const RESEARCHER_INTERPRETATION_LABEL = "RESEARCHER INTERPRETATION";
export const RESEARCHER_ADDED_SOURCE_LABEL = "RESEARCHER-ADDED SOURCE";
export const WORKSPACE_PROTOTYPE_NOTE =
  "Research evidence prototype — not written to Production. Sources and notes added here stay in this browser session.";
export const EVIDENCE_SET_NOTE =
  "An evidence set groups sources for a research step. The set is not a same-company or different-company decision.";
export const FUTURE_DECISION_NOTE =
  "A future decision would cite one evidence set and append a new review event. It would not delete or overwrite an earlier event, and it would not merge source observations, filings, artifacts, or evidence.";

export const DECISION_WRITES_ENABLED = false;

export const WORKSPACE_SAFETY = {
  legalEntitiesCreated: 0,
  resolutionDecisionsCreated: 0,
  ingestionRunsCreated: 0,
  parserRulesModified: 0,
  productionWrites: 0,
  persisted: false,
} as const;

export const READER_GAPS = [
  "Company-cell text",
  "HTML row locator",
  "Artifact",
  "Filing display of industry",
  "Filing display of instrument type",
  "Filing display of maturity",
  "Filing display of acquisition or purchase date",
  "Address",
  "Legal name",
  "Business description",
  "Issuer CIK",
  "LEI",
] as const;

export const RESEARCH_QUESTIONS = [
  { id: "COMPANY_ADDRESS", label: "Company address" },
  { id: "LEGAL_NAME", label: "Legal name" },
  { id: "BUSINESS_DESCRIPTION", label: "Business description" },
  { id: "OWNERSHIP_RELATIONSHIP", label: "Ownership relationship" },
  { id: "TRANSACTION_RELATIONSHIP", label: "Transaction relationship" },
  { id: "ISSUER_IDENTITY", label: "Issuer identity" },
  { id: "CIK_OR_LEI", label: "CIK / LEI" },
  { id: "CORPORATE_RELATIONSHIP", label: "Corporate relationship" },
] as const;

export const EXTERNAL_SOURCE_TYPES = [
  { id: "COMPANY_WEBSITE", label: "Company website" },
  { id: "SEC_FILING", label: "SEC filing" },
  { id: "TRANSACTION_DOCUMENT", label: "Transaction document" },
  { id: "COURT_DOCUMENT", label: "Court document" },
  { id: "RATING_AGENCY", label: "Rating agency" },
  { id: "STATE_REGISTRY", label: "State registry" },
  { id: "OTHER", label: "Other" },
] as const;

export type ResearchQuestionId = (typeof RESEARCH_QUESTIONS)[number]["id"];
export type ExternalSourceType = (typeof EXTERNAL_SOURCE_TYPES)[number]["id"];
export type EvidenceOrigin = "INTERNAL" | "EXTERNAL";

export type EvidenceProvenance = {
  candidateId: string;
  observationId: string | null;
  accessionNumber: string | null;
  documentUrl: string | null;
  artifact: typeof NOT_CURRENTLY_EXPOSED | null;
  locator: string | null;
};

export type EvidenceItem = {
  evidenceId: string;
  candidateId: string;
  origin: EvidenceOrigin;
  sourceType: "INTERNAL_SEC_FILING" | ExternalSourceType;
  sourceTitle: string;
  sourceUrl: string | null;
  sourceDocumentDate: string | null;
  retrievedAt: string | null;
  sourceReference: string;
  relevantExcerpt: string;
  questionId: ResearchQuestionId | null;
  createdBy: string | null;
  createdAt: string | null;
  provenance: EvidenceProvenance;
};

export type ResearcherNote = {
  noteId: string;
  candidateId: string;
  evidenceId: string;
  text: string;
  createdBy: string;
  createdAt: string;
};

export type EvidenceSet = {
  setId: string;
  candidateId: string;
  title: string;
  evidenceIds: readonly string[];
};

export type ResearchWorkspaceState = {
  candidateId: string;
  items: readonly EvidenceItem[];
  notes: readonly ResearcherNote[];
  sets: readonly EvidenceSet[];
  decisions: readonly [];
  legalEntitiesCreated: 0;
  resolutionDecisionsCreated: 0;
  ingestionRunsCreated: 0;
  parserRulesModified: 0;
  productionWrites: 0;
  persisted: false;
};

export type ExternalEvidenceDraft = {
  questionId: string;
  sourceType: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDocumentDate: string;
  relevantExcerpt: string;
  researcherNote: string;
  createdBy: string;
};

export type ResearcherNoteDraft = {
  evidenceId: string;
  text: string;
  createdBy: string;
};

export type EvidenceSetDraft = {
  title: string;
  evidenceIds: readonly string[];
};

const HTTPS_URL = /^https:\/\/[^\s]+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function questionId(value: string): ResearchQuestionId | null {
  return RESEARCH_QUESTIONS.some((question) => question.id === value) ? (value as ResearchQuestionId) : null;
}

function sourceType(value: string): ExternalSourceType | null {
  return EXTERNAL_SOURCE_TYPES.some((source) => source.id === value) ? (value as ExternalSourceType) : null;
}

function clean(value: string): string {
  return value.trim();
}

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function internalItem(candidateId: string, observation: ReviewObservation): EvidenceItem {
  return {
    evidenceId: `internal:${candidateId}:${observation.id}`,
    candidateId,
    origin: "INTERNAL",
    sourceType: "INTERNAL_SEC_FILING",
    sourceTitle: observation.documentName,
    sourceUrl: observation.documentUrl,
    sourceDocumentDate: isIsoDate(observation.filedDate) ? observation.filedDate : null,
    retrievedAt: null,
    sourceReference: observation.accessionNumber,
    relevantExcerpt: observation.sourceName,
    questionId: null,
    createdBy: null,
    createdAt: null,
    provenance: {
      candidateId,
      observationId: observation.id,
      accessionNumber: observation.accessionNumber,
      documentUrl: observation.documentUrl,
      artifact: NOT_CURRENTLY_EXPOSED,
      locator: NOT_CURRENTLY_EXPOSED,
    },
  };
}

export function workspaceFromReview(model: ReviewModel): ResearchWorkspaceState {
  const items: EvidenceItem[] = [];
  for (const group of model.groups) {
    for (const observation of group.observations) items.push(internalItem(model.candidate.id, observation));
  }
  return {
    candidateId: model.candidate.id,
    items,
    notes: [],
    sets: [],
    decisions: [],
    ...WORKSPACE_SAFETY,
  };
}

export function addExternalEvidence(
  workspace: ResearchWorkspaceState,
  draft: ExternalEvidenceDraft,
  meta: { evidenceId: string; noteId: string | null; now: string },
): { ok: true; workspace: ResearchWorkspaceState } | { ok: false; error: string } {
  const title = clean(draft.sourceTitle);
  const url = clean(draft.sourceUrl);
  const excerpt = clean(draft.relevantExcerpt);
  const researcher = clean(draft.createdBy);
  const note = clean(draft.researcherNote);
  const date = clean(draft.sourceDocumentDate);
  const question = questionId(draft.questionId);
  const type = sourceType(draft.sourceType);
  if (question == null) return { ok: false, error: "Choose a research question." };
  if (type == null) return { ok: false, error: "Choose a source type." };
  if (title === "") return { ok: false, error: "Enter the source title." };
  if (!HTTPS_URL.test(url)) return { ok: false, error: "Enter an https source URL." };
  if (date !== "" && !isIsoDate(date)) return { ok: false, error: "Enter the document date as YYYY-MM-DD, or leave it blank." };
  if (excerpt === "") return { ok: false, error: "Enter the excerpt. An excerpt is what the source says." };
  if (researcher === "") return { ok: false, error: "Enter the researcher name." };
  if (note !== "" && meta.noteId == null) return { ok: false, error: "A researcher note needs its own id." };
  const item: EvidenceItem = {
    evidenceId: meta.evidenceId,
    candidateId: workspace.candidateId,
    origin: "EXTERNAL",
    sourceType: type,
    sourceTitle: title,
    sourceUrl: url,
    sourceDocumentDate: date === "" ? null : date,
    retrievedAt: meta.now,
    sourceReference: url,
    relevantExcerpt: excerpt,
    questionId: question,
    createdBy: researcher,
    createdAt: meta.now,
    provenance: {
      candidateId: workspace.candidateId,
      observationId: null,
      accessionNumber: null,
      documentUrl: null,
      artifact: null,
      locator: null,
    },
  };
  const notes = note === "" || meta.noteId == null
    ? workspace.notes
    : [...workspace.notes, {
        noteId: meta.noteId,
        candidateId: workspace.candidateId,
        evidenceId: item.evidenceId,
        text: note,
        createdBy: researcher,
        createdAt: meta.now,
      }];
  return {
    ok: true,
    workspace: { ...workspace, items: [...workspace.items, item], notes },
  };
}

export function addResearcherNote(
  workspace: ResearchWorkspaceState,
  draft: ResearcherNoteDraft,
  meta: { noteId: string; now: string },
): { ok: true; workspace: ResearchWorkspaceState } | { ok: false; error: string } {
  const text = clean(draft.text);
  const researcher = clean(draft.createdBy);
  if (workspace.items.every((item) => item.evidenceId !== draft.evidenceId)) {
    return { ok: false, error: "Choose the evidence this note interprets." };
  }
  if (text === "") return { ok: false, error: "Enter the researcher note." };
  if (researcher === "") return { ok: false, error: "Enter the researcher name." };
  return {
    ok: true,
    workspace: {
      ...workspace,
      notes: [...workspace.notes, {
        noteId: meta.noteId,
        candidateId: workspace.candidateId,
        evidenceId: draft.evidenceId,
        text,
        createdBy: researcher,
        createdAt: meta.now,
      }],
    },
  };
}

export function addEvidenceSet(
  workspace: ResearchWorkspaceState,
  draft: EvidenceSetDraft,
  meta: { setId: string },
): { ok: true; workspace: ResearchWorkspaceState } | { ok: false; error: string } {
  const title = clean(draft.title);
  const ids = [...new Set(draft.evidenceIds)];
  if (title === "") return { ok: false, error: "Enter a name for the evidence set." };
  if (ids.length === 0) return { ok: false, error: "Select at least one evidence item." };
  if (ids.some((id) => workspace.items.every((item) => item.evidenceId !== id))) {
    return { ok: false, error: "An evidence set can include only evidence in this workspace." };
  }
  return {
    ok: true,
    workspace: {
      ...workspace,
      sets: [...workspace.sets, { setId: meta.setId, candidateId: workspace.candidateId, title, evidenceIds: ids }],
    },
  };
}

export function questionLabel(id: ResearchQuestionId): string {
  return RESEARCH_QUESTIONS.find((question) => question.id === id)?.label ?? id;
}

export function sourceTypeLabel(id: EvidenceItem["sourceType"]): string {
  if (id === "INTERNAL_SEC_FILING") return "Stored SEC filing";
  return EXTERNAL_SOURCE_TYPES.find((source) => source.id === id)?.label ?? id;
}
