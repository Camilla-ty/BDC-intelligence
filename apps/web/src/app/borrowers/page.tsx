import { BorrowerList } from "@/components/BorrowerList";
import {
  attachComparisonAvailability,
  filterAndSortBorrowers,
  listBorrowers,
  parseBorrowerListSort,
  parseComparisonAvailabilityFilter,
} from "@/lib/borrowers";
import { requireAuthenticatedUser } from "@/server/auth/access";
import {
  loadBorrowerComparisonAvailability,
  loadBorrowerObservations,
} from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function BorrowersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; comparisons?: string; sort?: string }>;
}) {
  await requireAuthenticatedUser();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const comparisonFilter = parseComparisonAvailabilityFilter(params.comparisons);
  const sort = parseBorrowerListSort(params.sort);
  const { rows, error } = await loadBorrowerObservations();
  const listed = error ? [] : listBorrowers(rows, query);
  const availability =
    error || listed.length === 0
      ? { rows: [], error: null }
      : await loadBorrowerComparisonAvailability(listed.map((borrower) => borrower.id));
  const attached = attachComparisonAvailability(listed, availability);
  // Filter/sort after availability attach so has/none never treat Unavailable as zero.
  const borrowers = filterAndSortBorrowers(attached, { comparisonFilter, sort });
  const comparisonError = availability.error;
  return (
    <BorrowerList
      borrowers={borrowers}
      query={query}
      comparisonFilter={comparisonFilter}
      sort={sort}
      error={error}
      comparisonError={comparisonError}
      matchedBeforeComparisonFilter={listed.length}
    />
  );
}
