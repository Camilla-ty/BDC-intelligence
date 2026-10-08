import { PortfolioList } from "@/components/PortfolioList";
import { listPortfolios } from "@/lib/portfolios";
import { requireAuthenticatedUser } from "@/server/auth/access";
import { loadEmptyPeriods, loadPortfolioDirectory } from "@/server/load-portfolios";

export const dynamic = "force-dynamic";

export default async function PortfoliosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAuthenticatedUser();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const { rows, error } = await loadPortfolioDirectory();
  const periods = await loadEmptyPeriods();
  const portfolios = error ? [] : listPortfolios(rows, query);
  return (
    <PortfolioList
      portfolios={portfolios}
      query={query}
      error={error ?? periods.error}
      emptyPeriods={periods.error ? [] : periods.labels}
    />
  );
}
