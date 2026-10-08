import type { SecSubmissionsCoverage } from "@/lib/sec-submissions";
import { requireAdmin } from "@/server/auth/access";
import { fetchArccSecSubmissions, type FetchArccOptions } from "@/server/sec/fetch-arcc-submissions";

export async function loadArccSecCoverage(options: FetchArccOptions = {}): Promise<{
  coverage: SecSubmissionsCoverage | null;
  error: string | null;
}> {
  await requireAdmin();
  return fetchArccSecSubmissions(options);
}
