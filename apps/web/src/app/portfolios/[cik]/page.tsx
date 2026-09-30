import { MissingRecord } from "@/components/MissingRecord";
import { PortfolioDetail } from "@/components/PortfolioDetail";
import { reportedDates } from "@/lib/portfolios";
import { UNOBSERVED_REGISTRANT } from "@/lib/states";
import { loadPortfolioDetail } from "@/server/load-portfolios";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ cik: string }>;
}) {
  const { cik } = await params;
  if (!/^[0-9]{10}$/.test(cik)) return <MissingRecord message={UNOBSERVED_REGISTRANT} href="/portfolios" label="Portfolios" />;
  const detail = await loadPortfolioDetail(cik);
  if (detail.error) return <p className="text-sm">{detail.error}</p>;
  if (!detail.registrant) return <MissingRecord message={UNOBSERVED_REGISTRANT} href="/portfolios" label="Portfolios" />;
  return (
    <PortfolioDetail
      registrant={detail.registrant}
      names={detail.names}
      dates={reportedDates(detail.dates)}
      emptyPeriods={detail.emptyPeriods}
    />
  );
}
