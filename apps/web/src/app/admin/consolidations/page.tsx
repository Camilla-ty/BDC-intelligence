import { AdminConsolidations } from "@/components/AdminConsolidations";
import { requireAdmin } from "@/server/auth/access";
import { loadPendingConsolidations } from "@/server/consolidations";

export const dynamic = "force-dynamic";

export default async function AdminConsolidationsPage() {
  await requireAdmin();
  const { rows, error } = await loadPendingConsolidations();
  return <AdminConsolidations pending={rows} pendingError={error} />;
}
