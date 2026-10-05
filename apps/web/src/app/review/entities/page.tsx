import { EntityReviewQueue } from "@/components/EntityReviewQueue";
import { ENTITY_REVIEW_CANDIDATES } from "@/lib/entity-review";
import { loadDurableReview } from "@/server/load-entity-review";

export const dynamic = "force-dynamic";

export default async function EntityReviewQueuePage() {
  const storedMembers: Record<string, number> = {};
  for (const candidate of ENTITY_REVIEW_CANDIDATES) {
    const durable = await loadDurableReview(candidate.id);
    if (durable.candidate) storedMembers[candidate.id] = durable.candidate.members.length;
  }
  return <EntityReviewQueue candidates={ENTITY_REVIEW_CANDIDATES} storedMembers={storedMembers} />;
}
