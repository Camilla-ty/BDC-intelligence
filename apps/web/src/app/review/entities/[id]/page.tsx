import { EntityReview } from "@/components/EntityReview";
import { MissingRecord } from "@/components/MissingRecord";
import { loadDurableReview, loadEntityReview } from "@/server/load-entity-review";

export const dynamic = "force-dynamic";

export default async function EntityReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { model, error } = await loadEntityReview(id);
  if (error) return <p className="text-sm">{error}</p>;
  if (!model) {
    return <MissingRecord message="Unobserved. This review candidate is not stored." href="/review/entities" label="Review queue" />;
  }
  const durable = await loadDurableReview(id);
  return <EntityReview model={model} durable={durable} />;
}
