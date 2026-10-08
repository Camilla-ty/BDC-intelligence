import { AdminDashboard } from "@/components/AdminDashboard";
import { requireAdmin } from "@/server/auth/access";
import { loadAdminDashboard } from "@/server/load-admin-filings";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const { summary, error } = await loadAdminDashboard();
  return <AdminDashboard summary={summary} error={error} />;
}
