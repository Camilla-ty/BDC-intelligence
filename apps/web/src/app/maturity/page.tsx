import { MaturityList } from "@/components/MaturityList";
import { listPortfolios } from "@/lib/portfolios";
import { loadEmptyPeriods, loadPortfolioDirectory } from "@/server/load-portfolios";

export const dynamic = "force-dynamic";

export default async function MaturityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const { rows, error } = loadPortfolioDirectory();
  const periods = loadEmptyPeriods();
  const registrants = error ? [] : listPortfolios(rows, query);
  return (
    <MaturityList
      registrants={registrants}
      query={query}
      error={error ?? periods.error}
      emptyPeriods={periods.error ? [] : periods.labels}
    />
  );
}
