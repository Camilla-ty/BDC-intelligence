"use server";

import { requireAdmin, requireAuthenticatedUser } from "@/server/auth/access";
import { executeSql } from "@/server/sql-text";

const ENTITY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTPS_URL = /^https:\/\/\S+$/;

export type EntityPreview = {
  legal_entity_id: string;
  canonical_legal_entity_id: string | null;
  creation_reason: string;
  aliases: { alias_text: string; verification_state: string }[];
  current_consolidation: {
    id: number;
    from_legal_entity_id: string;
    to_legal_entity_id: string | null;
    state: string;
    method: string;
    rationale: string;
    decided_by: string;
    decided_at: string;
  } | null;
};

export type PendingConsolidation = {
  id: number;
  from_legal_entity_id: string;
  to_legal_entity_id: string;
  state: string;
  method: string;
  rationale: string;
  decided_by: string;
  decided_at: string;
  evidence_id: number | null;
  researcher_citation_url: string | null;
  researcher_citation_title: string | null;
  researcher_citation_excerpt: string | null;
  from_canonical_legal_entity_id: string | null;
  to_canonical_legal_entity_id: string | null;
};

export type ConsolidationActionResult =
  | { ok: true; id: number }
  | { ok: false; error: string };

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullableText(value: string | null): string {
  return value == null ? "NULL" : sqlQuote(value);
}

function sqlNullableBigint(value: number | null): string {
  return value == null ? "NULL" : String(value);
}

/** Read-only: resolve approved canonical UUID. Pending proposals do not redirect. */
export async function loadCanonicalLegalEntityId(
  legalEntityId: string,
): Promise<{ canonicalId: string | null; error: string | null }> {
  await requireAuthenticatedUser();
  if (!ENTITY_ID.test(legalEntityId)) return { canonicalId: null, error: null };
  const executed = await executeSql(`
SET ROLE bdc_reader;
SET statement_timeout = '30s';
SELECT resolution.canonical_legal_entity('${legalEntityId}'::uuid)::text;
RESET ROLE;
`);
  if (!executed.ok) return { canonicalId: null, error: "Canonical identity could not be read." };
  const text = executed.text.trim();
  if (text === "") return { canonicalId: null, error: null };
  if (!ENTITY_ID.test(text)) return { canonicalId: null, error: "Canonical identity could not be read." };
  return { canonicalId: text.toLowerCase(), error: null };
}

export async function loadEntityConsolidationPreview(
  legalEntityId: string,
): Promise<{ preview: EntityPreview | null; error: string | null }> {
  await requireAdmin();
  if (!ENTITY_ID.test(legalEntityId)) return { preview: null, error: "Enter a valid legal-entity UUID." };
  const executed = await executeSql(`
SET ROLE admin_reader;
SET statement_timeout = '30s';
SELECT coalesce(registry.legal_entity_consolidation_preview('${legalEntityId}'::uuid)::text, '');
RESET ROLE;
`);
  if (!executed.ok) return { preview: null, error: "Legal entity could not be read." };
  if (executed.text.trim() === "") return { preview: null, error: null };
  try {
    const parsed = JSON.parse(executed.text) as EntityPreview;
    if (parsed == null || typeof parsed.legal_entity_id !== "string") {
      return { preview: null, error: "Legal entity could not be read." };
    }
    return { preview: parsed, error: null };
  } catch {
    return { preview: null, error: "Legal entity could not be read." };
  }
}

export async function loadPendingConsolidations(): Promise<{
  rows: PendingConsolidation[];
  error: string | null;
}> {
  await requireAdmin();
  const executed = await executeSql(`
SET ROLE admin_reader;
SET statement_timeout = '30s';
SELECT registry.list_pending_legal_entity_consolidations()::text;
RESET ROLE;
`);
  if (!executed.ok) return { rows: [], error: "Pending consolidations could not be read." };
  try {
    const parsed = JSON.parse(executed.text === "" ? "[]" : executed.text);
    if (!Array.isArray(parsed)) return { rows: [], error: "Pending consolidations could not be read." };
    return { rows: parsed as PendingConsolidation[], error: null };
  } catch {
    return { rows: [], error: "Pending consolidations could not be read." };
  }
}

