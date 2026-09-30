import { MissingRecord } from "@/components/MissingRecord";
import { PortfolioLines } from "@/components/PortfolioLines";
import { pageWindow, portfolioLine } from "@/lib/portfolios";
import { UNOBSERVED_DATE } from "@/lib/states";
import { loadEmptyPeriods, loadPortfolioLines } from "@/server/load-portfolios";

export const dynamic = "force-dynamic";

export default async function PortfolioLinesPage({
  params,
  searchParams,
}: {
  params: Promise<{ cik: string }>;
  searchParams: Promise<{ date?: string; page?: string }>;
}) {
  const { cik } = await params;
  const query = await searchParams;
  const reportedDate = typeof query.date === "string" ? query.date : "";
  const requested = Number(query.page ?? "1");
  if (!/^[0-9]{10}$/.test(cik) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(reportedDate)) {
    return <MissingRecord message={UNOBSERVED_DATE} href="/portfolios" label="Portfolios" />;
  }
  const periods = await loadEmptyPeriods();
  const first = await loadPortfolioLines(cik, reportedDate, 0);
  if (first.error || periods.error) return <p className="text-sm">{first.error ?? periods.error}</p>;
  const total = first.total ?? 0;
  const window = pageWindow(requested, total);
  let rows = first.rows;
  if (!window.pastEnd && window.start !== 0) {
    const pageRows = await loadPortfolioLines(cik, reportedDate, window.start);
    if (pageRows.error) return <p className="text-sm">{pageRows.error}</p>;
    rows = pageRows.rows;
  }
  return (
    <PortfolioLines
      cik={cik}
      reportedDate={reportedDate}
      lines={window.pastEnd ? [] : rows.map(portfolioLine)}
      page={window.page}
      hasPrevious={window.hasPrevious}
      hasNext={window.hasNext}
      pastEnd={window.pastEnd}
      emptyPeriods={periods.labels}
    />
  );
}
