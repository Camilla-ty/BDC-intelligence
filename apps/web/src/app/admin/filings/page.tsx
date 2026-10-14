import { AdminFilingInventory } from "@/components/AdminFilingInventory";
import { PAGE_SIZE, pageWindow } from "@/lib/portfolios";
import { requireAdmin } from "@/server/auth/access";
import { loadAdminFilingInventory } from "@/server/load-admin-filings";

export const dynamic = "force-dynamic";

export default async function AdminFilingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const requested = Number(params.page ?? "1");
  const safePage = Number.isSafeInteger(requested) && requested >= 1 ? requested : 1;
  const loaded = await loadAdminFilingInventory(query, PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
  if (loaded.error || loaded.total == null) {
    return <AdminFilingInventory rows={[]} query={query} error={loaded.error ?? "The admin filing read model could not be read."} page={1} hasPrevious={false} hasNext={false} pastEnd={false} />;
  }
  const window = pageWindow(requested, loaded.total);
  return (
    <AdminFilingInventory
      rows={window.pastEnd ? [] : loaded.rows}
      query={query}
      error={null}
      page={window.page}
      hasPrevious={window.hasPrevious}
      hasNext={window.hasNext}
      pastEnd={window.pastEnd}
    />
  );
}
