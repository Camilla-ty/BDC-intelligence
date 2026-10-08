import { notFound } from "next/navigation";
import { AdminFilingDetailView } from "@/components/AdminFilingDetail";
import { requireAdmin } from "@/server/auth/access";
import { loadAdminFilingDetail } from "@/server/load-admin-filings";

export const dynamic = "force-dynamic";

export default async function AdminFilingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { detail, error, notFound: missing } = await loadAdminFilingDetail(id);
  if (missing) notFound();
  if (error || detail == null) {
    return (
      <section>
        <h1 className="text-lg font-semibold text-navy">Filing detail</h1>
        <p className="mt-6 text-sm">{error ?? "The admin filing read model could not be read."}</p>
      </section>
    );
  }
  return <AdminFilingDetailView detail={detail} />;
}
