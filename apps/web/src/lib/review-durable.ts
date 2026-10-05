import {
  NOT_CURRENTLY_EXPOSED,
  type EvidenceItem,
  type EvidenceSet,
  type ResearchWorkspaceState,
  type ResearcherNote,
} from "@/lib/research-workspace";

export const DURABLE_ABSENT_NOTE =
  "Durable review tables are not on this database. Sources added here stay in this browser session and are not written.";
export const DURABLE_WRITE_REFUSED = "Durable review writes are not enabled for this database.";

const SAFE_TEXT = /^[ -~]+$/;
const CASE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const INTEGER_ID = /^[0-9]+$/;
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SOURCE_TYPES = [
  "COMPANY_WEBSITE",
  "SEC_FILING",
  "TRANSACTION_DOCUMENT",
  "COURT_DOCUMENT",
  "RATING_AGENCY",
  "STATE_REGISTRY",
  "OTHER",
] as const;

export function reviewWritesAllowed(databaseUrl: string | undefined): boolean {
  return databaseUrl == null || databaseUrl.trim() === "";
}

function quoteLiteral(value: string): string {
  if (!SAFE_TEXT.test(value) || value.includes(";")) throw new Error("Review text cannot be queried.");
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteId(value: string): string {
  if (!INTEGER_ID.test(value)) throw new Error("Review id cannot be queried.");
  return value;
}

export function durableReviewSql(caseKey: string): string {
  if (!CASE_KEY.test(caseKey)) throw new Error("Review case cannot be queried.");
  const key = quoteLiteral(caseKey);
  return `
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT CASE
  WHEN to_regclass('review.current_candidate') IS NULL THEN '{"deployed":false}'::json
  ELSE json_build_object(
    'deployed', true,
    'candidate', (SELECT row_to_json(c) FROM review.current_candidate c WHERE case_key = ${key}),
    'members', COALESCE((SELECT json_agg(row_to_json(m)) FROM review.candidate_member_read m
      WHERE candidate_id = (SELECT candidate_id FROM review.current_candidate WHERE case_key = ${key})), '[]'::json),
    'items', COALESCE((SELECT json_agg(row_to_json(i)) FROM review.evidence_item_read i
      WHERE candidate_id = (SELECT candidate_id FROM review.current_candidate WHERE case_key = ${key})), '[]'::json),
    'notes', COALESCE((SELECT json_agg(row_to_json(n)) FROM review.researcher_note_read n
      WHERE candidate_id = (SELECT candidate_id FROM review.current_candidate WHERE case_key = ${key})), '[]'::json),
    'sets', COALESCE((SELECT json_agg(row_to_json(s)) FROM review.evidence_set_read s
      WHERE candidate_id = (SELECT candidate_id FROM review.current_candidate WHERE case_key = ${key})), '[]'::json),
    'memberships', COALESCE((SELECT json_agg(row_to_json(ms)) FROM review.evidence_set_member_read ms
      WHERE evidence_set_id IN (SELECT evidence_set_id FROM review.evidence_set_read
        WHERE candidate_id = (SELECT candidate_id FROM review.current_candidate WHERE case_key = ${key}))), '[]'::json)
  )
END::text;
RESET ROLE;
`;
}

export type DurableMember = {
  positionObservationId: string;
  evidenceId: string;
  disclosedLine: string;
};

export type DurableCandidate = {
  candidateId: string;
  caseKey: string;
  title: string;
  status: "OPEN" | "CLOSED";
  members: DurableMember[];
  state: ResearchWorkspaceState;
};

export type DurableLoad =
  | { deployed: false; candidate: null }
  | { deployed: true; candidate: DurableCandidate | null };

type RawRecord = Record<string, unknown>;

function record(value: unknown, label: string): RawRecord {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(label);
  return value as RawRecord;
}

function text(row: RawRecord, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(key);
  return value;
}

function optionalText(row: RawRecord, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(key);
  return value;
}

function idText(row: RawRecord, key: string): string {
  const value = row[key];
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && INTEGER_ID.test(value)) return value;
  throw new Error(key);
}

function optionalId(row: RawRecord, key: string): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && INTEGER_ID.test(value)) return value;
  throw new Error(key);
}

