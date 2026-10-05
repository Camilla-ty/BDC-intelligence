"use server";

import { revalidatePath } from "next/cache";
import {
  DURABLE_WRITE_REFUSED,
  evidenceSetSql,
  externalEvidenceSql,
  internalEvidenceSql,
  noteSql,
  openCandidateSql,
  reviewWritesAllowed,
  type ExternalWrite,
} from "@/lib/review-durable";
import { executeSql } from "@/server/sql-text";

type WriteResult = { ok: true } | { ok: false; error: string };

async function runLocal(sql: string, caseKey: string): Promise<WriteResult> {
  if (!reviewWritesAllowed(process.env.DATABASE_URL)) return { ok: false, error: DURABLE_WRITE_REFUSED };
  const executed = await executeSql(sql);
  if (!executed.ok) return { ok: false, error: "The local review case could not be saved." };
  revalidatePath(`/review/entities/${caseKey}`);
  return { ok: true };
}

export async function addExternalReviewEvidence(input: ExternalWrite & { caseKey: string }): Promise<WriteResult> {
  try {
    return await runLocal(externalEvidenceSql(input), input.caseKey);
  } catch {
    return { ok: false, error: "The local review case could not be saved." };
  }
}

export async function addReviewNote(input: { caseKey: string; candidateId: string; evidenceItemId: string; text: string; createdBy: string }): Promise<WriteResult> {
  try {
    return await runLocal(noteSql(input), input.caseKey);
  } catch {
    return { ok: false, error: "The local review case could not be saved." };
  }
}

export async function addReviewEvidenceSet(input: { caseKey: string; candidateId: string; title: string; evidenceItemIds: string[]; createdBy: string }): Promise<WriteResult> {
  try {
    return await runLocal(evidenceSetSql(input), input.caseKey);
  } catch {
    return { ok: false, error: "The local review case could not be saved." };
  }
}

export async function addInternalReviewEvidence(input: { caseKey: string; candidateId: string; title: string; positionObservationId: string; evidenceId: string; createdBy: string }): Promise<WriteResult> {
  try {
    return await runLocal(internalEvidenceSql(input), input.caseKey);
  } catch {
    return { ok: false, error: "The local review case could not be saved." };
  }
}

export async function openReviewCandidate(input: { caseKey: string; title: string; createdBy: string; positionObservationIds: string[] }): Promise<WriteResult> {
  try {
    return await runLocal(openCandidateSql(input), input.caseKey);
  } catch {
    return { ok: false, error: "The local review case could not be saved." };
  }
}
