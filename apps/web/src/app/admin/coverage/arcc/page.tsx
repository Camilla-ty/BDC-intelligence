import { ArccSecCoverage } from "@/components/ArccSecCoverage";
import { requireAdmin } from "@/server/auth/access";
import { loadArccSecCoverage } from "@/server/load-arcc-sec-coverage";

export const dynamic = "force-dynamic";

export default async function ArccSecCoveragePage() {
  await requireAdmin();
  const { coverage, reconciliation, reconciliationError, bdcFlowOnlyCount, error } =
    await loadArccSecCoverage();
  return (
    <ArccSecCoverage
      coverage={coverage}
      reconciliation={reconciliation}
      reconciliationError={reconciliationError}
      bdcFlowOnlyCount={bdcFlowOnlyCount}
      error={error}
    />
  );
}
