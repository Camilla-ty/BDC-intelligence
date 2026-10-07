import { BorrowerIntelligence } from "@/components/BorrowerIntelligence";
import { MissingRecord } from "@/components/MissingRecord";
import { positionComparisons } from "@/lib/borrower-comparisons";
import { historicalPositions } from "@/lib/borrower-positions";
import { borrowerDetail } from "@/lib/borrowers";
import { UNOBSERVED_BORROWER } from "@/lib/states";
import { loadBorrowerObservations, loadBorrowerPositionComparisons, loadBorrowerPositionObservations, loadPositionResearchFields } from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function BorrowerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { rows, error } = await loadBorrowerObservations();
  if (error) return <p className="text-sm">{error}</p>;
  const borrower = borrowerDetail(rows, id);
  if (!borrower) return <MissingRecord message={UNOBSERVED_BORROWER} href="/borrowers" label="Borrowers" />;
  const [positions, comparisons] = await Promise.all([
    loadBorrowerPositionObservations(id),
    loadBorrowerPositionComparisons(id),
  ]);
  const research = positions.error
    ? { rows: [], error: null }
    : await loadPositionResearchFields(positions.rows.map((row) => row.position_observation_id));
  const comparisonRows = comparisons.error ? [] : positionComparisons(comparisons.rows, rows, id);
  return (
    <BorrowerIntelligence
      borrower={borrower}
      positions={positions.error ? [] : historicalPositions(positions.rows, rows, id, research.error ? [] : research.rows)}
      positionError={positions.error}
      researchError={positions.error ? null : research.error}
      comparisons={comparisonRows}
      comparisonError={comparisons.error}
    />
  );
}
