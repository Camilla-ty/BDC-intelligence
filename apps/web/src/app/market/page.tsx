import { MarketCoverage } from "@/components/MarketCoverage";
import { listDateCoverage, listRegistrantCoverage, listReleaseCoverage } from "@/lib/market";
import { loadMarketDirectory } from "@/server/load-market";

export const dynamic = "force-dynamic";

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const directory = loadMarketDirectory();
  return (
    <MarketCoverage
      registrants={directory.error ? [] : listRegistrantCoverage(directory.registrants, query)}
      releases={directory.error ? [] : listReleaseCoverage(directory.releases)}
      dates={directory.error ? [] : listDateCoverage(directory.dates)}
      query={query}
      error={directory.error}
    />
  );
}
