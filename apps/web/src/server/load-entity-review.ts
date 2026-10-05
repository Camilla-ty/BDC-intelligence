import { assembleReview, entityReviewCandidate, entityReviewSql, parseEntityReviewPayload, type ReviewModel } from "@/lib/entity-review";
import { durableReviewSql, parseDurableLoad, type DurableLoad } from "@/lib/review-durable";
import { executeSql } from "@/server/sql-text";

export async function loadEntityReview(id: string): Promise<{ model: ReviewModel | null; error: string | null }> {
  const candidate = entityReviewCandidate(id);
  if (!candidate) return { model: null, error: null };
  const executed = await executeSql(entityReviewSql(candidate));
  if (!executed.ok || executed.text.trim() === "") {
    return { model: null, error: "The review candidate could not be read." };
  }
  try {
    return { model: assembleReview(candidate, parseEntityReviewPayload(JSON.parse(executed.text))), error: null };
  } catch {
    return { model: null, error: "The review candidate could not be read." };
  }
}

export async function loadDurableReview(caseKey: string): Promise<DurableLoad> {
  try {
    const executed = await executeSql(durableReviewSql(caseKey));
    if (!executed.ok || executed.text.trim() === "") return { deployed: false, candidate: null };
    return parseDurableLoad(JSON.parse(executed.text));
  } catch {
    return { deployed: false, candidate: null };
  }
}
