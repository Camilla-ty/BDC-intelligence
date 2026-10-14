import { BorrowerIntelligence } from "@/components/BorrowerIntelligence";
import { MissingRecord } from "@/components/MissingRecord";
import { creditTimeline } from "@/lib/borrower-credit-timeline";
import { enrichComparisonsWithFieldTrace } from "@/lib/borrower-field-trace";
import { positionComparisons } from "@/lib/borrower-comparisons";
import { historicalPositions } from "@/lib/borrower-positions";
import { maturityChangeLines, maturityWall, maturityYears } from "@/lib/borrower-maturity";
import { refinancingOutcomes } from "@/lib/borrower-refinancing";
import { valuationHistory } from "@/lib/borrower-valuation";
import { redirect } from "next/navigation";
import { borrowerDetail } from "@/lib/borrowers";
import { UNOBSERVED_BORROWER } from "@/lib/states";
import { requireAuthenticatedUser } from "@/server/auth/access";
import { loadCanonicalLegalEntityId } from "@/server/consolidations";
import { loadBorrowerComparisonsAndRefinancing, loadBorrowerMaturityObservations, loadBorrowerMaturitySummary, loadBorrowerMaturityYears, loadBorrowerObservationsForEntity, loadBorrowerPositionObservations, loadBorrowerPositionValuation, loadComparisonFieldTrace, loadPositionResearchFields } from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function BorrowerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuthenticatedUser();
  const { id } = await params;
  const { canonicalId, error: canonicalError } = await loadCanonicalLegalEntityId(id);
  if (canonicalError) return <p className="text-sm">{canonicalError}</p>;
  // Approved consolidations only: pending proposals do not redirect.
  if (canonicalId != null && canonicalId !== id.toLowerCase()) {
    redirect(`/borrowers/${canonicalId}`);
  }
  const scopedId = canonicalId ?? id;
  const { rows, error } = await loadBorrowerObservationsForEntity(scopedId);
  if (error) return <p className="text-sm">{error}</p>;
  const borrower = borrowerDetail(rows, scopedId);
  if (!borrower) return <MissingRecord message={UNOBSERVED_BORROWER} href="/borrowers" label="Borrowers" />;
  const [positions, comparisonBundle, valuation, maturityRows, maturitySummary, maturityYearRows] = await Promise.all([
    loadBorrowerPositionObservations(scopedId),
    loadBorrowerComparisonsAndRefinancing(scopedId),
    loadBorrowerPositionValuation(scopedId),
    loadBorrowerMaturityObservations(scopedId),
    loadBorrowerMaturitySummary(scopedId),
    loadBorrowerMaturityYears(scopedId),
  ]);
  const comparisons = comparisonBundle.comparisons;
  const refinancing = comparisonBundle.refinancing;
  const research = positions.error
    ? { rows: [], error: null }
    : await loadPositionResearchFields(positions.rows.map((row) => row.position_observation_id));
  const fieldTrace = comparisons.error
    ? { rows: [], error: null }
    : await loadComparisonFieldTrace(comparisons.rows);
  const comparisonRows = comparisons.error
    ? []
    : enrichComparisonsWithFieldTrace(
        positionComparisons(comparisons.rows, rows, scopedId),
        fieldTrace.error ? [] : fieldTrace.rows,
      );
  const timeline = creditTimeline({
    observations: positions.error ? [] : positions.rows,
    valuations: valuation.error ? [] : valuation.rows,
    comparisons: comparisons.error ? [] : comparisons.rows,
  });
  return (
    <BorrowerIntelligence
      borrower={borrower}
      positions={positions.error ? [] : historicalPositions(positions.rows, rows, scopedId, research.error ? [] : research.rows)}
      positionError={positions.error}
      researchError={positions.error ? null : research.error}
      comparisons={comparisonRows}
      comparisonError={comparisons.error}
      timeline={timeline}
      valuation={valuation.error ? null : valuationHistory(valuation.rows, rows, scopedId)}
      valuationError={valuation.error}
      maturity={
        maturityRows.error || maturitySummary.error || maturityYearRows.error || maturitySummary.row == null
          ? null
          : {
              wall: maturityWall(maturityRows.rows, rows, scopedId),
              summary: maturitySummary.row,
              years: maturityYears(maturityYearRows.rows),
              changes: maturityChangeLines(comparisonRows),
            }
      }
      maturityError={maturityRows.error ?? maturitySummary.error ?? maturityYearRows.error}
      refinancing={refinancing.error ? null : refinancingOutcomes(refinancing.rows, rows, scopedId)}
      refinancingError={refinancing.error}
    />
  );
}
