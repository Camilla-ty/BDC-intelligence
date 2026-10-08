import { AdminFilingInventory } from "@/components/AdminFilingInventory";
import { requireAdmin } from "@/server/auth/access";
import { loadAdminFilingInventory } from "@/server/load-admin-filings";

export const dynamic = "force-dynamic";

export default async function AdminFilingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const { rows, error } = await loadAdminFilingInventory(query);
  return <AdminFilingInventory rows={rows} query={query} error={error} />;
}
