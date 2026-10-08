import { MissingRecord } from "@/components/MissingRecord";
import { PortfolioPeriodChanges } from "@/components/PortfolioPeriodChanges";
import {
  absentPosition,
  confirmedChange,
  newPosition,
  periodSummary,
} from "@/lib/portfolio-changes";
import { registrantName } from "@/lib/portfolio-holdings";
import { UNOBSERVED_REGISTRANT } from "@/lib/states";
import { requireAuthenticatedUser } from "@/server/auth/access";
import { loadPortfolioDetail, loadPortfolioPeriodChanges } from "@/server/load-portfolios";

export const dynamic = "force-dynamic";

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export default async function PortfolioChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ cik: string }>;
  searchParams: Promise<{ earlier?: string; later?: string }>;
}) {
  await requireAuthenticatedUser();
  const { cik } = await params;
  const query = await searchParams;
  if (!/^[0-9]{10}$/.test(cik)) {
    return <MissingRecord message={UNOBSERVED_REGISTRANT} href="/portfolios" label="Portfolios" />;
  }
  const detail = await loadPortfolioDetail(cik);
  if (detail.error) return <p className="text-sm">{detail.error}</p>;
  const name = detail.registrant
    ? registrantName(detail.registrant.name_state, detail.registrant.name_raw)
    : "Unknown";
  const dates = detail.dates.map((date) => date.reported_date).sort();
  const earlier = typeof query.earlier === "string" && DATE.test(query.earlier) ? query.earlier : null;
  const later = typeof query.later === "string" && DATE.test(query.later) ? query.later : null;
  const comparable = earlier != null && later != null && earlier < later;
  const loaded = comparable ? await loadPortfolioPeriodChanges(cik, earlier, later) : null;
  if (loaded?.error) return <p className="text-sm">{loaded.error}</p>;
  const rows = loaded?.rows ?? [];
  return (
    <PortfolioPeriodChanges
      cik={cik}
      name={name}
      dates={dates}
      earlier={earlier}
      later={comparable ? later : null}
      summary={loaded?.summary ? periodSummary(loaded.summary) : null}
      confirmed={rows.filter((row) => row.change_type === "EXISTING_POSITION_CHANGED").map(confirmedChange)}
      observed={rows.filter((row) => row.change_type === "NEW_POSITION_OBSERVED").map(newPosition)}
      absent={rows.filter((row) => row.change_type === "POSITION_NO_LONGER_OBSERVED").map(absentPosition)}
    />
  );
}