export function parseDurableLoad(value: unknown): DurableLoad {
  const row = record(value, "durable");
  if (row.deployed !== true) return { deployed: false, candidate: null };
  if (row.candidate == null) return { deployed: true, candidate: null };
  const candidate = record(row.candidate, "candidate");
  const candidateId = idText(candidate, "candidate_id");
  const status = text(candidate, "status");
  if (status !== "OPEN" && status !== "CLOSED") throw new Error("status");
  const items = arrayOf(row.items, "items").map((item) => evidenceItem(candidateId, item));
  const notes = arrayOf(row.notes, "notes").map((note) => researcherNote(candidateId, note));
  const memberships = arrayOf(row.memberships, "memberships");
  const sets = arrayOf(row.sets, "sets").map((set) => evidenceSet(candidateId, set, memberships));
  const state: ResearchWorkspaceState = {
    candidateId,
    items,
    notes,
    sets,
    decisions: [],
    legalEntitiesCreated: 0,
    resolutionDecisionsCreated: 0,
    ingestionRunsCreated: 0,
    parserRulesModified: 0,
    productionWrites: 0,
    persisted: false,
  };
  const members = arrayOf(row.members, "members").map((member) => ({
    positionObservationId: idText(member, "position_observation_id"),
    evidenceId: idText(member, "position_evidence_id"),
    disclosedLine: text(member, "disclosed_line_text"),
  }));
  return {
    deployed: true,
    candidate: { candidateId, caseKey: text(candidate, "case_key"), title: text(candidate, "title"), status, members, state },
  };
}

function arrayOf(value: unknown, label: string): RawRecord[] {
  if (!Array.isArray(value)) throw new Error(label);
  return value.map((item) => record(item, label));
}

function evidenceItem(candidateId: string, row: RawRecord): EvidenceItem {
  const origin = text(row, "origin");
  if (origin !== "INTERNAL" && origin !== "EXTERNAL") throw new Error("origin");
  const locatorType = optionalText(row, "locator_type");
  const rowOrdinal = optionalId(row, "html_row_ordinal");
  const slotOrdinal = optionalId(row, "html_slot_ordinal");
  const locator = origin === "EXTERNAL"
    ? null
    : locatorType == null
      ? NOT_CURRENTLY_EXPOSED
      : [locatorType, rowOrdinal == null ? null : `row ${rowOrdinal}`, slotOrdinal == null ? null : `slot ${slotOrdinal}`]
          .filter((part) => part != null)
          .join(" ");
  const storedLine = optionalText(row, "stored_line_text");
  const excerpt = origin === "EXTERNAL" ? text(row, "relevant_excerpt") : (storedLine ?? text(row, "title"));
  return {
    evidenceId: idText(row, "evidence_item_id"),
    candidateId,
    origin,
    sourceType: text(row, "source_type") as EvidenceItem["sourceType"],
    sourceTitle: text(row, "title"),
    sourceUrl: optionalText(row, "source_url"),
    sourceDocumentDate: optionalText(row, "document_date"),
    retrievedAt: optionalText(row, "retrieved_at"),
    sourceReference: optionalText(row, "source_url") ?? optionalId(row, "position_observation_id") ?? NOT_CURRENTLY_EXPOSED,
    relevantExcerpt: excerpt,
    questionId: null,
    createdBy: text(row, "created_by"),
    createdAt: text(row, "created_at"),
    provenance: {
      candidateId,
      observationId: optionalId(row, "position_observation_id"),
      accessionNumber: null,
      documentUrl: optionalText(row, "source_url"),
      artifact: origin === "INTERNAL" ? NOT_CURRENTLY_EXPOSED : null,
      locator,
    },
  };
}

function researcherNote(candidateId: string, row: RawRecord): ResearcherNote {
  return {
    noteId: idText(row, "note_id"),
    candidateId,
    evidenceId: optionalId(row, "evidence_item_id") ?? "",
    text: text(row, "note_text"),
    createdBy: text(row, "created_by"),
    createdAt: text(row, "created_at"),
  };
}

function evidenceSet(candidateId: string, row: RawRecord, memberships: RawRecord[]): EvidenceSet {
  const setId = idText(row, "evidence_set_id");
  return {
    setId,
    candidateId,
    title: text(row, "title"),
    evidenceIds: memberships
      .filter((member) => idText(member, "evidence_set_id") === setId)
      .map((member) => idText(member, "evidence_item_id")),
  };
}