export async function proposeLegalEntityConsolidation(input: {
  fromLegalEntityId: string;
  toLegalEntityId: string;
  rationale: string;
  evidenceId: string;
  citationUrl: string;
  citationTitle: string;
  citationExcerpt: string;
  expectedCurrentId: string;
}): Promise<ConsolidationActionResult> {
  const access = await requireAdmin();
  const fromId = input.fromLegalEntityId.trim().toLowerCase();
  const toId = input.toLegalEntityId.trim().toLowerCase();
  const rationale = input.rationale.trim();
  if (!ENTITY_ID.test(fromId) || !ENTITY_ID.test(toId)) {
    return { ok: false, error: "Both legal-entity UUIDs must be valid." };
  }
  if (fromId === toId) return { ok: false, error: "Source and survivor must be different UUIDs." };
  if (rationale === "") return { ok: false, error: "Rationale is required." };

  const evidenceRaw = input.evidenceId.trim();
  const evidenceId = evidenceRaw === "" ? null : Number(evidenceRaw);
  if (evidenceRaw !== "" && (!Number.isSafeInteger(evidenceId) || evidenceId! < 1)) {
    return { ok: false, error: "Structured evidence id must be a positive integer when provided." };
  }

  const citationUrl = input.citationUrl.trim();
  const citationTitle = input.citationTitle.trim();
  const citationExcerpt = input.citationExcerpt.trim();
  const hasCitation = citationUrl !== "" || citationTitle !== "" || citationExcerpt !== "";
  if (hasCitation) {
    if (!HTTPS_URL.test(citationUrl) || citationTitle === "" || citationExcerpt === "") {
      return {
        ok: false,
        error: "Researcher citation requires an https URL, title, and excerpt together.",
      };
    }
  }
  if (evidenceId == null && !hasCitation) {
    return { ok: false, error: "Provide structured evidence id and/or a complete researcher citation." };
  }

  const expectedRaw = input.expectedCurrentId.trim();
  const expectedCurrentId = expectedRaw === "" ? null : Number(expectedRaw);
  if (expectedRaw !== "" && (!Number.isSafeInteger(expectedCurrentId) || expectedCurrentId! < 1)) {
    return { ok: false, error: "Expected current head id is invalid." };
  }

  const decidedBy = `admin:${access.user.id}`;
  const executed = await executeSql(`
SET ROLE resolution_writer;
SET statement_timeout = '30s';
SELECT resolution.propose_legal_entity_consolidation(
  ${sqlQuote(fromId)}::uuid,
  ${sqlQuote(toId)}::uuid,
  ${sqlQuote(rationale)},
  ${sqlQuote(decidedBy)},
  ${sqlNullableBigint(evidenceId)},
  ${sqlNullableText(hasCitation ? citationUrl : null)},
  ${sqlNullableText(hasCitation ? citationTitle : null)},
  ${sqlNullableText(hasCitation ? citationExcerpt : null)},
  ${sqlNullableBigint(expectedCurrentId)}
)::text;
RESET ROLE;
`);
  if (!executed.ok) {
    return {
      ok: false,
      error:
        "Proposal was rejected. Check that both entities exist, the head is not stale, and the mapping would not cycle.",
    };
  }
  const id = Number(executed.text.trim());
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, error: "Proposal was rejected." };
  return { ok: true, id };
}

export async function approveLegalEntityConsolidation(input: {
  proposalId: string;
  rationale: string;
}): Promise<ConsolidationActionResult> {
  const access = await requireAdmin();
  const proposalId = Number(input.proposalId.trim());
  const rationale = input.rationale.trim();
  if (!Number.isSafeInteger(proposalId) || proposalId < 1) {
    return { ok: false, error: "Proposal id is invalid." };
  }
  if (rationale === "") return { ok: false, error: "Approval rationale is required." };
  const decidedBy = `admin:${access.user.id}`;
  const executed = await executeSql(`
SET ROLE resolution_writer;
SET statement_timeout = '30s';
SELECT resolution.approve_legal_entity_consolidation(
  ${proposalId},
  ${sqlQuote(decidedBy)},
  ${sqlQuote(rationale)}
)::text;
RESET ROLE;
`);
  if (!executed.ok) {
    return {
      ok: false,
      error: "Approval was rejected. The proposal may be stale, already decided, or would create a cycle.",
    };
  }
  const id = Number(executed.text.trim());
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, error: "Approval was rejected." };
  return { ok: true, id };
}

