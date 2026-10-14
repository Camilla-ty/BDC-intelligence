import { redirect } from "next/navigation";
import { BorrowerSources } from "@/components/BorrowerSources";
import { MissingRecord } from "@/components/MissingRecord";
import { borrowerDetail, sourceRows } from "@/lib/borrowers";
import { UNOBSERVED_BORROWER } from "@/lib/states";
import { requireAuthenticatedUser } from "@/server/auth/access";
import { loadCanonicalLegalEntityId } from "@/server/consolidations";
import { loadBorrowerObservationsForEntity } from "@/server/load-borrowers";

export const dynamic = "force-dynamic";

export default async function SourcesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuthenticatedUser();
  const { id } = await params;
  const { canonicalId, error: canonicalError } = await loadCanonicalLegalEntityId(id);
  if (canonicalError) return <p className="text-sm">{canonicalError}</p>;
  if (canonicalId != null && canonicalId !== id.toLowerCase()) {
    redirect(`/borrowers/${canonicalId}/sources`);
  }
  const scopedId = canonicalId ?? id;
  const { rows, error } = await loadBorrowerObservationsForEntity(scopedId);
  if (error) return <p className="text-sm">{error}</p>;
  const borrower = borrowerDetail(rows, scopedId);
  if (!borrower) return <MissingRecord message={UNOBSERVED_BORROWER} href="/borrowers" label="Borrowers" />;
  return <BorrowerSources id={borrower.id} name={borrower.name} sources={sourceRows(rows, scopedId)} />;
}
