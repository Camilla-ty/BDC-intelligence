import { MaturityLines } from "@/components/MaturityLines";
import { MissingRecord } from "@/components/MissingRecord";
import { maturityLine } from "@/lib/maturity";
import { pageWindow } from "@/lib/portfolios";
import { UNOBSERVED_DATE, UNOBSERVED_YEAR } from "@/lib/states";
import { loadEmptyPeriods } from "@/server/load-portfolios";
import { loadMaturityLines } from "@/server/load-maturity";

export const dynamic = "force-dynamic";

function yearLabel(year: string): string {
  if (year === "") return "All disclosed lines";
  if (year === "unknown") return "Unknown";
  if (year === "unresolved") return "Unresolved";
  return year;
}

export default async function MaturityLinesPage({
  params,
  searchParams,
}: {
  params: Promise<{ cik: string }>;
  searchParams: Promise<{ date?: string; year?: string; page?: string }>;
}) {
  const { cik } = await params;
  const query = await searchParams;
  const reportedDate = typeof query.date === "string" ? query.date : "";
  const year = typeof query.year === "string" ? query.year : "";
  const requested = Number(query.page ?? "1");
  if (!/^[0-9]{10}$/.test(cik) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(reportedDate)
    || (year !== "" && !/^(?:unknown|unresolved|[0-9]{4})$/.test(year))) {
    return <MissingRecord message={UNOBSERVED_DATE} href="/maturity" label="Maturity" />;
  }
  const periods = await loadEmptyPeriods();
  const first = await loadMaturityLines(cik, reportedDate, year, 0);
  if (first.error || periods.error) return <p className="text-sm">{first.error ?? periods.error}</p>;
  const total = first.total ?? 0;
  const window = pageWindow(requested, total);
  let rows = first.rows;
  if (first.dateFound && !window.pastEnd && window.start !== 0) {
    const pageRows = await loadMaturityLines(cik, reportedDate, year, window.start);
    if (pageRows.error) return <p className="text-sm">{pageRows.error}</p>;
    rows = pageRows.rows;
  }
  const emptyMessage = !first.dateFound
    ? UNOBSERVED_DATE
    : total === 0 && year !== "" && year !== "unknown" && year !== "unresolved"
      ? UNOBSERVED_YEAR
      : total === 0 && year === "unknown"
        ? "No disclosed line on this reported date has an unknown maturity."
        : total === 0 && year === "unresolved"
          ? "No disclosed line on this reported date has an unresolved maturity."
          : null;
  return (
    <MaturityLines
      cik={cik}
      reportedDate={reportedDate}
      yearLabel={yearLabel(year)}
      lines={!first.dateFound || window.pastEnd ? [] : rows.map(maturityLine)}
      page={window.page}
      hasPrevious={first.dateFound && window.hasPrevious}
      hasNext={first.dateFound && window.hasNext}
      pastEnd={first.dateFound && window.pastEnd}
      emptyMessage={window.pastEnd ? null : emptyMessage}
      emptyPeriods={periods.labels}
    />
  );
}
