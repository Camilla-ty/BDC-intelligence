import { MaturityDetail } from "@/components/MaturityDetail";
import { MissingRecord } from "@/components/MissingRecord";
import { maturityDates, maturityYears } from "@/lib/maturity";
import { UNOBSERVED_REGISTRANT } from "@/lib/states";
import { loadMaturityDetail } from "@/server/load-maturity";

export const dynamic = "force-dynamic";

export default async function MaturityRegistrantPage({
  params,
}: {
  params: Promise<{ cik: string }>;
}) {
  const { cik } = await params;
  if (!/^[0-9]{10}$/.test(cik)) return <MissingRecord message={UNOBSERVED_REGISTRANT} href="/maturity" label="Maturity" />;
  const detail = loadMaturityDetail(cik);
  if (detail.error) return <p className="text-sm">{detail.error}</p>;
  if (!detail.registrant) return <MissingRecord message={UNOBSERVED_REGISTRANT} href="/maturity" label="Maturity" />;
  return (
    <MaturityDetail
      registrant={detail.registrant}
      names={detail.names}
      dates={maturityDates(detail.dates)}
      years={maturityYears(detail.years)}
      emptyPeriods={detail.emptyPeriods}
    />
  );
}
