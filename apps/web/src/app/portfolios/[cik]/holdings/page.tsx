import { MissingRecord } from "@/components/MissingRecord";
import { PortfolioHoldings } from "@/components/PortfolioHoldings";
import { PAGE_SIZE, pageWindow } from "@/lib/portfolios";
import { portfolioChange, portfolioHolding, portfolioSummary, registrantName } from "@/lib/portfolio-holdings";
import { UNOBSERVED_DATE } from "@/lib/states";
import { requireAuthenticatedUser } from "@/server/auth/access";
import { loadPortfolioDetail, loadPortfolioHoldingPage, loadPortfolioHoldings } from "@/server/load-portfolios";

export const dynamic = "force-dynamic";

export default async function PortfolioHoldingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ cik: string }>;
  searchParams: Promise<{ date?: string; page?: string }>;
}) {
  await requireAuthenticatedUser();
  const { cik } = await params;
  const query = await searchParams;
  const reportedDate = typeof query.date === "string" ? query.date : "";
  const requested = Number(query.page ?? "1");
  if (!/^[0-9]{10}$/.test(cik) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(reportedDate)) {
    return <MissingRecord message={UNOBSERVED_DATE} href="/portfolios" label="Portfolios" />;
  }
  const detail = await loadPortfolioDetail(cik);
  if (detail.error) return <p className="text-sm">{detail.error}</p>;
  const name = detail.registrant
    ? registrantName(detail.registrant.name_state, detail.registrant.name_raw)
    : "Unknown";
  const first = await loadPortfolioHoldings(cik, reportedDate, PAGE_SIZE, 0);
  if (first.error || first.summary == null) return <p className="text-sm">{first.error ?? "The portfolio listing could not be read."}</p>;
  const total = Number(first.summary.observation_count);
  const window = pageWindow(requested, Number.isSafeInteger(total) ? total : 0);
  let rows = first.rows;
  if (!window.pastEnd && window.start !== 0) {
    const pageRows = await loadPortfolioHoldingPage(cik, reportedDate, PAGE_SIZE, window.start);
    if (pageRows.error) return <p className="text-sm">{pageRows.error}</p>;
    rows = pageRows.rows;
  }
  return (
    <PortfolioHoldings
      cik={cik}
      name={name}
      reportedDate={reportedDate}
      summary={portfolioSummary(first.summary)}
      holdings={window.pastEnd ? [] : rows.map(portfolioHolding)}
      changes={first.changes.map(portfolioChange)}
      page={window.page}
      hasPrevious={window.hasPrevious}
      hasNext={window.hasNext}
      pastEnd={window.pastEnd}
    />
  );
}
