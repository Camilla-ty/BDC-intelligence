import { BorrowerList } from "@/components/BorrowerList";
import { attachComparisonAvailability, listBorrowers } from "@/lib/borrowers";
import { requireAuthenticatedUser } from "@/server/auth/access";
import {
  loadBorrowerComparisonAvailability,
  loadBorrowerObservations,
} from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function BorrowersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAuthenticatedUser();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const { rows, error } = await loadBorrowerObservations();
  const listed = error ? [] : listBorrowers(rows, query);
  const availability =
    error || listed.length === 0
      ? { rows: [], error: null }
      : await loadBorrowerComparisonAvailability(listed.map((borrower) => borrower.id));
  const borrowers = attachComparisonAvailability(listed, availability);
  const comparisonError = availability.error;
  return (
    <BorrowerList
      borrowers={borrowers}
      query={query}
      error={error}
      comparisonError={comparisonError}
    />
  );
}
