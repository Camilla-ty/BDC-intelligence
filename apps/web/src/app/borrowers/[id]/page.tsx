import { BorrowerIntelligence } from "@/components/BorrowerIntelligence";
import { MissingRecord } from "@/components/MissingRecord";
import { positionComparisons } from "@/lib/borrower-comparisons";
import { historicalPositions } from "@/lib/borrower-positions";
import { maturityChangeLines, maturityWall, maturityYears } from "@/lib/borrower-maturity";
import { refinancingOutcomes } from "@/lib/borrower-refinancing";
import { valuationHistory } from "@/lib/borrower-valuation";
import { borrowerDetail } from "@/lib/borrowers";
import { UNOBSERVED_BORROWER } from "@/lib/states";
import { requireAuthenticatedUser } from "@/server/auth/access";
import { loadBorrowerMaturityObservations, loadBorrowerMaturitySummary, loadBorrowerMaturityYears, loadBorrowerObservationsForEntity, loadBorrowerPositionComparisons, loadBorrowerPositionObservations, loadBorrowerPositionValuation, loadBorrowerRefinancingOutcomes, loadPositionResearchFields } from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function BorrowerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuthenticatedUser();
  const { id } = await params;
  const { rows, error } = await loadBorrowerObservationsForEntity(id);
  if (error) return <p className="text-sm">{error}</p>;
  const borrower = borrowerDetail(rows, id);
  if (!borrower) return <MissingRecord message={UNOBSERVED_BORROWER} href="/borrowers" label="Borrowers" />;
  const [positions, comparisons, valuation, maturityRows, maturitySummary, maturityYearRows, refinancing] = await Promise.all([
    loadBorrowerPositionObservations(id),
    loadBorrowerPositionComparisons(id),
    loadBorrowerPositionValuation(id),
    loadBorrowerMaturityObservations(id),
    loadBorrowerMaturitySummary(id),
    loadBorrowerMaturityYears(id),
    loadBorrowerRefinancingOutcomes(id),
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
      valuation={valuation.error ? null : valuationHistory(valuation.rows, rows, id)}
      valuationError={valuation.error}
      maturity={
        maturityRows.error || maturitySummary.error || maturityYearRows.error || maturitySummary.row == null
          ? null
          : {
              wall: maturityWall(maturityRows.rows, rows, id),
              summary: maturitySummary.row,
              years: maturityYears(maturityYearRows.rows),
              changes: maturityChangeLines(comparisonRows),
            }
      }
      maturityError={maturityRows.error ?? maturitySummary.error ?? maturityYearRows.error}
      refinancing={refinancing.error ? null : refinancingOutcomes(refinancing.rows, rows, id)}
      refinancingError={refinancing.error}
    />
  );
}
