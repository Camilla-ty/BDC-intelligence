import { BorrowerIntelligence } from "@/components/BorrowerIntelligence";
import { MissingRecord } from "@/components/MissingRecord";
import { borrowerDetail } from "@/lib/borrowers";
import { UNOBSERVED_BORROWER } from "@/lib/states";
import { loadBorrowerObservations } from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function BorrowerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { rows, error } = loadBorrowerObservations();
  if (error) return <p className="text-sm">{error}</p>;
  const borrower = borrowerDetail(rows, id);
  if (!borrower) return <MissingRecord message={UNOBSERVED_BORROWER} href="/borrowers" label="Borrowers" />;
  return <BorrowerIntelligence borrower={borrower} />;
}
