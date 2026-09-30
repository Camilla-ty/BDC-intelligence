import { MarketRelease } from "@/components/MarketRelease";
import { coverageLabel, listReleaseDates } from "@/lib/market";
import { loadMarketRelease } from "@/server/load-market";

export const dynamic = "force-dynamic";

export default async function MarketReleasePage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const detail = loadMarketRelease(label);
  if (detail.error) return <p className="text-sm">{detail.error}</p>;
  return (
    <MarketRelease
      label={label}
      found={detail.found}
      coverageState={detail.coverageState ? coverageLabel(detail.coverageState) : null}
      rows={detail.found && detail.coverageState === "OBSERVED" ? listReleaseDates(detail.rows) : []}
    />
  );
}