export type ExternalWrite = {
  candidateId: string;
  sourceType: string;
  title: string;
  sourceUrl: string;
  documentDate: string;
  excerpt: string;
  noteText: string;
  positionObservationId: string | null;
  createdBy: string;
};

export function externalEvidenceSql(input: ExternalWrite): string {
  if (!SOURCE_TYPES.includes(input.sourceType as (typeof SOURCE_TYPES)[number])) throw new Error("Review source cannot be queried.");
  const date = input.documentDate.trim();
  if (date !== "" && !ISO_DATE.test(date)) throw new Error("Review date cannot be queried.");
  const position = input.positionObservationId == null || input.positionObservationId === ""
    ? "NULL"
    : quoteId(input.positionObservationId);
  const candidateId = quoteId(input.candidateId);
  const createdBy = quoteLiteral(input.createdBy.trim());
  const note = input.noteText.trim();
  const insert = `review.add_external_evidence(
  ${candidateId},
  ${quoteLiteral(input.sourceType)},
  ${quoteLiteral(input.title.trim())},
  ${quoteLiteral(input.sourceUrl.trim())},
  ${date === "" ? "NULL" : `${quoteLiteral(date)}::date`},
  ${quoteLiteral(input.excerpt.trim())},
  ${position},
  ${createdBy}
)`;
  const statement = note === ""
    ? `SELECT ${insert};`
    : `SELECT review.add_note(${candidateId}, ${insert}, ${quoteLiteral(note)}, ${createdBy});`;
  return `
BEGIN;
SET ROLE review_writer;
${statement}
COMMIT;
`;
}

export function noteSql(input: { candidateId: string; evidenceItemId: string; text: string; createdBy: string }): string {
  return `
BEGIN;
SET ROLE review_writer;
SELECT review.add_note(
  ${quoteId(input.candidateId)},
  ${quoteId(input.evidenceItemId)},
  ${quoteLiteral(input.text.trim())},
  ${quoteLiteral(input.createdBy.trim())}
);
COMMIT;
`;
}

export function evidenceSetSql(input: { candidateId: string; title: string; evidenceItemIds: string[]; createdBy: string }): string {
  const title = quoteLiteral(input.title.trim());
  const createdBy = quoteLiteral(input.createdBy.trim());
  const candidateId = quoteId(input.candidateId);
  const members = input.evidenceItemIds.map((id) =>
    `SELECT review.add_set_member((SELECT evidence_set_id FROM review.evidence_set_read WHERE candidate_id = ${candidateId} AND title = ${title} ORDER BY evidence_set_id DESC LIMIT 1), ${quoteId(id)}, ${createdBy});`);
  return `
BEGIN;
SET ROLE review_writer;
SELECT review.add_evidence_set(${candidateId}, ${title}, NULL, ${createdBy});
${members.join("\n")}
COMMIT;
`;
}

export function internalEvidenceSql(input: { candidateId: string; title: string; positionObservationId: string; evidenceId: string; createdBy: string }): string {
  return `
BEGIN;
SET ROLE review_writer;
SELECT review.add_internal_evidence(
  ${quoteId(input.candidateId)},
  ${quoteLiteral(input.title.trim())},
  ${quoteId(input.positionObservationId)},
  NULL,
  ${quoteId(input.evidenceId)},
  ${quoteLiteral(input.createdBy.trim())}
);
COMMIT;
`;
}

export function openCandidateSql(input: { caseKey: string; title: string; createdBy: string; positionObservationIds: string[] }): string {
  if (!CASE_KEY.test(input.caseKey)) throw new Error("Review case cannot be queried.");
  const createdBy = quoteLiteral(input.createdBy.trim());
  const key = quoteLiteral(input.caseKey);
  const members = input.positionObservationIds.map((id) =>
    `SELECT review.add_member((SELECT candidate_id FROM review.current_candidate WHERE case_key = ${key}), ${quoteId(id)}, NULL, ${createdBy});`);
  return `
BEGIN;
SET ROLE review_writer;
SELECT review.open_candidate(${key}, 'BORROWER', 'RESEARCHER', ${quoteLiteral(input.title.trim())}, ${createdBy});
${members.join("\n")}
COMMIT;
`;
}