export async function rejectLegalEntityConsolidationProposal(input: {
  proposalId: string;
  rationale: string;
}): Promise<ConsolidationActionResult> {
  const access = await requireAdmin();
  const proposalId = Number(input.proposalId.trim());
  const rationale = input.rationale.trim();
  if (!Number.isSafeInteger(proposalId) || proposalId < 1) {
    return { ok: false, error: "Proposal id is invalid." };
  }
  if (rationale === "") return { ok: false, error: "Rejection rationale is required." };
  const decidedBy = `admin:${access.user.id}`;
  const executed = await executeSql(`
SET ROLE resolution_writer;
SET statement_timeout = '30s';
SELECT resolution.reject_legal_entity_consolidation_proposal(
  ${proposalId},
  ${sqlQuote(decidedBy)},
  ${sqlQuote(rationale)}
)::text;
RESET ROLE;
`);
  if (!executed.ok) {
    return {
      ok: false,
      error: "Proposal rejection was refused. The proposal may be stale or already decided.",
    };
  }
  const id = Number(executed.text.trim());
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, error: "Proposal rejection was refused." };
  return { ok: true, id };
}

export async function reverseLegalEntityConsolidation(input: {
  fromLegalEntityId: string;
  expectedCurrentId: string;
  rationale: string;
  evidenceId: string;
  citationUrl: string;
  citationTitle: string;
  citationExcerpt: string;
  confirmed: boolean;
}): Promise<ConsolidationActionResult> {
  const access = await requireAdmin();
  if (!input.confirmed) {
    return { ok: false, error: "Reversal requires explicit confirmation." };
  }
  const fromId = input.fromLegalEntityId.trim().toLowerCase();
  const rationale = input.rationale.trim();
  if (!ENTITY_ID.test(fromId)) return { ok: false, error: "Source legal-entity UUID is invalid." };
  if (rationale === "") return { ok: false, error: "Reversal rationale is required." };
  const expectedCurrentId = Number(input.expectedCurrentId.trim());
  if (!Number.isSafeInteger(expectedCurrentId) || expectedCurrentId < 1) {
    return { ok: false, error: "Expected current head id is invalid." };
  }

  const evidenceRaw = input.evidenceId.trim();
  const evidenceId = evidenceRaw === "" ? null : Number(evidenceRaw);
  if (evidenceRaw !== "" && (!Number.isSafeInteger(evidenceId) || evidenceId! < 1)) {
    return { ok: false, error: "Structured evidence id must be a positive integer when provided." };
  }
  const citationUrl = input.citationUrl.trim();
  const citationTitle = input.citationTitle.trim();
  const citationExcerpt = input.citationExcerpt.trim();
  const hasCitation = citationUrl !== "" || citationTitle !== "" || citationExcerpt !== "";
  if (hasCitation) {
    if (!HTTPS_URL.test(citationUrl) || citationTitle === "" || citationExcerpt === "") {
      return {
        ok: false,
        error: "Researcher citation requires an https URL, title, and excerpt together.",
      };
    }
  }
  if (evidenceId == null && !hasCitation) {
    return { ok: false, error: "Provide structured evidence id and/or a complete researcher citation." };
  }

  const decidedBy = `admin:${access.user.id}`;
  const executed = await executeSql(`
SET ROLE resolution_writer;
SET statement_timeout = '30s';
SELECT resolution.reverse_legal_entity_consolidation(
  ${sqlQuote(fromId)}::uuid,
  ${expectedCurrentId},
  ${sqlQuote(decidedBy)},
  ${sqlQuote(rationale)},
  ${sqlNullableBigint(evidenceId)},
  ${sqlNullableText(hasCitation ? citationUrl : null)},
  ${sqlNullableText(hasCitation ? citationTitle : null)},
  ${sqlNullableText(hasCitation ? citationExcerpt : null)}
)::text;
RESET ROLE;
`);
  if (!executed.ok) {
    return {
      ok: false,
      error: "Reversal was rejected. The mapping may be stale, missing, or not currently approved.",
    };
  }
  const id = Number(executed.text.trim());
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, error: "Reversal was rejected." };
  return { ok: true, id };
}
