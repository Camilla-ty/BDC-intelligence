import { BorrowerList } from "@/components/BorrowerList";
import { listBorrowers } from "@/lib/borrowers";
import { loadBorrowerObservations } from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function BorrowersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const { rows, error } = loadBorrowerObservations();
  const borrowers = error ? [] : listBorrowers(rows, query);
  return <BorrowerList borrowers={borrowers} query={query} error={error} />;
}
