import { MarketDate } from "@/components/MarketDate";
import { MISSING_DATE, listDateRegistrants } from "@/lib/market";
import { requireAuthenticatedUser } from "@/server/auth/access";
import { loadMarketDate } from "@/server/load-market";

export const dynamic = "force-dynamic";

export default async function MarketDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  await requireAuthenticatedUser();
  const { date } = await params;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    return <MarketDate reportedDate={date} rows={[]} emptyMessage={MISSING_DATE} />;
  }
  const detail = await loadMarketDate(date);
  if (detail.error) return <p className="text-sm">{detail.error}</p>;
  return (
    <MarketDate
      reportedDate={date}
      rows={detail.found ? listDateRegistrants(detail.rows, date) : []}
      emptyMessage={detail.found ? null : MISSING_DATE}
    />
  );
}
